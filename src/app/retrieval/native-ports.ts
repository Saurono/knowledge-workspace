import { invoke } from "@tauri-apps/api/core"
import { readFile, listDirectory } from "@/commands/fs"
import { clampUserConcurrency } from "@/lib/concurrency-limits"
import type { EmbeddingPorts } from "@/modules/retrieval/application"
/** Native provider HTTP and LanceDB transport; no ranking or rebuild decisions here. */
export const nativeEmbeddingPorts: Omit<EmbeddingPorts, "extractTitle"> = {
  model: {
    embed: (text, cfg, maxRetries) => invoke("embedding_fetch", { text, cfg, maxRetries }),
    embedBatch: (texts, cfg) => invoke("embedding_fetch_batch", { texts, cfg }),
  },
  index: {
    upsert: input => invoke("vector_upsert_chunks", input),
    search: input => invoke("vector_search_chunks", input),
    deletePage: input => invoke("vector_delete_page", input),
    count: input => invoke("vector_count_chunks", input),
    clear: input => invoke("vector_clear_chunks", input),
    optimize: input => invoke("vector_optimize_chunks", input),
    legacyCount: input => invoke("vector_legacy_row_count", input),
    dropLegacy: input => invoke("vector_drop_legacy", input),
  },
  pages: { read: path => readFile(path), list: path => listDirectory(path) },
  clampConcurrency: clampUserConcurrency,
  now: () => performance.now(),
  sleep: milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
  logger: console,
}
