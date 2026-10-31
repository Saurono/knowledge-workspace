export type TaskStatus = "running" | "succeeded" | "failed" | "cancelled"
export interface TaskRecord {
  id: string
  executorId: string
  scopeId: string
  status: TaskStatus
  detail: string
}
export class TaskCancelledError extends Error {
  constructor() {
    super("Cancelled")
    this.name = "TaskCancelledError"
  }
}
