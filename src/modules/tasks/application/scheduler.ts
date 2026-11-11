import { isTerminalStage, type TaskProtocol, type TaskKind, type TaskStage, type TaskResult, type TaskError } from "../domain/protocol"

export interface TaskQueuePort {
  list(): Promise<TaskProtocol[]>
  get(id: string): Promise<TaskProtocol | undefined>
  enqueue(input: { kind: TaskKind; scopeId: string; executorId: string; parentId?: string | null }): Promise<TaskProtocol>
  transition(id: string, to: TaskStage): Promise<TaskProtocol>
  progress(id: string, text: string): Promise<TaskProtocol>
  recordResult(id: string, patch: Partial<TaskResult>): Promise<TaskProtocol>
  fail(id: string, error: TaskError): Promise<TaskProtocol>
  subscribe(listener: (task: TaskProtocol) => void, options?: { replay?: boolean }): () => void
}
export interface TaskRunnerPort {
  execute(executorId: string, input: unknown, request: { id: string; scopeId: string; signal?: AbortSignal }):
    Promise<{ status: "succeeded"; value: unknown } | { status: "cancelled" }>
  cancel(id: string): void
}
export interface TaskSchedulerOptions {
  queue: TaskQueuePort
  runner: TaskRunnerPort
  inputFor?: (task: TaskProtocol) => unknown
  onSucceeded?: (task: TaskProtocol, value: unknown) => Partial<TaskResult> | null
  concurrency?: number
  now: () => string
  onError?: (error: unknown) => void
  /** 只调度返回 true 的 queued 任务；缺省接受全部任务。 */
  acceptTask?: (task: TaskProtocol) => boolean
}

export function createTaskScheduler(options: TaskSchedulerOptions) {
  const { queue, runner } = options
  const limit = Number.isFinite(options.concurrency) ? Math.max(1, Math.floor(options.concurrency!)) : 2
  const active = new Map<string, { scopeId: string; cancelled: boolean; settled: Promise<void> }>()
  let serial = Promise.resolve()
  const report = (error: unknown) => {
    try { options.onError?.(error) } catch { /* Observers cannot control scheduling. */ }
  }
  const locked = (action: () => Promise<void>) => {
    const next = serial.then(action)
    serial = next.catch(report)
    return next
  }
  const notify = () => locked(async () => {
    for (const task of await queue.list()) {
      if (active.size >= limit) break
      if (task.stage !== "queued" || active.has(task.id) ||
        [...active.values()].some(run => run.scopeId === task.scopeId)) continue
      if (options.acceptTask && !options.acceptTask(task)) continue
      const run = { scopeId: task.scopeId, cancelled: false, settled: Promise.resolve() }
      active.set(task.id, run)
      // Each owned execution includes its terminal write and the next queue scan.
      run.settled = (async () => {
        try {
          const running = await queue.transition(task.id, "running")
          if (run.cancelled) {
            await queue.transition(task.id, "cancelled")
            return
          }
          const outcome = await runner.execute(task.executorId, options.inputFor ? options.inputFor(running) : task.id,
            { id: task.id, scopeId: task.scopeId })
          if (run.cancelled || outcome.status === "cancelled") {
            await queue.transition(task.id, "cancelled")
          } else {
            const patch = options.onSucceeded?.(running, outcome.value)
            if (patch) await queue.recordResult(task.id, patch)
            else await queue.progress(task.id, `Execution succeeded at ${options.now()}`)
            await queue.transition(task.id, run.cancelled ? "cancelled" : "done")
          }
        } catch (error) {
          report(error)
          try {
            const current = await queue.get(task.id)
            if (current && !isTerminalStage(current.stage)) {
              if (run.cancelled) await queue.transition(task.id, "cancelled")
              else await queue.fail(task.id, { code: "execution_failed", message: String(error), retriable: true })
            }
          } catch (writeError) { report(writeError) }
        } finally {
          active.delete(task.id)
          await notify().catch(report)
        }
      })()
    }
  })
  return {
    start: notify,
    notify,
    running: () => [...active.keys()],
    async cancel(id: string) {
      const run = active.get(id)
      if (run) {
        run.cancelled = true
        runner.cancel(id)
        await run.settled
      } else {
        await locked(async () => {
          const task = await queue.get(id)
          if (task?.stage === "queued") await queue.transition(id, "cancelled")
          else {
            const started = active.get(id)
            if (started) { started.cancelled = true; runner.cancel(id) }
          }
        })
        await active.get(id)?.settled
      }
    },
    async retry(id: string) {
      const task = await queue.get(id)
      if (!task || (task.stage !== "failed" && task.stage !== "cancelled"))
        throw new Error(`Task cannot be retried: ${id}`)
      const fresh = await queue.enqueue({ kind: task.kind, scopeId: task.scopeId, executorId: task.executorId, parentId: id })
      return queue.progress(fresh.id, `Retry of ${id}`)
    },
  }
}
