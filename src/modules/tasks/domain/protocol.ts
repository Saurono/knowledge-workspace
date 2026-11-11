export const TASK_KINDS = ["research", "ingest", "lint", "export", "other"] as const
export type TaskKind = typeof TASK_KINDS[number]

export const TASK_STAGES = ["queued", "running", "report", "ingest", "done", "failed", "cancelled"] as const
export type TaskStage = typeof TASK_STAGES[number]

export interface TaskLogEntry { at: string; level: "info" | "warn" | "error"; message: string }
export interface TaskError { code: string; message: string; retriable: boolean }
export interface TaskResult {
  /** 研究报告写完 ≠ 知识入库完成，两件事分开记。null 表示这一半还没完成。 */
  report: { ref: string | null; completedAt: string } | null
  ingest: { completedAt: string; accepted: number; rejected: number } | null
}
export interface TaskProtocol {
  id: string
  kind: TaskKind
  stage: TaskStage
  parentId: string | null
  scopeId: string
  executorId: string
  payload?: unknown
  createdAt: string
  updatedAt: string
  startedAt: string | null
  finishedAt: string | null
  progress: string
  log: TaskLogEntry[]
  result: TaskResult
  error: TaskError | null
}

// 仅允许下列迁移；终态只能原地重复，非终态不允许原地重复。
const transitions: Record<TaskStage, readonly TaskStage[]> = {
  queued: ["running", "cancelled"],
  running: ["report", "ingest", "done", "failed", "cancelled"],
  report: ["ingest", "done", "failed", "cancelled"],
  ingest: ["done", "failed", "cancelled"],
  done: ["done"],
  failed: ["failed"],
  cancelled: ["cancelled"],
}

function parseTime(value: string): number {
  const time = Date.parse(value)
  if (Number.isNaN(time)) throw new Error(`Invalid task time: ${value}`)
  return time
}

export function isTerminalStage(stage: TaskStage): boolean {
  return stage === "done" || stage === "failed" || stage === "cancelled"
}

export function createTaskProtocol(input: {
  id: string; kind: TaskKind; scopeId: string; executorId: string
  parentId?: string | null; payload?: unknown; now: string
}): TaskProtocol {
  if (input.id === "") throw new Error("Invalid task id")
  parseTime(input.now)
  return {
    id: input.id, kind: input.kind, stage: "queued", parentId: input.parentId ?? null,
    scopeId: input.scopeId, executorId: input.executorId, payload: input.payload,
    createdAt: input.now, updatedAt: input.now, startedAt: null, finishedAt: null,
    progress: "", log: [], result: { report: null, ingest: null }, error: null,
  }
}

export function taskTransition(task: TaskProtocol, to: TaskStage, now: string): TaskProtocol {
  parseTime(now)
  if (!transitions[task.stage].includes(to))
    throw new Error(`Invalid task transition: ${task.stage} -> ${to}`)
  // research 的完成只要求报告；ingest 的完成只要求入库，二者不能混为一谈。
  if (to === "done" && (
    (task.kind === "research" && task.result.report === null) ||
    (task.kind === "ingest" && task.result.ingest === null)
  )) throw new Error(`Task result is incomplete for kind ${task.kind}`)
  return {
    ...task, stage: to, updatedAt: now,
    // 开始和结束时间只写一次，即使终态重复迁移也保留原值。
    startedAt: task.startedAt ?? (task.stage === "queued" && to === "running" ? now : null),
    finishedAt: task.finishedAt ?? (isTerminalStage(to) ? now : null),
  }
}

export function appendTaskLog(task: TaskProtocol, entry: TaskLogEntry): TaskProtocol {
  const at = parseTime(entry.at)
  const last = task.log[task.log.length - 1]
  // 日志时间单调不减（允许相等），附属日志不改变 updatedAt。
  if (last && at < parseTime(last.at)) throw new Error("Task log time must be non-decreasing")
  return { ...task, log: [...task.log, { ...entry }] }
}

export function recordTaskResult(task: TaskProtocol, patch: Partial<TaskResult>): TaskProtocol {
  // 只合并传入字段；已完成的报告不能退回 null。
  if (task.result.report !== null && patch.report === null)
    throw new Error("Completed task report cannot be cleared")
  return { ...task, result: { ...task.result, ...patch } }
}

export function failTask(task: TaskProtocol, error: TaskError, now: string): TaskProtocol {
  return { ...taskTransition(task, "failed", now), error: { ...error } }
}
