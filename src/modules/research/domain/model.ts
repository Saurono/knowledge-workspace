export interface ResearchSource {
  title: string
  url: string
  snippet: string
  source: string
}
export interface ResearchBatchInput {
  topic: string
  searchQueries?: string[]
  sourceReviewId?: string
  rerunOfTaskId?: string
}

export interface ResearchTask {
  /** Optional only for tasks created before project scoping was added. */
  projectPath?: string
  id: string
  topic: string
  /** Review item that requested this research. It is resolved only after the
   * generated page has been written successfully. */
  sourceReviewId?: string
  rerunOfTaskId?: string
  searchQueries?: string[]
  status: "queued" | "searching" | "synthesizing" | "saving" | "done" | "error"
  webResults: ResearchSource[]
  synthesis: string
  savedPath: string | null
  error: string | null
  createdAt: number
}

const ACTIVE_RESEARCH_STATUSES = new Set<ResearchTask["status"]>([
  "queued",
  "searching",
  "synthesizing",
  "saving",
])

function researchLineageRoot(tasksById: ReadonlyMap<string, ResearchTask>, taskId: string): string {
  let current = taskId
  const visited = new Set<string>()
  while (!visited.has(current)) {
    visited.add(current)
    const parent = tasksById.get(current)?.rerunOfTaskId
    if (!parent) break
    current = parent
  }
  return current
}

export function hasActiveResearchRerun(tasks: readonly ResearchTask[], taskId: string): boolean {
  const tasksById = new Map(tasks.map((task) => [task.id, task]))
  const root = researchLineageRoot(tasksById, taskId)
  return tasks.some(
    (task) =>
      task.id !== taskId &&
      ACTIVE_RESEARCH_STATUSES.has(task.status) &&
      researchLineageRoot(tasksById, task.id) === root,
  )
}
