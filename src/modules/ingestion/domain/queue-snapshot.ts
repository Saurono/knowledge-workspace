import type { IngestTask } from "./queue-task"
import { isCanonicalIngestionIdempotencyKey } from "./idempotency"

/** Version-one compatibility: the on-disk envelope remains a plain task array. */
export function decodeQueueSnapshot(raw: string, projectId: string): IngestTask[] {
  const tasks = JSON.parse(raw) as IngestTask[]
  // Old snapshots predate projectId. Explicit IDs remain available for the
  // service to reject cross-project contamination during restore.
  return tasks.map((task) => {
    if (!task || typeof task !== "object" || Array.isArray(task)) throw new Error("Invalid ingest queue task")
    const restored = { ...task, projectId: task.projectId ?? projectId }
    const hasBinding = restored.sourceRevision !== undefined || restored.idempotencyKey !== undefined
    if (hasBinding) {
      if (typeof restored.sourceId !== "string" || typeof restored.sourceRevision !== "string" || typeof restored.idempotencyKey !== "string" ||
          !isCanonicalIngestionIdempotencyKey(restored.projectId, restored.sourceId, restored.sourceRevision, restored.idempotencyKey))
        throw new Error("Invalid ingestion idempotency identity in queue snapshot")
    } else if (restored.sourceId !== undefined && (typeof restored.sourceId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(restored.sourceId))) {
      throw new Error("Invalid stable source identity in queue snapshot")
    }
    return restored
  })
}

export function encodeQueueSnapshot(tasks: readonly IngestTask[]): string {
  return JSON.stringify(tasks, null, 2)
}
