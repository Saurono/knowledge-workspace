import { createTaskQueue, createTaskScheduler, type TaskProtocol, type TaskResult, type TaskRunnerPort } from "@/modules/tasks"
import { createProjectTaskJournal } from "./task-journal"

export interface TaskPipelineOptions {
  root: string
  execute: (task: TaskProtocol, signal?: AbortSignal) => Promise<Partial<TaskResult>>
  concurrency?: number
  now?: () => string
  onError?: (error: unknown) => void
}

export function createTaskPipeline(options: TaskPipelineOptions) {
  if (!options.now) throw new Error("Task pipeline requires an injected now")
  const now = options.now
  const queue = createTaskQueue({ storage: createProjectTaskJournal(options.root), now, onError: options.onError })
  const controllers = new Map<string, AbortController>()
  const adopted = new Set<string>()
  const runner: TaskRunnerPort = {
    async execute(_executorId, _input, { id, signal }) {
      const controller = new AbortController()
      controllers.set(id, controller)
      try {
        const task = await queue.get(id)
        if (!task) throw new Error(`Unknown task: ${id}`)
        const executionSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
        return { status: "succeeded", value: await options.execute(task, executionSignal) }
      } finally {
        controllers.delete(id)
      }
    },
    cancel(id) { controllers.get(id)?.abort() },
  }
  const scheduler = createTaskScheduler({
    queue, runner, now, concurrency: options.concurrency, onError: options.onError,
    onSucceeded: (_task, value) => value as Partial<TaskResult>,
    // start() 的首轮 notify() 也过滤收养记录，调度器永远不接手。
    acceptTask: task => !adopted.has(task.id),
  })
  let started = false
  const unsubscribe = queue.subscribe(task => {
    if (started && !adopted.has(task.id) && task.stage === "queued") void scheduler.notify().catch(error => options.onError?.(error))
  })
  const recover = () => queue.recover()
  return {
    queue, scheduler, recover,
    /** 观察别人的任务；执行权仍属于外部执行器。 */
    async adopt(task: TaskProtocol): Promise<TaskProtocol> {
      adopted.add(task.id)
      return queue.adopt(task)
    },
    async start() {
      const recovery = await recover()
      started = true
      await scheduler.start()
      return recovery
    },
    async enqueue(input: Parameters<typeof queue.enqueue>[0]) {
      const task = await queue.enqueue(input)
      if (started) await scheduler.notify()
      return task
    },
    dispose() {
      started = false
      unsubscribe()
      for (const id of controllers.keys()) runner.cancel(id)
    },
  }
}
