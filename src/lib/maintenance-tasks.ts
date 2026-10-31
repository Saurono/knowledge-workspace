import { runStructuralLint, runSemanticLint, type LintResult } from "@/lib/lint"
import type { LintConfig } from "@/lib/lint-config"
import type { LlmConfig } from "@/stores/wiki-store"
import { useWikiStore } from "@/stores/wiki-store"
import { useActivityStore } from "@/stores/activity-store"
import { hasUsableLlm } from "@/lib/has-usable-llm"

const controllers = new Map<string, AbortController>()
export function cancelMaintenanceTask(id: string): void {
  controllers.get(id)?.abort()
}
export function canCancelMaintenanceTask(id: string): boolean {
  return controllers.has(id)
}
export function cancelAllMaintenanceTasks(): void {
  for (const controller of controllers.values()) controller.abort()
}

export async function runMaintenanceCheck(
  projectPath: string,
  config: LintConfig,
  semantic: boolean,
  llmConfig: LlmConfig,
): Promise<LintResult[] | null> {
  const activity = useActivityStore.getState()
  const id = activity.addItem({
    type: "lint",
    title: "Wiki check",
    status: "running",
    detail: "Reading wiki pages",
    filesWritten: [],
  })
  const controller = new AbortController()
  controllers.set(id, controller)
  const isCurrent = () => useWikiStore.getState().project?.path === projectPath
  try {
    const structural = await runStructuralLint(projectPath, {
      config,
      signal: controller.signal,
      onProgress: (done, total) =>
        activity.updateItem(id, { detail: `Structural check: ${done}/${total}` }),
    })
    if (controller.signal.aborted || !isCurrent()) throw new DOMException("Cancelled", "AbortError")
    const semanticResults =
      semantic && hasUsableLlm(llmConfig)
        ? await runSemanticLint(projectPath, llmConfig, controller.signal, id)
        : []
    if (controller.signal.aborted || !isCurrent()) throw new DOMException("Cancelled", "AbortError")
    const results = [...structural, ...semanticResults]
    activity.updateItem(id, { status: "done", detail: `${results.length} findings` })
    return results
  } catch (error) {
    activity.updateItem(id, {
      status: "error",
      detail: controller.signal.aborted ? "Cancelled" : String(error),
    })
    if (!controller.signal.aborted && isCurrent()) throw error
    return null
  } finally {
    controllers.delete(id)
  }
}
