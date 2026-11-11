import { createEmbeddingService } from "@/modules/retrieval/application"
import { parseFrontmatter } from "@/lib/frontmatter"
import { nativeEmbeddingPorts } from "./native-ports"
import { createMeteredEmbeddingModel } from "./metered-embedding"
import { useWikiStore } from "@/stores/wiki-store"
export function extractEmbeddingTitle(content: string, fallbackId: string): string {
  const title = parseFrontmatter(content).frontmatter?.title
  return typeof title === "string" && title.trim() ? title.trim() : fallbackId
}
export const embeddingService = createEmbeddingService({ ...nativeEmbeddingPorts, model: createMeteredEmbeddingModel(() => useWikiStore.getState().project?.path ?? null, "embedding"), extractTitle: extractEmbeddingTitle })
export const {
  getLastEmbeddingError, resetEmbeddingOptimizeAccountingForTests, fetchEmbedding,
  legacyVectorRowCount, dropLegacyVectorTable, clearChunkVectorTable, embedPage,
  getEmbeddingReindexState, subscribeEmbeddingReindexState, embedAllPages,
  searchByEmbedding, removePageEmbedding, getEmbeddingCount,
} = embeddingService
