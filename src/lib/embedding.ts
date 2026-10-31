/** Compatibility entrypoint; application composition owns native adapters. */
export * from "@/app/retrieval/embedding"
export { looksLikeOversizeError, wikiPageIdFromPath } from "@/modules/retrieval/domain"
export type { PageSearchResult, EmbeddingReindexState } from "@/modules/retrieval/domain"
