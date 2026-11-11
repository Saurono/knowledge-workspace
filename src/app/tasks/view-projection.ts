import type { TaskProtocol } from "@/modules/tasks"
import type { ImportTaskView, TaskActivityView } from "@/modules/tasks/ui"

// queued → pending; running/report/ingest → processing; terminal stages retain their names.
const importStatus = { queued: "pending", running: "processing", report: "processing", ingest: "processing", done: "done", failed: "failed", cancelled: "cancelled" } as const
// queued/running/report/ingest → running; failed → error; done/cancelled retain their names.
const activityStatus = { queued: "running", running: "running", report: "running", ingest: "running", done: "done", failed: "error", cancelled: "cancelled" } as const
const time = (value: string): number => {
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? 0 : parsed
}
const sorted = (tasks: readonly TaskProtocol[]) => [...tasks].sort((a, b) =>
  time(a.createdAt) - time(b.createdAt) || a.id.localeCompare(b.id))
function payloadString(task: TaskProtocol, key: string): string | undefined {
  if (typeof task.payload !== "object" || task.payload === null) return undefined
  const value = (task.payload as Record<string, unknown>)[key]
  return typeof value === "string" ? value : undefined
}

export function toImportTaskViews(tasks: readonly TaskProtocol[]): ImportTaskView[] {
  return sorted(tasks).map(task => ({
    id: task.id, sourcePath: payloadString(task, "sourcePath") ?? "",
    status: importStatus[task.stage], addedAt: time(task.createdAt), error: task.error?.message ?? null,
  }))
}

export function toActivityViews(tasks: readonly TaskProtocol[]): TaskActivityView[] {
  return sorted(tasks).map(task => ({
    id: task.id, taskId: task.id, parentTaskId: task.parentId ?? undefined,
    type: task.kind === "ingest" ? "ingest" : task.kind === "lint" ? "lint" : "query",
    title: payloadString(task, "title") ?? `${task.kind} · ${task.id}`,
    status: activityStatus[task.stage], detail: task.progress ?? "",
    log: task.log.length ? task.log.map(entry => `${entry.at} ${entry.level}: ${entry.message}`) : undefined,
    // result.ingest contains counts, not paths; never invent written file paths.
    filesWritten: [], createdAt: time(task.createdAt),
  }))
}
