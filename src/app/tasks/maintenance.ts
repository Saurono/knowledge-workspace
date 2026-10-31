import { createTaskRuntime } from "@/modules/tasks"
import {
  createWikiCheckExecutor,
  WIKI_CHECK_EXECUTOR,
  type QualityFinding,
} from "@/modules/quality"
import { runStructuralLint, runSemanticLint } from "@/lib/lint"
import type { LintConfig } from "@/lib/lint-config"
import { hasUsableLlm } from "@/lib/has-usable-llm"
import { useWikiStore, type LlmConfig } from "@/stores/wiki-store"
import { useActivityStore } from "@/stores/activity-store"
/** Application wiring adapts the old lint engine and activity projection to module ports. */
const runtime = createTaskRuntime({
  isScopeCurrent: (path) => useWikiStore.getState().project?.path === path,
  onEvent: (task) =>
    useActivityStore.getState().updateItem(task.id, {
      status:
        task.status === "running" ? "running" : task.status === "succeeded" ? "done" : "error",
      detail: task.detail || "Reading wiki pages",
    }),
  onObserverError: (error) => console.warn("Maintenance activity projection failed", error),
})
runtime.register(
  WIKI_CHECK_EXECUTOR,
  createWikiCheckExecutor<LlmConfig>({
    structural: runStructuralLint,
    semantic: runSemanticLint,
    hasUsableModel: hasUsableLlm,
  }),
)
export const cancelMaintenanceTask = (id: string): void => runtime.cancel(id)
export const canCancelMaintenanceTask = (id: string): boolean => runtime.canCancel(id)
export const cancelAllMaintenanceTasks = (): void => runtime.cancelAll()
export async function runMaintenanceCheck(
  projectPath: string,
  config: LintConfig,
  semantic: boolean,
  model: LlmConfig,
): Promise<QualityFinding[] | null> {
  const id = useActivityStore
    .getState()
    .addItem({
      type: "lint",
      title: "Wiki check",
      status: "running",
      detail: "Reading wiki pages",
      filesWritten: [],
    })
  const result = await runtime.execute<unknown, QualityFinding[]>(
    WIKI_CHECK_EXECUTOR,
    { projectPath, config, semantic, model },
    { id, scopeId: projectPath },
  )
  return result.status === "succeeded" ? result.value : null
}
