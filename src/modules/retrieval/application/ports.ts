import type { ChunkSearchResult, EmbeddingConfig, RetrievalFileNode } from "../domain"
export interface VectorIndexPort {
  upsert(input: { projectPath: string; pageId: string; chunks: Array<{ chunk_index: number; chunk_text: string; heading_path: string; embedding: number[] }> }): Promise<unknown>
  search(input: { projectPath: string; queryEmbedding: number[]; topK: number }): Promise<ChunkSearchResult[]>
  deletePage(input: { projectPath: string; pageId: string }): Promise<unknown>
  count(input: { projectPath: string }): Promise<number>
  clear(input: { projectPath: string }): Promise<unknown>
  optimize(input: { projectPath: string }): Promise<unknown>
  legacyCount(input: { projectPath: string }): Promise<number>
  dropLegacy(input: { projectPath: string }): Promise<unknown>
}
export interface EmbeddingModelPort {
  embed(text: string, config: EmbeddingConfig, maxRetries: number): Promise<number[]>
  embedBatch(texts: string[], config: EmbeddingConfig): Promise<number[][]>
}
export interface EmbeddingPorts {
  model: EmbeddingModelPort
  index: VectorIndexPort
  pages: { read(path: string): Promise<string>; list(path: string): Promise<RetrievalFileNode[]> }
  extractTitle(content: string, fallbackId: string): string
  clampConcurrency(value: number): number
  now(): number
  sleep(milliseconds: number): Promise<void>
  logger: Pick<Console, "log" | "warn">
}
