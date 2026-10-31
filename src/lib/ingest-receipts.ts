import { createDirectory, fileExists, readFile, writeFileAtomic } from "@/commands/fs"
import { isAbsolutePath, normalizePath } from "@/lib/path-utils"
import { withProjectLock } from "@/lib/project-mutex"

export const RECEIPT_DIRECTORY = "kb-ingest-records"
export interface SourceProvenance {
  id: string
  originalPath: string | null
  receivedAt: string | null
  ingestedAt: string | null
}
export interface WikiProvenance {
  createdAt: string | null
  sources: string[]
}
export interface IngestReceipt {
  schemaVersion: 1
  id: string
  taskId: string
  sourceId: string
  sourcePath: string
  originalPath: string | null
  sourceRevision: string
  sourceIngestedAt: string | null
  revisionIngestedAt: string | null
  wikiResults: { path: string; wikiCreatedAt: string | null }[]
  recordedAt: string
  status: "content_ingested"
  indexStatus: "unknown"
  delivery: "not_connected" | "pending" | "delivered"
  error: string | null
}
export interface IngestRecords {
  version: 1
  vaultPath: string | null
  sources: Record<string, SourceProvenance>
  pages: Record<string, WikiProvenance>
  receipts: Record<string, IngestReceipt>
}
const emptyRecords = (): IngestRecords => ({
  version: 1,
  vaultPath: null,
  sources: {},
  pages: {},
  receipts: {},
})
const recordPath = (path: string) => `${normalizePath(path)}/.llm-wiki/ingest-records.json`
export async function loadIngestRecords(projectPath: string): Promise<IngestRecords> {
  if (!(await fileExists(recordPath(projectPath)))) return emptyRecords()
  const value = JSON.parse(await readFile(recordPath(projectPath))) as IngestRecords
  const record = (input: unknown) =>
    input !== null && typeof input === "object" && !Array.isArray(input)
  if (
    value.version !== 1 ||
    !record(value.sources) ||
    !record(value.pages) ||
    !record(value.receipts) ||
    (value.vaultPath !== null && typeof value.vaultPath !== "string")
  )
    throw new Error("Invalid ingest records; original file preserved")
  return value
}
async function saveRecords(path: string, records: IngestRecords) {
  await createDirectory(`${normalizePath(path)}/.llm-wiki`)
  await writeFileAtomic(recordPath(path), JSON.stringify(records, null, 2))
}
export async function configureObsidianVault(
  projectPath: string,
  vaultPath: string | null,
): Promise<void> {
  const normalized = vaultPath ? normalizePath(vaultPath).replace(/\/+$/, "") : null
  if (normalized && (!isAbsolutePath(normalized) || !(await fileExists(`${normalized}/.obsidian`))))
    throw new Error("Select an Obsidian Vault containing .obsidian")
  await withProjectLock(`${projectPath}\0ingest-records`, async () => {
    const records = await loadIngestRecords(projectPath)
    records.vaultPath = normalized
    await saveRecords(projectPath, records)
  })
}
export async function registerImportedSource(
  projectPath: string,
  sourcePath: string,
  originalPath: string,
): Promise<void> {
  const key = normalizePath(sourcePath)
  await withProjectLock(`${projectPath}\0ingest-records`, async () => {
    const records = await loadIngestRecords(projectPath)
    records.sources[key] ??= {
      id: crypto.randomUUID(),
      originalPath: normalizePath(originalPath),
      receivedAt: new Date().toISOString(),
      ingestedAt: null,
    }
    await saveRecords(projectPath, records)
  })
}
export async function hashReceiptRevision(content: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content))
  return [...new Uint8Array(hash)].map((n) => n.toString(16).padStart(2, "0")).join("")
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
  return withProjectLock(`${input.projectPath}\0ingest-records`, async () => {
    const records = await loadIngestRecords(input.projectPath)
    const key = normalizePath(input.sourcePath)
    const now = new Date().toISOString()
    // A legacy cache hit proves prior ingestion, but not its original time.
    const source = (records.sources[key] ??= {
      id: crypto.randomUUID(),
      originalPath: null,
      receivedAt: null,
      ingestedAt: null,
    })
    if (!input.cacheHit) source.ingestedAt ??= now
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
  await withProjectLock(`${projectPath}\0ingest-records`, async () => {
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
