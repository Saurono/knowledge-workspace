import type { IngestTask } from "@/modules/ingestion"
import type { TaskProtocol } from "@/modules/tasks"

export const LEGACY_INGEST_EXECUTOR = "legacy-ingest-mirror"

export function createLegacyIngestMirror(options: {
  subscribe(listener: (tasks: readonly IngestTask[]) => void): () => void
  host: { list(): Promise<TaskProtocol[]>; adopt(task: TaskProtocol): Promise<TaskProtocol> }
  now: () => string
  onError?: (error: unknown) => void
}): { ready: Promise<void>; sync(tasks: readonly IngestTask[]): Promise<void>; stop(): void } {
  const records = new Map<string, TaskProtocol>()
  const report = (error: unknown) => { try { options.onError?.(error) } catch { /* Error reporting must not break synchronization. */ } }
  let stopped = false
  let first = true
  let resolveReady!: () => void
  const ready = new Promise<void>((resolve) => { resolveReady = resolve })
  let chain = Promise.resolve()
  const terminal = (stage: string) => ["done", "failed", "cancelled"].includes(stage)
  const write = async (task: TaskProtocol) => {
    try { records.set(task.id, await options.host.adopt(task)) } catch (error) { report(error) }
  }
  const sync = (tasks: readonly IngestTask[]): Promise<void> => {
    const snapshot = tasks.map((task) => ({ ...task }))
    chain = chain.then(async () => {
      if (stopped) return
      const initial = first
      first = false
      try {
        if (initial) {
          try {
            for (const task of await options.host.list()) {
              if (task.executorId === LEGACY_INGEST_EXECUTOR) records.set(task.id, task)
            }
          } catch (error) { report(error) }
        }
        const present = new Set<string>()
        for (const task of snapshot) {
          if (stopped) return
          const scopeId = task.projectId || "legacy"
          const id = `legacy-ingest:${scopeId}:${task.id}`
          present.add(id)
          const previous = records.get(id)
          const stage = ({ pending: "queued", processing: "running", done: "done", failed: "failed", cancelled: "cancelled" } as const)[task.status]
          const error = stage === "failed" ? { code: "legacy_ingest_failed", message: task.error ?? "Legacy ingest task failed", retriable: true } : null
          if (previous?.stage === stage && previous.error?.message === error?.message) continue
          const now = options.now()
          const date = new Date(task.addedAt)
          const createdAt = Number.isFinite(task.addedAt) && Number.isFinite(date.getTime()) ? date.toISOString() : now
          const log = [...(previous?.log ?? [])]
          if (previous && previous.stage !== stage) {
            log.push({ at: now, level: stage === "failed" ? "error" : "info", message: stage === "failed" ? `legacy queue: failed: ${task.error || "unknown error"}` : `legacy queue: ${task.status}` })
            if (stage === "done") log.push({ at: now, level: "info", message: "Ingest finished in legacy queue; written file counts are not reported" })
          }
          await write({
            id, kind: "ingest", executorId: LEGACY_INGEST_EXECUTOR, scopeId, parentId: null, stage,
            payload: { sourcePath: task.sourcePath, projectId: task.projectId,
              ...(task.sourceId === undefined ? {} : { sourceId: task.sourceId }),
              ...(task.sourceRevision === undefined ? {} : { sourceRevision: task.sourceRevision }),
              folderContext: task.folderContext, retryCount: task.retryCount,
              title: task.sourcePath.split("/").filter(Boolean).slice(-1)[0] ?? task.sourcePath },
            createdAt: previous?.createdAt ?? createdAt, updatedAt: now,
            startedAt: previous?.startedAt ?? (stage === "running" ? now : null),
            finishedAt: previous?.finishedAt ?? (terminal(stage) ? now : null),
            progress: previous?.progress ?? "", log, result: { report: null, ingest: null }, error,
          })
        }
        for (const task of records.values()) {
          if (stopped) return
          if (present.has(task.id) || terminal(task.stage)) continue
          const now = options.now()
          await write({ ...task, stage: "cancelled", updatedAt: now, finishedAt: task.finishedAt ?? now,
            log: [...task.log, { at: now, level: "warn", message: "Removed from legacy queue" }] })
        }
      } finally { if (initial) resolveReady() }
    }).catch(report)
    return chain
  }
  let unsubscribe = () => {}
  try { unsubscribe = options.subscribe((tasks) => { void sync(tasks).catch(report) }) }
  catch (error) { report(error); resolveReady() }
  return { ready, sync, stop() { stopped = true; unsubscribe(); resolveReady() } }
}
