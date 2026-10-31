export interface EmbeddingConfig {
  enabled: boolean
  endpoint: string // e.g. "http://127.0.0.1:1234/v1/embeddings"
  apiKey: string
  model: string // e.g. "text-embedding-qwen3-embedding-0.6b"
  /** Optional Gemini native `output_dimensionality` value. Ignored by OpenAI-compatible endpoints. */
  outputDimensionality?: number
  /**
   * Chunking knobs (Phase 1 RAG). Undefined values fall back to the
   * chunker's built-in defaults in `src/lib/text-chunker.ts`:
   *   targetChars   1000
   *   maxChars      1500
   *   minChars      200
   *   overlapChars  200
   *
   * Users on small-context endpoints (e.g. llama.cpp with n_ctx=512,
   * Ollama `mxbai-embed-large`) should lower `maxChunkChars` to avoid
   * per-request rejections; fetchEmbedding also auto-halves on
   * "too long" server errors as a second line of defence.
   */
  maxChunkChars?: number
  overlapChunkChars?: number
  /** Maximum embedding HTTP requests in flight. Defaults to 1 for compatibility. */
  concurrency?: number
  /** Texts per OpenAI-compatible embedding request. Defaults to 1. */
  batchSize?: number
  /**
   * Extra HTTP headers to send with every embedding request, e.g.
   *   { "X-Model-Provider-Id": "siliconflow" }
   * for gateways like mify that route by header. Reserved names
   * (Authorization, Content-Type, Host, Content-Length, x-goog-api-key)
   * are ignored — they're managed by the embedding client itself.
   */
  extraHeaders?: Record<string, string>
}

export interface ChunkUpsertInput {
  chunkIndex: number
  chunkText: string
  headingPath: string
  embedding: number[]
}

export interface ChunkSearchResult {
  chunk_id: string
  page_id: string
  chunk_index: number
  chunk_text: string
  heading_path: string
  score: number
}

export interface PageSearchResult {
  id: string
  score: number
  matchedChunks?: Array<{ text: string; headingPath: string; score: number }>
}

export type EmbeddingReindexState =
  | { kind: "idle" }
  | { kind: "running"; projectPath: string; done: number; total: number }
  | { kind: "done"; projectPath: string; count: number }
  | { kind: "error"; projectPath: string; message: string }


export interface RetrievalFileNode {
  name: string
  path: string
  is_dir: boolean
  children?: RetrievalFileNode[]
}
export const normalizeRetrievalPath = (path: string) => path.replace(/\\/g, "/")
