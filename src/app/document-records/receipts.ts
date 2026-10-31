import { createDirectory, fileExists, writeFileAtomic } from "@/commands/fs"
import { normalizePath, isAbsolutePath } from "@/lib/path-utils"
import { recordSourceIngested } from "@/modules/documents/domain"
import { loadIngestRecords, saveRecords, withRecordsLock } from "./repository"
import { RECEIPT_DIRECTORY } from "./snapshot"
export { loadIngestRecords } from "./repository"
export * from "./snapshot"
export { registerImportedSource } from "./documents"
export { hashContentRevision as hashReceiptRevision } from "@/modules/documents/application"
export async function configureObsidianVault(
  projectPath: string,
  vaultPath: string | null,
): Promise<void> {
  const normalized = vaultPath ? normalizePath(vaultPath).replace(/\/+$/, "") : null
  if (normalized && (!isAbsolutePath(normalized) || !(await fileExists(`${normalized}/.obsidian`))))
    throw new Error("Select an Obsidian Vault containing .obsidian")
  await withRecordsLock(projectPath, async () => {
    const records = await loadIngestRecords(projectPath)
    records.vaultPath = normalized
    await saveRecords(projectPath, records)
  })
}
export async function recordSuccessfulIngest(input: {
  projectPath: string
  taskId: string
  sourcePath: string
  revision: string
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
    for (const path of input.writtenPaths) {
      const normalized = normalizePath(path)
      const page = (records.pages[normalized] ??= {
        createdAt: input.createdPages[normalized] ?? null,
        sources: [],
      })
      if (!page.sources.includes(key)) page.sources.push(key)
    }
    const underVault = records.vaultPath && source.originalPath?.startsWith(`${records.vaultPath}/`)
    records.receipts[id] = {
      schemaVersion: 1,
      id,
      taskId: input.taskId,
      sourceId: source.id,
      sourcePath: key,
      originalPath: source.originalPath,
      sourceRevision: input.revision,
      sourceIngestedAt: source.ingestedAt,
      revisionIngestedAt: previous?.revisionIngestedAt ?? (input.cacheHit ? null : now),
      wikiResults: input.writtenPaths.map((path) => ({
        path,
        wikiCreatedAt: records.pages[normalizePath(path)]?.createdAt ?? null,
      })),
      status: "content_ingested",
      indexStatus: "unknown",
      recordedAt: now,
      delivery:
        previous?.delivery === "delivered" ? "delivered" : underVault ? "pending" : "not_connected",
      error: null,
    }
    await saveRecords(input.projectPath, records)
    return id
  })
}
export async function deliverObsidianReceipt(projectPath: string, id: string): Promise<void> {
  await withRecordsLock(projectPath, async () => {
    const records = await loadIngestRecords(projectPath)
    const receipt = records.receipts[id]
    if (!receipt || !records.vaultPath || receipt.delivery === "delivered") return
    // A connection change must never deliver another Vault's source paths.
    if (!receipt.originalPath?.startsWith(`${records.vaultPath}/`)) return
    try {
      if (!(await fileExists(`${records.vaultPath}/.obsidian`)))
        throw new Error("Obsidian Vault is unavailable")
      const directory = `${records.vaultPath}/${RECEIPT_DIRECTORY}`
      await createDirectory(directory)
      const { delivery: _delivery, error: _error, ...payload } = receipt
      await writeFileAtomic(
        `${directory}/${encodeURIComponent(receipt.id)}.json`,
        JSON.stringify(payload, null, 2),
      )
      receipt.delivery = "delivered"
      receipt.error = null
    } catch (error) {
      receipt.delivery = "pending"
      receipt.error = String(error)
    }
    await saveRecords(projectPath, records)
  })
}
