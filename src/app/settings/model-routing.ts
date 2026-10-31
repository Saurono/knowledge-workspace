import { useWikiStore } from "@/stores/wiki-store"
import { resolveTaskLlmConfig } from "@/modules/settings/domain"
import type { LlmTaskKind, LlmConfig } from "@/modules/settings/domain"
/** Resolve against one atomic Zustand snapshot for imperative/background code. */
export function getTaskLlmConfig(task: LlmTaskKind, fallback?: LlmConfig): LlmConfig {
  const state = useWikiStore.getState()
  return resolveTaskLlmConfig(
    task,
    fallback ?? state.llmConfig,
    state.providerConfigs,
    state.taskModelRouting,
    state.projectLlmOverride,
    state.customLlmPresets,
  )
}
