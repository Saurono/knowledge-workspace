import {
  appendTaskLog, createTaskProtocol, failTask, recordTaskResult, taskTransition, TASK_KINDS, TASK_STAGES,
  type TaskError, type TaskKind, type TaskProtocol, type TaskResult, type TaskStage,
} from "../domain/protocol"

export interface TaskStoragePort {
  save(task: TaskProtocol): Promise<void>
  load(): Promise<TaskProtocol[]>
}
export interface TaskQueueOptions {
  storage: TaskStoragePort
  now: () => string
  newId?: () => string
  onError?: (error: unknown) => void
}

export function createTaskQueue(options: TaskQueueOptions) {
  const tasks = new Map<string, TaskProtocol>()
  const listeners = new Set<(task: TaskProtocol) => void>()
  const snapshot = () => [...tasks.values()].sort((a, b) =>
    a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  const notify = (listener: (task: TaskProtocol) => void, task: TaskProtocol) => {
    try { listener(structuredClone(task)) }
    catch (error) {
      try { options.onError?.(error) } catch { /* Observers cannot affect the queue. */ }
    }
  }
  const persist = async (task: TaskProtocol) => {
    await options.storage.save(structuredClone(task))
    tasks.set(task.id, structuredClone(task))
    for (const listener of listeners) notify(listener, task)
    return structuredClone(task)
  }
  const requireTask = (id: string) => {
    const task = tasks.get(id)
    if (!task) throw new Error(`Unknown task: ${id}`)
    return task
  }
  return {
    /** 收下外部执行器拥有的记录；外部真值允许回退，不套本队列迁移规则或完成条件。 */
    async adopt(task: TaskProtocol): Promise<TaskProtocol> {
      if (!task || typeof task.id !== "string" || !task.id ||
        !TASK_KINDS.includes(task.kind) || !TASK_STAGES.includes(task.stage) ||
        typeof task.createdAt !== "string" || Number.isNaN(Date.parse(task.createdAt)) ||
        typeof task.updatedAt !== "string" || Number.isNaN(Date.parse(task.updatedAt)) ||
        !Array.isArray(task.log) || !task.result || typeof task.result !== "object" ||
        Array.isArray(task.result) || !("report" in task.result) || !("ingest" in task.result))
        throw new Error("Invalid adopted task")
      return persist(task)
    },
    async enqueue(input: { kind: TaskKind; scopeId: string; executorId: string; parentId?: string | null; payload?: unknown }) {
      return persist(createTaskProtocol({ ...input, id: options.newId?.() ?? crypto.randomUUID(), now: options.now() }))
    },
    async list() { return structuredClone(snapshot()) },
    async get(id: string) { const task = tasks.get(id); return task ? structuredClone(task) : undefined },
    async transition(id: string, to: TaskStage) {
      return persist(taskTransition(requireTask(id), to, options.now()))
    },
    async progress(id: string, text: string) {
      const now = options.now()
      const task = appendTaskLog(requireTask(id), { at: now, level: "info", message: text })
      return persist({ ...task, progress: text, updatedAt: now })
    },
    async recordResult(id: string, patch: Partial<TaskResult>) {
      return persist({ ...recordTaskResult(requireTask(id), patch), updatedAt: options.now() })
    },
    async fail(id: string, error: TaskError) {
      return persist(failTask(requireTask(id), error, options.now()))
    },
    async recover() {
      const loaded = await options.storage.load()
      tasks.clear()
      let recovered = 0
      for (const task of loaded) {
        if (task.stage === "running" || task.stage === "report" || task.stage === "ingest") {
          const now = options.now()
          await persist({ ...task, stage: "queued", startedAt: null, progress: "",
            log: [...task.log, { at: now, level: "warn", message: "Interrupted by restart; returned to queue" }],
            updatedAt: now })
          recovered++
        } else tasks.set(task.id, structuredClone(task))
      }
      return { recovered, interrupted: recovered }
    },
    subscribe(listener: (task: TaskProtocol) => void, settings?: { replay?: boolean }) {
      listeners.add(listener)
      if (settings?.replay) for (const task of snapshot()) notify(listener, task)
      return () => { listeners.delete(listener) }
    },
  }
}
