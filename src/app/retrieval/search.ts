import { invoke } from "@tauri-apps/api/core"
import { useWikiStore } from "@/stores/wiki-store"
import { createRetrievalService, type RetrievalOptions } from "@/modules/retrieval/application"
import type { BackendSearchResponse } from "@/modules/retrieval/domain"
export const retrievalService = createRetrievalService({
  search: input => invoke<BackendSearchResponse>("search_project", { ...input }),
})
const configured = (options: Omit<RetrievalOptions, "embeddingConfig">) => ({
  ...options,
  embeddingConfig: options.localOnly ? null : { ...useWikiStore.getState().embeddingConfig },
})
export async function searchWiki(projectPath: string, query: string, options: Omit<RetrievalOptions, "embeddingConfig"> = {}) {
  return (await retrievalService.search(projectPath, query, configured(options))).results
}
export async function retrieveWikiEvidence(projectPath: string, query: string, options: Omit<RetrievalOptions, "embeddingConfig"> = {}) {
  return (await retrievalService.evidence(projectPath, query, configured(options))).evidence
}
