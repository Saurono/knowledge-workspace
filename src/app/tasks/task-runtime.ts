import type { TaskProtocol } from "@/modules/tasks"
import { createTaskPipeline } from "./task-pipeline"
import { createIngestExecute } from "./ingest-execute"

export interface TaskRuntimeHandle {
  list(): Promise<TaskProtocol[]>
  /** 收下一条外部执行器拥有的记录（镜像用）；不会被执行。 */
  adopt(task: TaskProtocol): Promise<TaskProtocol>
  subscribe(listener: (task: TaskProtocol) => void, options?: { replay?: boolean }): () => void
  enqueue(input: { kind: "ingest" | "lint" | "export" | "research" | "other"; scopeId: string; executorId: string; payload?: unknown; parentId?: string | null }): Promise<TaskProtocol>
  cancel(id: string): Promise<void>
  retry(id: string): Promise<TaskProtocol>
  dispose(): Promise<void>
}

export function createTaskRuntimeHandle(options: {
  root: string
  execute?: (task: TaskProtocol, signal?: AbortSignal) => Promise<{ ingest?: { completedAt: string; accepted: number; rejected: number } }>
  concurrency?: number
  now?: () => string
}): TaskRuntimeHandle & { start(): Promise<{ recovered: number; interrupted: number }> } {
  if (!options.now) throw new Error("Task runtime requires an injected now")
  const pipeline = createTaskPipeline({ ...options, execute: options.execute ?? createIngestExecute({ now: options.now }) })
  const subscriptions = new Set<() => void>()
  return {
    start: pipeline.start,
    list: pipeline.queue.list,
    enqueue: pipeline.enqueue,
    adopt: pipeline.adopt,
    cancel: pipeline.scheduler.cancel,
    retry: pipeline.scheduler.retry,
    subscribe(listener, settings) {
      const unsubscribe = pipeline.queue.subscribe(listener, settings)
      const remove = () => { unsubscribe(); subscriptions.delete(remove) }
      subscriptions.add(remove)
      return remove
    },
    async dispose() {
      // Cancellation may start the next queued task; drain active ownership too.
      while (pipeline.scheduler.running().length) {
        await Promise.all(pipeline.scheduler.running().map(id => pipeline.scheduler.cancel(id)))
      }
      pipeline.dispose()
      for (const unsubscribe of subscriptions) unsubscribe()
    },
  }
}
