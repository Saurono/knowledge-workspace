import { moveWikiProvenance } from "@/modules/wiki/domain"
import { moveSourceKey } from "@/modules/documents/domain"
import { normalizePath, isAbsolutePath } from "@/lib/path-utils"
import { loadIngestRecords, saveRecords, withRecordsLock } from "./repository"
import { documents } from "./documents"
const absoluteSource = (projectPath: string, path: string) =>
  isAbsolutePath(path)
    ? normalizePath(path)
    : `${normalizePath(projectPath)}/${normalizePath(path)}`

export async function registerObservedSourcePaths(
  projectPath: string,
  paths: readonly string[],
): Promise<void> {
  await documents.registerImportedSources(
    projectPath,
    paths.map((path) => {
      const key = absoluteSource(projectPath, path)
      return { sourcePath: key, originalPath: key }
    }),
  )
}
/** Aggregate coordination keeps Wiki references consistent with the source catalog. */
export async function migrateSourceMetadata(
  projectPath: string,
  from: string,
  to: string,
  pageMoves: ReadonlyMap<string, string> = new Map(),
): Promise<boolean> {
  return withRecordsLock(projectPath, async () => {
    const records = await loadIngestRecords(projectPath)
    const oldKey = absoluteSource(projectPath, from),
      newKey = absoluteSource(projectPath, to)
    let sources = records.sources
    const destination = sources[newKey], current = sources[oldKey]
    if (destination && current && destination.id !== current.id) {
      const hasHistory = Object.values(records.receipts).some(receipt => receipt.sourceId === destination.id)
      if (destination.originalPath?.replace(/\\/g, "/") !== newKey || destination.ingestedAt !== null || hasHistory)
        throw new Error("Cannot replace another source identity during a move")
      // A proven move can arrive after a watcher recorded its empty destination.
      // Remove that observation only here, where receipt history is available.
      sources = { ...sources }
      delete sources[newKey]
    }
    const catalog = moveSourceKey(sources, oldKey, newKey)
    if (catalog === records.sources) return false
    records.sources = catalog
    records.pages = moveWikiProvenance(records.pages, oldKey, newKey, pageMoves)
    // Receipts describe historical deliveries; never rewrite those payloads.
    await saveRecords(projectPath, records)
    return true
  })
}
