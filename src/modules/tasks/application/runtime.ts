import { TaskCancelledError, type TaskRecord } from "../domain/task"
export interface TaskExecutionContext {
  taskId: string
  scopeId: string
  signal: AbortSignal
  progress(detail: string): void
  assertCurrent(): void
}
export interface TaskExecutor<Input, Output> {
  execute(input: Input, context: TaskExecutionContext): Promise<Output>
}
export interface TaskRunRequest {
  id: string
  scopeId: string
  /** The owner keeps cancellation authority (queue, session, or request). */
  signal?: AbortSignal
}
export interface TaskRuntimeOptions {
  isScopeCurrent?: (scopeId: string) => boolean
  onEvent?: (record: TaskRecord) => void
  onObserverError?: (error: unknown) => void
}
export function createTaskRuntime(options: TaskRuntimeOptions = {}) {
  const executors = new Map<string, TaskExecutor<unknown, unknown>>()
  const active = new Map<string, { controller: AbortController; executorId: string }>()
  const records = new Map<string, TaskRecord>()
  const emit = (record: TaskRecord) => {
    records.set(record.id, { ...record })
    try {
      options.onEvent?.({ ...record })
    } catch (error) {
      try {
        options.onObserverError?.(error)
      } catch {
        /* observers never control task outcomes */
      }
    }
  }
  return {
    register<Input, Output>(id: string, executor: TaskExecutor<Input, Output>) {
      if (!id || executors.has(id)) throw new Error(`Executor already registered or invalid: ${id}`)
      executors.set(id, executor as TaskExecutor<unknown, unknown>)
      return () => {
        if ([...active.values()].some((run) => run.executorId === id))
          throw new Error("Cannot unregister an active executor")
        executors.delete(id)
      }
    },
    get(id: string): TaskRecord | undefined {
      const record = records.get(id)
      return record ? { ...record } : undefined
    },
    canCancel: (id: string) => active.has(id),
    cancel: (id: string) => {
      active.get(id)?.controller.abort()
    },
    cancelAll: () => {
      for (const run of active.values()) run.controller.abort()
    },
    async execute<Input, Output>(
      executorId: string,
      input: Input,
      request: TaskRunRequest,
    ): Promise<{ status: "succeeded"; value: Output } | { status: "cancelled" }> {
      const executor = executors.get(executorId)
      if (!executor) throw new Error(`Unknown executor: ${executorId}`)
      if (!request.id || !request.scopeId || active.has(request.id))
        throw new Error("Invalid or already active task")
      const controller = new AbortController()
      const record: TaskRecord = {
        id: request.id,
        scopeId: request.scopeId,
        executorId,
        status: "running",
        detail: "",
      }
      const isCurrent = () =>
        active.get(request.id)?.controller === controller &&
        !controller.signal.aborted &&
        (options.isScopeCurrent?.(request.scopeId) ?? true)
      const context: TaskExecutionContext = {
        taskId: request.id,
        scopeId: request.scopeId,
        signal: controller.signal,
        assertCurrent: () => {
          if (!isCurrent()) throw new TaskCancelledError()
        },
        progress: (detail) => {
          if (isCurrent()) emit({ ...record, detail })
        },
      }
      active.set(request.id, { controller, executorId })
      const abortFromOwner = () => controller.abort(request.signal?.reason)
      request.signal?.addEventListener("abort", abortFromOwner, { once: true })
      // Also handle cancellation before listener registration.
      if (request.signal?.aborted) abortFromOwner()
      try {
        emit(record)
        context.assertCurrent()
        const result = await executor.execute(input, context)
        context.assertCurrent()
        emit({ ...record, status: "succeeded", detail: records.get(request.id)?.detail ?? "" })
        return { status: "succeeded", value: result as Output }
      } catch (error) {
        if (!isCurrent() || error instanceof TaskCancelledError) {
          emit({ ...record, status: "cancelled", detail: "Cancelled" })
          return { status: "cancelled" }
        }
        emit({ ...record, status: "failed", detail: String(error) })
        throw error
      } finally {
        request.signal?.removeEventListener("abort", abortFromOwner)
        active.delete(request.id)
      }
    },
  }
}
export type TaskRuntime = ReturnType<typeof createTaskRuntime>
