import { normalizeRetrievalPath } from "../domain"
import type { BackendSearchResponse, EmbeddingConfig, RetrievalEvidence } from "../domain"
export interface SearchIndexRequest {
  projectPath: string
  query: string
  topK: number
  includeContent: boolean
  queryEmbedding: number[] | null
  embeddingConfig: EmbeddingConfig | null
}
/** The backend owns keyword/vector/graph fusion and ranking; no duplicated scoring here. */
export interface ProjectSearchIndex {
  search(input: SearchIndexRequest): Promise<BackendSearchResponse>
}
export interface RetrievalOptions {
  localOnly?: boolean
  embeddingConfig?: EmbeddingConfig | null
  topK?: number
  signal?: AbortSignal
}
const empty = (): BackendSearchResponse => ({ mode: "keyword", results: [], tokenHits: 0, vectorHits: 0 })
function check(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Retrieval cancelled", "AbortError")
}
function topK(value = 20) {
  return Number.isFinite(value) ? Math.max(1, Math.min(100, Math.floor(value))) : 20
}
function relativeResultPath(path: string) {
  const normalized = normalizeRetrievalPath(path).replace(/^\/+/, "")
  if (!normalized || normalized.includes("\0") || normalized.includes(":") || normalized.split("/").some(part => !part || part === "." || part === ".."))
    throw new Error("Invalid project-relative search result path")
  return normalized
}
export function createRetrievalService(index: ProjectSearchIndex) {
  const run = async (projectPath: string, query: string, options: RetrievalOptions, includeContent: boolean) => {
    check(options.signal)
    if (!query.trim()) return empty()
    const project = normalizeRetrievalPath(projectPath).replace(/\/+$/, "")
    const response = await index.search({
      projectPath: project,
      query,
      topK: topK(options.topK),
      includeContent,
      queryEmbedding: null,
      // Local keyword retrieval never sends provider configuration to the index.
      embeddingConfig: options.localOnly ? null : options.embeddingConfig ?? null,
    })
    check(options.signal) // Native I/O may finish, but cancelled results never reach the caller.
    return {
      ...response,
      results: response.results.map(result => ({ ...result, path: `${project}/${relativeResultPath(result.path)}` })),
    }
  }
  return {
    search: (projectPath: string, query: string, options: RetrievalOptions = {}) => run(projectPath, query, options, false),
    evidence: async (projectPath: string, query: string, options: RetrievalOptions & { maxChars?: number; perPageChars?: number } = {}) => {
      const response = await run(projectPath, query, { ...options, topK: options.topK ?? 5 }, true)
      let remaining = Number.isFinite(options.maxChars) ? Math.max(0, Math.floor(options.maxChars!)) : 8000
      const perPage = Number.isFinite(options.perPageChars) ? Math.max(0, Math.floor(options.perPageChars!)) : 2000
      const evidence: RetrievalEvidence[] = []
      for (const result of response.results) {
        if (remaining <= 0) break
        const text = (result.content?.trim() || result.snippet.trim()).slice(0, Math.min(perPage, remaining))
        if (!text) continue
        remaining -= text.length
        // Keep only the bounded excerpt, never an unbounded body in the prompt payload.
        evidence.push({ ...result, content: undefined, citation: evidence.length + 1, text })
      }
      return { ...response, evidence }
    },
  }
}
