import { createIndexConsistency, type IndexConsistencyPorts } from "./index-consistency"
import type { EmbeddingConfig } from "@/modules/retrieval/domain"

/** Uses the same VerifiedPageIndexPort commit/verify contract as ingest, without recompiling Markdown. */
export async function rebuildIndex<T>(projectPath: string, config: EmbeddingConfig, ports: IndexConsistencyPorts<T>) {
  const index = createIndexConsistency(projectPath, config, ports)
  await index.startup()
  await index.rebuild()
  return index
}
