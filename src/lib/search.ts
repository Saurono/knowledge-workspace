/** Compatibility entrypoint; ranking stays in the shared backend index. */
export { searchWiki, retrieveWikiEvidence } from "@/app/retrieval/search"
export { tokenizeQuery } from "@/modules/retrieval/domain"
export type { ImageRef, SearchResult } from "@/modules/retrieval/domain"
