import { findLlmPreset } from "./presets"
import { resolveConfig } from "./preset-resolver"
import type {
  LlmConfig,
  ProjectLlmOverride,
  CustomLlmPreset,
  ProviderConfigs,
  TaskModelRoutingConfig,
} from "./model"

export type LlmTaskKind = "chat" | "ingest"

export function resolveProjectLlmConfig(
  globalConfig: LlmConfig,
  providerConfigs: ProviderConfigs,
  projectOverride: ProjectLlmOverride,
  customPresets: CustomLlmPreset[] = [],
): LlmConfig {
  // Keep this fallback contract aligned with project_llm_config in
  // src-tauri/src/api_server.rs. Native API/MCP callers resolve the same
  // persisted override without running this TypeScript code.
  if (!projectOverride.enabled || !projectOverride.presetId) return globalConfig
  const preset = findLlmPreset(projectOverride.presetId, customPresets)
  if (!preset) return globalConfig
  const baseOverride = providerConfigs[projectOverride.presetId]
  const override = projectOverride.model.trim()
    ? { ...baseOverride, model: projectOverride.model.trim() }
    : baseOverride
  return resolveConfig(preset, override, globalConfig)
}

export function projectLlmProfile(config: LlmConfig): Omit<LlmConfig, "apiKey" | "customHeaders"> {
  // Headers can contain gateway credentials, so keep them in the provider
  // credential record and merge them at runtime just like the API key.
  const { apiKey: _apiKey, customHeaders: _customHeaders, ...profile } = config
  return profile
}

/**
 * Resolve a task-specific provider from the current preset overrides.
 * Routing stores preset ids rather than credential snapshots so API-key,
 * endpoint, and model edits take effect immediately. Missing/deleted preset
 * ids fail safely to the active global configuration.
 */
export function resolveTaskLlmConfig(
  task: LlmTaskKind,
  fallback: LlmConfig,
  providerConfigs: ProviderConfigs,
  routing: TaskModelRoutingConfig,
  projectOverride?: ProjectLlmOverride,
  customPresets: CustomLlmPreset[] = [],
): LlmConfig {
  if (projectOverride?.enabled) return fallback
  const presetId = task === "chat" ? routing.chatPresetId : routing.ingestPresetId
  if (!presetId) return fallback
  const preset = findLlmPreset(presetId, customPresets)
  if (!preset) return fallback
  return resolveConfig(preset, providerConfigs[presetId], fallback)
}
