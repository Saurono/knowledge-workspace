import type { TaskProtocol } from "@/modules/tasks"

export interface IngestExecuteDeps {
  /** Defaults to the real runQueuedIngest; tests can inject a fake. */
  ingest?: (input: unknown, request: { id: string; scopeId: string; signal: AbortSignal }) => Promise<string[]>
  now: () => string
}

export function createIngestExecute(deps: IngestExecuteDeps):
  (task: TaskProtocol, signal?: AbortSignal) => Promise<{ ingest: { completedAt: string; accepted: number; rejected: number } }> {
  return async (task, signal) => {
    if (task.payload === undefined) throw new Error("Ingest task requires a payload")
    const ingest = deps.ingest ?? (async (input, request) => {
      const { runQueuedIngest } = await import("./ingestion")
      return runQueuedIngest(input as Parameters<typeof runQueuedIngest>[0], request)
    })
    const written = await ingest(task.payload, {
      id: task.id, scopeId: task.scopeId, signal: signal ?? new AbortController().signal,
    })
    // The executor returns written paths only; no rejected count is available yet.
    return { ingest: { completedAt: deps.now(), accepted: written.length, rejected: 0 } }
  }
}
