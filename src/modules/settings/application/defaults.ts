import type { LlmConfig, SearchApiConfig, MultimodalConfig, OutputLanguage, ProxyConfig, ScheduledImportConfig, SourceWatchConfig, MineruConfig, ApiConfig, GeneralConfig, ProviderConfigs, CustomLlmPreset, TaskModelRoutingConfig, ProjectLlmOverride } from "../domain"
import type { EmbeddingConfig } from "@/modules/retrieval/domain"
export interface DefaultSettings {
  llmConfig: LlmConfig; globalLlmConfig: LlmConfig; providerConfigs: ProviderConfigs
  customLlmPresets: CustomLlmPreset[]; activePresetId: string | null
  taskModelRouting: TaskModelRoutingConfig; projectLlmOverride: ProjectLlmOverride
  searchApiConfig: SearchApiConfig; embeddingConfig: EmbeddingConfig; multimodalConfig: MultimodalConfig
  outputLanguage: OutputLanguage; proxyConfig: ProxyConfig; scheduledImportConfig: ScheduledImportConfig
  sourceWatchConfig: SourceWatchConfig; sourceWatchAllProjects: boolean; mineruConfig: MineruConfig
  apiConfig: ApiConfig; generalConfig: GeneralConfig
}
export function createDefaultSettings(sourceWatch: SourceWatchConfig): DefaultSettings {
  return {
  llmConfig: {
    provider: "openai",
    apiKey: "",
    maxContextSize: 204800,
    model: "",
    ollamaUrl: "http://localhost:11434",
    customEndpoint: "",
    azureApiVersion: "2024-10-21",
    reasoning: { mode: "auto" },
    localCliIsolation: false,
  },
  globalLlmConfig: {
    provider: "openai",
    apiKey: "",
    maxContextSize: 204800,
    model: "",
    ollamaUrl: "http://localhost:11434",
    customEndpoint: "",
    azureApiVersion: "2024-10-21",
    reasoning: { mode: "auto" },
    localCliIsolation: false,
  },
  providerConfigs: {},
  customLlmPresets: [],
  activePresetId: null,
  taskModelRouting: {
    chatPresetId: null,
    ingestPresetId: null,
  },
  projectLlmOverride: {
    enabled: false,
    presetId: null,
    model: "",
    profile: undefined,
  },

  searchApiConfig: {
    provider: "none",
    apiKey: "",
    serpApiEngine: "google",
    searXngUrl: "",
    searXngCategories: ["general"],
    providerConfigs: {},
    deepResearchSource: "web",
    anyTxt: {
      enabled: false,
      endpoint: "http://127.0.0.1:9920",
      filterDir: "",
      filterExt: "*",
      limit: 20,
    },
  },

  embeddingConfig: {
    enabled: false,
    endpoint: "",
    apiKey: "",
    model: "",
  },

  multimodalConfig: {
    // Off by default — captioning is a non-trivial token spend
    // (one VLM call per extracted image), and silently turning it
    // on for every user the first time they import a PDF would be
    // a budget surprise. Users who want it flip the toggle in
    // Settings → Image captioning.
    enabled: false,
    useMainLlm: true,
    provider: "custom",
    apiKey: "",
    model: "",
    ollamaUrl: "http://localhost:11434",
    customEndpoint: "",
    azureApiVersion: "2024-10-21",
    apiMode: "chat_completions",
    concurrency: 4,
  },

  outputLanguage: "auto",

  proxyConfig: {
    enabled: false,
    url: "",
    bypassLocal: true,
    acceptInvalidCerts: false,
  },

  scheduledImportConfig: {
    enabled: false,
    path: "",
    interval: 60,
    lastScan: null,
  },

  sourceWatchConfig: { ...sourceWatch, includeExtensions: [...sourceWatch.includeExtensions], excludeExtensions: [...sourceWatch.excludeExtensions], excludeDirs: [...sourceWatch.excludeDirs], excludeGlobs: [...sourceWatch.excludeGlobs] },
  sourceWatchAllProjects: false,
  mineruConfig: {
    enabled: false,
    backend: "cloud",
    localEndpoint: "http://127.0.0.1:8000",
    localBackend: "hybrid-engine",
    localEffort: "medium",
    localParseMethod: "auto",
    localLanguage: "ch",
    localFormulaEnabled: true,
    localTableEnabled: true,
    localImageAnalysis: true,
    localServerUrl: "",
    token: "",
    modelVersion: "vlm",
  },

  // Default `enabled: true` preserves the pre-toggle behavior: anyone
  // who already had `LLM_WIKI_API_TOKEN` set or `apiConfig.token`
  // hand-edited keeps their working API. New users land in
  // "enabled + no token = 401 on every endpoint" — fail-closed by
  // virtue of the token being empty.
  apiConfig: {
    enabled: true,
    allowUnauthenticated: false,
    allowLanAccess: false,
    mcpEnabled: false,
    token: "",
  },

  generalConfig: {
    autostart: false,
    closeBehavior: "minimize",
  },

  }
}
