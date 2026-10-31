import type { IngestTask } from "./queue-task"

/** Version-one compatibility: the on-disk envelope remains a plain task array. */
export function decodeQueueSnapshot(raw: string, projectId: string): IngestTask[] {
  const tasks = JSON.parse(raw) as IngestTask[]
  // Old snapshots predate projectId. Explicit IDs remain available for the
  // service to reject cross-project contamination during restore.
  return tasks.map((task) => ({ ...task, projectId: task.projectId ?? projectId }))
}

export function encodeQueueSnapshot(tasks: readonly IngestTask[]): string {
  return JSON.stringify(tasks, null, 2)
}
