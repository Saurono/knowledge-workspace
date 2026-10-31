/**
 * Wire protocol used when `provider === "custom"`. Other providers have a
 * fixed protocol (openai → OpenAI chat; anthropic → Anthropic messages;
 * etc.), so this field is ignored for them. `undefined` defaults to
 * `chat_completions` for backward compatibility with pre-0.3.7 configs.
 */
export type CustomApiMode = "chat_completions" | "anthropic_messages"
export type AzureModelFamily = "auto" | "gpt5"
export type ReasoningMode = "auto" | "off" | "low" | "medium" | "high" | "max" | "custom"

export interface ReasoningConfig {
  mode: ReasoningMode
  budgetTokens?: number
}

export interface LlmConfig {
  provider: "openai" | "anthropic" | "google" | "azure" | "ollama" | "custom" | "minimax" | "claude-code" | "codex-cli"
  apiKey: string
  model: string
  ollamaUrl: string
  customEndpoint: string
  azureApiVersion?: string
  azureModelFamily?: AzureModelFamily
  maxContextSize: number // max context window in characters
  apiMode?: CustomApiMode
  reasoning?: ReasoningConfig
  /**
   * Reasoning for ingest's structured calls (analysis, page generation,
   * captioning, dedup), kept separate from `reasoning` because the two want
   * opposite things: chat benefits from thinking, whereas ingest asks for
   * structured output thousands of times and a model that spends its budget on
   * chain-of-thought can end the stream with empty `content` — a lost page.
   * Defaults to "off", which is what ingest hardcoded before this was settable.
   */
  ingestReasoning?: ReasoningConfig
  /**
   * Local CLI providers only. When true, LLM Wiki asks Claude/Codex CLI
   * to ignore user-level rules/config/MCP/tool state where the CLI exposes
   * such controls. Default false preserves existing advanced-user setups.
   */
  localCliIsolation?: boolean
  /** Codex CLI provider only. Overall subprocess timeout in minutes. */
  codexCliTimeoutMinutes?: number
  /** HTTP LLM request backstop. Defaults to 30 minutes for legacy configs. */
  requestTimeoutMinutes?: number
  /** Defaults to true. HTTP providers use a non-streaming wire when false. */
  streamingEnabled?: boolean
  /** Optional headers added to every HTTP request for this provider preset. */
  customHeaders?: Record<string, string>
  /** Optional provider-specific fields merged into custom OpenAI-compatible request bodies. */
  extraRequestBody?: Record<string, unknown>
}

export type SearchProvider =
  | "tavily"
  | "serpapi"
  | "searxng"
  | "ollama"
  | "brave"
  | "bocha"
  | "firecrawl"
  | "none"
export type DeepResearchSource = "web" | "anytxt" | "both"
export type SerpApiEngine =
  | "google"
  | "google_news"
  | "google_scholar"
  | "google_patents"
  | "bing"
  | "duckduckgo"
  | "google_images"
  | "google_videos"
  | "youtube"
  | string
export type SearXngCategory =
  | "general"
  | "news"
  | "science"
  | "it"
  | "images"
  | "videos"
  | "files"
  | "map"
  | "music"
  | "social media"
  | string

export interface SearchProviderOverride {
  apiKey?: string
  baseUrl?: string
  serpApiEngine?: SerpApiEngine
  searXngUrl?: string
  searXngCategories?: SearXngCategory[]
  ollamaUrl?: string
}

export type SearchProviderConfigs = Partial<Record<Exclude<SearchProvider, "none">, SearchProviderOverride>>

export interface AnyTxtConfig {
  enabled?: boolean
  endpoint?: string
  filterDir?: string
  filterExt?: string
  limit?: number
}

export interface SearchApiConfig {
  provider: SearchProvider
  apiKey: string
  serpApiEngine?: SerpApiEngine
  searXngUrl?: string
  searXngCategories?: SearXngCategory[]
  ollamaUrl?: string
  providerConfigs?: SearchProviderConfigs
  deepResearchSource?: DeepResearchSource
  anyTxt?: AnyTxtConfig
}



/**
 * Image-captioning settings (Phase 4 of the multimodal-images plan).
 *
 * Decoupled from `llmConfig` because vision-capable endpoints are
 * usually NOT the same model the user picks for analysis/generation:
 * - the analysis stage often goes to a strong text-only model (Claude
 *   Sonnet, DeepSeek, etc.) that doesn't speak vision at all;
 * - captioning is happy with a small local VL model (Qwen2.5-VL-7B,
 *   LLaVA-1.6) that costs near-zero per call.
 *
 * `enabled` is the master gate. When false the caption pipeline is
 * skipped entirely — `read_file`'s extracted images still appear
 * inline (with empty alt text) and the safety-net `## Embedded
 * Images` section still gets written, but we never touch the LLM.
 *
 * `useMainLlm`: when true (the default for first-time users we
 * onboard), captioning calls go through the same `llmConfig`
 * everything else uses. When false, the dedicated fields below are
 * sent through the same provider machinery — same `streamChat`,
 * same `getProviderConfig`, no duplicate code.
 *
 * `concurrency` bounds parallel caption requests during ingest.
 * 30-image PDFs with sequential captioning at ~10s/image (a Qwen3
 * thinking model on consumer GPU) take 5 minutes. At concurrency=4
 * that drops to ~75s. Higher values are available for hosted or
 * multi-GPU endpoints that can sustain broader parallelism.
 */
/**
 * Global outbound HTTP proxy. When `enabled` and `url` is a valid
 * http(s) URL, the Rust setup hook reads this on app launch and
 * sets HTTP_PROXY / HTTPS_PROXY / NO_PROXY env vars before the
 * reqwest client used by tauri-plugin-http is constructed. Changes
 * apply on app restart only.
 */
export interface ProxyConfig {
  enabled: boolean
  url: string
  bypassLocal: boolean
  acceptInvalidCerts?: boolean
}

export interface ScheduledImportConfig {
  enabled: boolean
  path: string // 监控目录的相对路径（相对于项目根目录），空字符串表示使用默认的 "raw"
  interval: number // 扫描间隔（分钟）
  lastScan: number | null // 上次扫描时间戳
}

/**
 * Local HTTP API server config. Read by the Rust `api_server` module on
 * every request via `load_app_state` (5s cache). The Rust side is the
 * source of truth at request time; this struct is the persisted form
 * the UI edits.
 *
 *   - `enabled` gates all non-/health endpoints. Default `true` so an
 *     env-token-only setup keeps working after the toggle is added.
 *   - `allowUnauthenticated` lets local agents call the API without a
 *     token. It is explicit and default-off.
 *   - `allowLanAccess` binds the API and clip server to 0.0.0.0 on
 *     app startup so trusted LAN devices can reach them. Default-off.
 *   - `mcpEnabled` allows the optional MCP stdio server to use this
 *     API. It is separate from the HTTP API kill-switch so users can
 *     expose scripts while keeping MCP disabled.
 *   - `token` is the bearer secret. Empty + auth required =
 *     every non-/health request returns 401. The env var
 *     `LLM_WIKI_API_TOKEN` overrides this field at the backend.
 */
export interface ApiConfig {
  enabled: boolean
  allowUnauthenticated: boolean
  allowLanAccess: boolean
  mcpEnabled: boolean
  token: string
}

export type CloseBehavior = "ask" | "minimize" | "exit"

export interface GeneralConfig {
  autostart: boolean
  closeBehavior: CloseBehavior
}

export interface SourceWatchConfig {
  enabled: boolean
  autoIngest: boolean
  /** Keep extractor output in raw/parsed in addition to the internal cache. */
  persistExtractedMarkdown: boolean
  /** Maximum number of source text extraction jobs allowed at once. */
  parsingConcurrency: number
  /** Maximum number of ingest tasks allowed to prepare concurrently. */
  ingestConcurrency: number
  includeExtensions: string[]
  excludeExtensions: string[]
  excludeDirs: string[]
  excludeGlobs: string[]
  maxFileSizeMb: number
}

export type MineruModelVersion = "pipeline" | "vlm"
export type MineruLocalBackend =
  | "pipeline"
  | "vlm-engine"
  | "hybrid-engine"
  | "vlm-http-client"
  | "hybrid-http-client"
export type MineruParseMethod = "auto" | "txt" | "ocr"
export type MineruEffort = "medium" | "high"

export interface MineruConfig {
  enabled: boolean
  /** Parsing backend: MinerU cloud API (default) or a self-hosted local service. */
  backend?: "cloud" | "local"
  /** Base URL of a compatible self-hosted MinerU HTTP wrapper. */
  localEndpoint?: string
  /** Optional Bearer token used only for the self-hosted MinerU service. */
  localToken?: string
  localBackend?: MineruLocalBackend
  localEffort?: MineruEffort
  localParseMethod?: MineruParseMethod
  localLanguage?: string
  localFormulaEnabled?: boolean
  localTableEnabled?: boolean
  localImageAnalysis?: boolean
  localServerUrl?: string
  token: string
  modelVersion: MineruModelVersion
}

export interface MultimodalConfig {
  enabled: boolean
  /** Reuse `llmConfig` for caption calls. When true, the fields
   *  below are ignored. */
  useMainLlm: boolean
  provider: LlmConfig["provider"]
  apiKey: string
  model: string
  ollamaUrl: string
  customEndpoint: string
  azureApiVersion?: string
  azureModelFamily?: AzureModelFamily
  apiMode?: CustomApiMode
  /** Max parallel caption requests during ingest. >=1. */
  concurrency: number
}

/**
 * Per-preset saved fields. Each entry survives turning the preset off
 * and coming back — users don't have to re-enter an API key when they
 * briefly switch to a different provider.
 */
export interface ProviderOverride {
  apiKey?: string
  model?: string
  baseUrl?: string           // customEndpoint for custom presets, ollamaUrl for ollama
  azureApiVersion?: string
  azureModelFamily?: AzureModelFamily
  apiMode?: CustomApiMode
  maxContextSize?: number
  reasoning?: ReasoningConfig
  /** Reasoning used by structured ingest calls; defaults to off. */
  ingestReasoning?: ReasoningConfig
  localCliIsolation?: boolean
  codexCliTimeoutMinutes?: number
  requestTimeoutMinutes?: number
  streamingEnabled?: boolean
  customHeaders?: Record<string, string>
  extraRequestBody?: Record<string, unknown>
}

export type ProviderConfigs = Record<string, ProviderOverride>

export interface CustomLlmPreset {
  id: string
  label: string
}

export interface TaskModelRoutingConfig {
  /** Null keeps chat on the globally active provider preset. */
  chatPresetId: string | null
  /** Null keeps ingest on the globally active provider preset. */
  ingestPresetId: string | null
}

export interface ProjectLlmOverride {
  enabled: boolean
  presetId: string | null
  /** Empty uses the selected preset/global provider model. */
  model: string
  /**
   * Resolved provider metadata for native/API callers. The API key is
   * deliberately omitted: Rust merges the current credential from
   * providerConfigs[presetId], so rotating a key never requires rewriting
   * every project override and credentials are not duplicated per project.
   */
  profile?: Omit<LlmConfig, "apiKey" | "customHeaders">
}
export interface PersistedUpdateCheckState {
  enabled: boolean
  lastCheckedAt: number | null
  dismissedVersion: string | null
}
