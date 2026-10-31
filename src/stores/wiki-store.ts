import type { LlmConfig, SearchApiConfig, ProxyConfig, ScheduledImportConfig, ApiConfig, GeneralConfig, SourceWatchConfig, MineruConfig, MultimodalConfig, ProviderConfigs, CustomLlmPreset, TaskModelRoutingConfig, ProjectLlmOverride } from "@/modules/settings/domain"
export type { CustomApiMode, AzureModelFamily, ReasoningMode, ReasoningConfig, LlmConfig, SearchProvider, DeepResearchSource, SerpApiEngine, SearXngCategory, SearchProviderOverride, SearchProviderConfigs, AnyTxtConfig, SearchApiConfig, ProxyConfig, ScheduledImportConfig, ApiConfig, CloseBehavior, GeneralConfig, SourceWatchConfig, MineruModelVersion, MineruLocalBackend, MineruParseMethod, MineruEffort, MineruConfig, MultimodalConfig, ProviderOverride, ProviderConfigs, CustomLlmPreset, TaskModelRoutingConfig, ProjectLlmOverride } from "@/modules/settings/domain"
import { create } from "zustand"
import type { WikiProject, FileNode } from "@/types/wiki"
import { DEFAULT_SOURCE_WATCH_CONFIG } from "@/lib/source-watch-config"
import {
  buildProjectPathIndexFromTree,
  createEmptyProjectPathIndex,
  type ProjectPathIndex,
} from "@/lib/wiki-page-resolver"
import { DEFAULT_GRAPH_FILTERS, type GraphFilterState } from "@/lib/graph-filters"
import type { OutputLanguage } from "@/lib/output-language-options"

type EmbeddingConfig = import("@/modules/retrieval/domain").EmbeddingConfig

export type GraphColorMode = "type" | "community"

export interface GraphUiState {
  colorMode: GraphColorMode
  filters: GraphFilterState
  nodeScale: number
  graphSpacingDraft: number
}

export function createDefaultGraphUiState(): GraphUiState {
  return {
    colorMode: "type",
    filters: {
      ...DEFAULT_GRAPH_FILTERS,
      hiddenTypes: new Set(),
      hiddenNodeIds: new Set(),
    },
    nodeScale: 1,
    graphSpacingDraft: 1,
  }
}

export interface ExternalPreview {
  title: string
  path: string
  source: string
  url: string
  snippet: string
}

interface WikiState {
  project: WikiProject | null
  fileTree: FileNode[]
  /**
   * Lightweight lookup index derived from `fileTree`. Production code must
   * update fileTree through `setFileTree` so this stays in sync; direct
   * `useWikiStore.setState({ fileTree })` is only for tests that also reset or
   * do not read path resolution.
   */
  projectPathIndex: ProjectPathIndex
  selectedFile: string | null
  fileContent: string
  previewContentPath: string | null
  externalPreview: ExternalPreview | null
  /**
   * View that handed control to the full-width wiki preview. Closing the
   * preview must return there instead of leaving an empty wiki surface.
   * This is transient navigation state and must not be persisted.
   */
  previewReturnView: Exclude<WikiState["activeView"], "wiki"> | null
  previewBackStack: string[]
  previewForwardStack: string[]
  /**
   * One-shot scroll target for the markdown preview. When the user
   * clicks an image in search results and chooses "jump to source",
   * we set this to the image URL alongside `selectedFile`. The
   * markdown preview consumes it on its next render — finds the
   * `<img data-mdsrc="..."/>` whose attribute matches and scrolls
   * it into view, then clears this back to null so a stale target
   * doesn't fire on the NEXT page open.
   *
   * Match by raw URL (the literal `src` from the markdown) rather
   * than the resolved `convertFileSrc` URL — same image referenced
   * across two pages with different URL conventions (one absolute,
   * one wiki-relative) still works.
   */
  pendingScrollImageSrc: string | null
  activeView: "chat" | "wiki" | "sources" | "search" | "graph" | "lint" | "review" | "skills" | "settings" | "tasks" | "memories"
  llmConfig: LlmConfig
  /** Persisted global/default config, kept separate while a project override is effective. */
  globalLlmConfig: LlmConfig
  /** Per-provider-preset stored overrides (API key, model, endpoint, …). */
  providerConfigs: ProviderConfigs
  customLlmPresets: CustomLlmPreset[]
  /** Which preset is currently active. `null` = no LLM configured. */
  activePresetId: string | null
  taskModelRouting: TaskModelRoutingConfig
  projectLlmOverride: ProjectLlmOverride
  searchApiConfig: SearchApiConfig
  embeddingConfig: EmbeddingConfig
  multimodalConfig: MultimodalConfig
  outputLanguage: OutputLanguage
  proxyConfig: ProxyConfig
  scheduledImportConfig: ScheduledImportConfig
  sourceWatchConfig: SourceWatchConfig
  sourceWatchAllProjects: boolean
  mineruConfig: MineruConfig
  apiConfig: ApiConfig
  generalConfig: GeneralConfig
  graphUiState: GraphUiState
  dataVersion: number

  setProject: (project: WikiProject | null) => void
  setFileTree: (tree: FileNode[], options?: { syncPathIndex?: boolean }) => void
  setProjectPathIndexFromTree: (tree: FileNode[]) => void
  setSelectedFile: (path: string | null) => void
  setFileContent: (content: string) => void
  openPathInPreview: (path: string) => void
  openFileInPreview: (path: string, content: string) => void
  closePreview: () => void
  navigatePreviewBack: () => void
  navigatePreviewForward: () => void
  setExternalPreview: (preview: ExternalPreview | null) => void
  setPendingScrollImageSrc: (src: string | null) => void
  setActiveView: (view: WikiState["activeView"]) => void
  setLlmConfig: (config: LlmConfig) => void
  setGlobalLlmConfig: (config: LlmConfig) => void
  setProviderConfigs: (configs: ProviderConfigs) => void
  setCustomLlmPresets: (presets: CustomLlmPreset[]) => void
  setActivePresetId: (id: string | null) => void
  setTaskModelRouting: (config: TaskModelRoutingConfig) => void
  setProjectLlmOverride: (config: ProjectLlmOverride) => void
  setSearchApiConfig: (config: SearchApiConfig) => void
  setEmbeddingConfig: (config: EmbeddingConfig) => void
  setMultimodalConfig: (config: MultimodalConfig) => void
  setOutputLanguage: (lang: OutputLanguage) => void
  setProxyConfig: (config: ProxyConfig) => void
  setScheduledImportConfig: (config: ScheduledImportConfig) => void
  setSourceWatchConfig: (config: SourceWatchConfig) => void
  setSourceWatchAllProjects: (enabled: boolean) => void
  setMineruConfig: (config: MineruConfig) => void
  setApiConfig: (config: ApiConfig) => void
  setGeneralConfig: (config: GeneralConfig) => void
  setGraphUiState: (state: GraphUiState | ((current: GraphUiState) => GraphUiState)) => void
  resetGraphUiState: () => void
  bumpDataVersion: () => void
}

export const useWikiStore = create<WikiState>((set) => ({
  project: null,
  fileTree: [],
  projectPathIndex: createEmptyProjectPathIndex(),
  selectedFile: null,
  fileContent: "",
  previewContentPath: null,
  externalPreview: null,
  previewReturnView: null,
  previewBackStack: [],
  previewForwardStack: [],
  pendingScrollImageSrc: null,
  activeView: "wiki",
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

  dataVersion: 0,

  setProject: (project) => set({ project }),
  setFileTree: (fileTree, options) => {
    if (options?.syncPathIndex === false) {
      set({ fileTree })
      return
    }
    set({ fileTree, projectPathIndex: buildProjectPathIndexFromTree(fileTree) })
  },
  setProjectPathIndexFromTree: (tree) =>
    set({ projectPathIndex: buildProjectPathIndexFromTree(tree) }),
  setSelectedFile: (selectedFile) =>
    set((state) => ({
      selectedFile,
      previewContentPath: null,
      externalPreview: null,
      previewBackStack: selectedFile && state.selectedFile && !state.externalPreview && selectedFile !== state.selectedFile
        ? [...state.previewBackStack, state.selectedFile].slice(-50)
        : selectedFile ? state.previewBackStack : [],
      previewForwardStack: selectedFile && selectedFile !== state.selectedFile
        ? []
        : selectedFile ? state.previewForwardStack : [],
    })),
  setFileContent: (fileContent) => set({ fileContent }),
  openPathInPreview: (selectedFile) =>
    set((state) => ({
      selectedFile,
      previewContentPath: null,
      externalPreview: null,
      activeView: "wiki",
      previewReturnView:
        state.activeView === "wiki" ? state.previewReturnView : state.activeView,
      previewBackStack: state.selectedFile && !state.externalPreview && state.selectedFile !== selectedFile
        ? [...state.previewBackStack, state.selectedFile].slice(-50)
        : state.previewBackStack,
      previewForwardStack: state.selectedFile !== selectedFile ? [] : state.previewForwardStack,
    })),
  openFileInPreview: (selectedFile, fileContent) =>
    set((state) => ({
      selectedFile,
      fileContent,
      previewContentPath: selectedFile,
      externalPreview: null,
      activeView: "wiki",
      previewReturnView:
        state.activeView === "wiki" ? state.previewReturnView : state.activeView,
      previewBackStack: state.selectedFile && !state.externalPreview && state.selectedFile !== selectedFile
        ? [...state.previewBackStack, state.selectedFile].slice(-50)
        : state.previewBackStack,
      previewForwardStack: state.selectedFile !== selectedFile ? [] : state.previewForwardStack,
    })),
  closePreview: () =>
    set((state) => ({
      selectedFile: null,
      fileContent: "",
      previewContentPath: null,
      externalPreview: null,
      activeView: state.previewReturnView ?? "wiki",
      previewReturnView: null,
      previewBackStack: [],
      previewForwardStack: [],
    })),
  navigatePreviewBack: () =>
    set((state) => {
      const previous = state.previewBackStack[state.previewBackStack.length - 1]
      if (!previous || !state.selectedFile) return state
      return {
        selectedFile: previous,
        fileContent: "",
        previewContentPath: null,
        externalPreview: null,
        previewBackStack: state.previewBackStack.slice(0, -1),
        previewForwardStack: [...state.previewForwardStack, state.selectedFile].slice(-50),
      }
    }),
  navigatePreviewForward: () =>
    set((state) => {
      const next = state.previewForwardStack[state.previewForwardStack.length - 1]
      if (!next || !state.selectedFile) return state
      return {
        selectedFile: next,
        fileContent: "",
        previewContentPath: null,
        externalPreview: null,
        previewBackStack: [...state.previewBackStack, state.selectedFile].slice(-50),
        previewForwardStack: state.previewForwardStack.slice(0, -1),
      }
    }),
  setExternalPreview: (externalPreview) => set({ externalPreview }),
  setPendingScrollImageSrc: (pendingScrollImageSrc) => set({ pendingScrollImageSrc }),
  setActiveView: (activeView) => set({ activeView, previewReturnView: null }),
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

  sourceWatchConfig: DEFAULT_SOURCE_WATCH_CONFIG,
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

  graphUiState: createDefaultGraphUiState(),

  setLlmConfig: (llmConfig) => set({ llmConfig }),
  setGlobalLlmConfig: (globalLlmConfig) => set({ globalLlmConfig }),
  setProviderConfigs: (providerConfigs) => set({ providerConfigs }),
  setCustomLlmPresets: (customLlmPresets) => set({ customLlmPresets }),
  setActivePresetId: (activePresetId) => set({ activePresetId }),
  setTaskModelRouting: (taskModelRouting) => set({ taskModelRouting }),
  setProjectLlmOverride: (projectLlmOverride) => set({ projectLlmOverride }),
  setSearchApiConfig: (searchApiConfig) => set({ searchApiConfig }),
  setEmbeddingConfig: (embeddingConfig) => set({ embeddingConfig }),
  setMultimodalConfig: (multimodalConfig) => set({ multimodalConfig }),
  setOutputLanguage: (outputLanguage) => set({ outputLanguage }),
  setProxyConfig: (proxyConfig) => set({ proxyConfig }),
  setScheduledImportConfig: (scheduledImportConfig) => set({ scheduledImportConfig }),
  setSourceWatchConfig: (sourceWatchConfig) => set({ sourceWatchConfig }),
  setSourceWatchAllProjects: (sourceWatchAllProjects) => set({ sourceWatchAllProjects }),
  setMineruConfig: (mineruConfig) => set({ mineruConfig }),
  setApiConfig: (apiConfig) => set({ apiConfig }),
  setGeneralConfig: (generalConfig) => set({ generalConfig }),
  setGraphUiState: (graphUiState) =>
    set((state) => ({
      graphUiState: typeof graphUiState === "function"
        ? graphUiState(state.graphUiState)
        : graphUiState,
    })),
  resetGraphUiState: () => set({ graphUiState: createDefaultGraphUiState() }),
  bumpDataVersion: () => set((state) => ({ dataVersion: state.dataVersion + 1 })),
}))

export type { WikiState, EmbeddingConfig, OutputLanguage }
