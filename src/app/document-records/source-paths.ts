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
    const catalog = moveSourceKey(records.sources, oldKey, newKey)
    if (catalog === records.sources) return false
    records.sources = catalog
    for (const page of Object.values(records.pages))
      page.sources = [...new Set(page.sources.map((key) => (key === oldKey ? newKey : key)))]
    for (const [oldPath, newPath] of pageMoves) {
      const old = records.pages[oldPath],
        next = records.pages[newPath]
      if (!old) continue
      records.pages[newPath] = {
        createdAt: old.createdAt ?? next?.createdAt ?? null,
        sources: [...new Set([...old.sources, ...(next?.sources ?? [])])],
      }
      delete records.pages[oldPath]
    }
    // Receipts describe historical deliveries; never rewrite those payloads.
    await saveRecords(projectPath, records)
    return true
  })
}
