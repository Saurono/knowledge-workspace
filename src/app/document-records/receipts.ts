import { recordWikiProvenance } from "@/modules/wiki/domain"
import { normalizePath } from "@/lib/path-utils"
import { recordSourceIngested } from "@/modules/documents/domain"
import { loadIngestRecords, saveRecords, withRecordsLock } from "./repository"
import { makeIngestReceipt } from "@/modules/obsidian/domain"
export { loadIngestRecords } from "./repository"
export * from "./snapshot"
export { registerImportedSource, reserveImportedSource, confirmImportedSource, documents } from "./documents"
export { withRecordsLock } from "./repository"
export { hashContentRevision as hashReceiptRevision } from "@/modules/documents/application"
export { configureObsidianVault, deliverObsidianReceipt } from "@/app/obsidian/service"
export async function recordSuccessfulIngest(input: {
  projectPath: string
  taskId: string
  sourcePath: string
  revision: string
  idempotencyKey?: string
  idempotencyProjectId?: string
  writtenPaths: string[]
  createdPages: Record<string, string>
  cacheHit: boolean
}): Promise<string> {
  return withRecordsLock(input.projectPath, async () => {
    const records = await loadIngestRecords(input.projectPath)
    const key = normalizePath(input.sourcePath)
    const now = new Date().toISOString()
    // A legacy cache hit proves prior ingestion, but not its original time.
    const updated = recordSourceIngested(records.sources, key, {
      createId: () => crypto.randomUUID(),
      now,
      cacheHit: input.cacheHit,
    })
    records.sources = updated.catalog
    const source = updated.source
    const id = `${source.id}-${input.revision}`
    const previous = records.receipts[id]
    records.pages = recordWikiProvenance(records.pages, input.writtenPaths, key, input.createdPages)
    if (previous) {
      const merged = [...previous.wikiResults]
      for (const result of input.writtenPaths.map(path => ({ path, wikiCreatedAt: records.pages[normalizePath(path)]?.createdAt ?? null }))) {
        const index = merged.findIndex(item => normalizePath(item.path) === normalizePath(result.path))
        if (index < 0) merged.push(result)
        else if (merged[index].wikiCreatedAt === null) merged[index] = { ...merged[index], wikiCreatedAt: result.wikiCreatedAt }
      }
      records.receipts[id] = {
        ...previous,
        idempotencyKey: previous.idempotencyKey ?? input.idempotencyKey,
        idempotencyProjectId: previous.idempotencyProjectId ?? input.idempotencyProjectId,
        wikiResults: merged,
      }
      await saveRecords(input.projectPath, records)
      return id
    }
    records.receipts[id] = makeIngestReceipt({
      id, taskId: input.taskId, source, sourcePath: key, revision: input.revision,
      cacheHit: input.cacheHit, previous, recordedAt: now, vaultPath: records.vaultPath,
      idempotencyKey: input.idempotencyKey, idempotencyProjectId: input.idempotencyProjectId,
      wikiResults: input.writtenPaths.map(path => ({ path, wikiCreatedAt: records.pages[normalizePath(path)]?.createdAt ?? null })),
    })
    await saveRecords(input.projectPath, records)
    return id
  })
}
export { registerObservedSourcePaths, migrateSourceMetadata } from "./source-paths"
