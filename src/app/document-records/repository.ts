import { createDirectory, fileExists, readFile, writeFileAtomic } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import { withProjectLock } from "@/lib/project-mutex"
import type { IngestRecords } from "./snapshot"
import { isCanonicalIngestionIdempotencyKey } from "@/modules/ingestion/domain"
import { isWikiProvenance } from "@/modules/wiki/domain"
export const withRecordsLock = <T>(path: string, operation: () => Promise<T>) =>
  withProjectLock(`${normalizePath(path)}\0ingest-records`, operation)
export const emptyRecords = (): IngestRecords => ({
  version: 1,
  projectRootPath: undefined,
  vaultPath: null,
  sources: {},
  pages: {},
  receipts: {},
})
function occurrences(value: string, search: string): number[] {
  const positions: number[] = []
  let from = 0
  while (true) { const found = value.toLowerCase().indexOf(search, from); if (found < 0) return positions; positions.push(found); from = found + search.length }
}
function rebaseProjectSourcePath(projectPath: string, storedRoot: string | undefined, sourcePath: string): string {
  const root = normalizePath(projectPath).replace(/\/+$/, "")
  const normalized = normalizePath(sourcePath)
  const currentPrefix = `${root}/raw/sources/`
  if (normalized.toLowerCase().startsWith(currentPrefix.toLowerCase())) return normalized
  const marker = "/raw/sources/"
  let oldRoot = storedRoot ? normalizePath(storedRoot).replace(/\/+$/, "") : undefined
  if (!oldRoot) {
    const found = occurrences(normalized, marker)
    if (found.length > 1) throw new Error("Cannot safely rebase legacy source path with ambiguous raw/sources markers; original file preserved")
    if (found.length === 1) oldRoot = normalized.slice(0, found[0])
  }
  if (!oldRoot || root.toLowerCase() === oldRoot.toLowerCase()) return normalized
  const oldPrefix = `${oldRoot}/raw/sources/`
  if (!normalized.toLowerCase().startsWith(oldPrefix.toLowerCase())) return normalized
  return `${root}${normalized.slice(oldRoot.length)}`
}
const recordPath = (path: string) => `${normalizePath(path)}/.llm-wiki/ingest-records.json`
export async function loadIngestRecords(projectPath: string): Promise<IngestRecords> {
  if (!(await fileExists(recordPath(projectPath)))) return emptyRecords()
  const value = JSON.parse(await readFile(recordPath(projectPath))) as IngestRecords
  const record = (input: unknown) =>
    input !== null && typeof input === "object" && !Array.isArray(input)
  const validSources = record(value.sources) && Object.entries(value.sources).every(([path, source]) => {
    if (!path || path.includes("\\") || !record(source)) return false
    const item = source as unknown as Record<string, unknown>
    return typeof item.id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(item.id) &&
      (item.sourceKind === undefined || ["generated-wiki", "raw", "unknown"].includes(String(item.sourceKind))) &&
      (item.originalPath === null || typeof item.originalPath === "string") &&
      (item.receivedAt === null || typeof item.receivedAt === "string") &&
      (item.ingestedAt === null || typeof item.ingestedAt === "string") &&
      (item.contentRevision === undefined || item.contentRevision === null || typeof item.contentRevision === "string" && /^[a-f0-9]{64}$/.test(item.contentRevision))
  })
  const validPages = record(value.pages) && Object.entries(value.pages).every(([, page]) => isWikiProvenance(page))
  const validReceipts = record(value.receipts) && Object.entries(value.receipts).every(([id, receipt]) =>
    record(receipt) && (() => {
      const item = receipt as unknown as Record<string, unknown>
      const sourceId = typeof item.sourceId === "string" ? item.sourceId : ""
      const revision = typeof item.sourceRevision === "string" ? item.sourceRevision : ""
      const expectedId = `${sourceId}-${revision}`
      return item.schemaVersion === 1 && item.id === id && id === expectedId && typeof item.taskId === "string" && typeof item.sourceId === "string" &&
        typeof item.sourcePath === "string" && (item.originalPath === null || typeof item.originalPath === "string") &&
        revision.length > 0 && (item.sourceIngestedAt === null || typeof item.sourceIngestedAt === "string") &&
        (item.revisionIngestedAt === null || typeof item.revisionIngestedAt === "string") && typeof item.recordedAt === "string" && Array.isArray(item.wikiResults) &&
        item.status === "content_ingested" && item.indexStatus === "unknown" &&
        ["not_connected", "pending", "delivered"].includes(String(item.delivery)) && (item.error === null || typeof item.error === "string") &&
        ((item.idempotencyKey === undefined && item.idempotencyProjectId === undefined) ||
          (/^[a-f0-9]{64}$/.test(revision) && typeof item.idempotencyKey === "string" && typeof item.idempotencyProjectId === "string" && isCanonicalIngestionIdempotencyKey(item.idempotencyProjectId, sourceId, revision, item.idempotencyKey))) &&
        item.wikiResults.every(result => record(result) && typeof result.path === "string" && (result.wikiCreatedAt === null || typeof result.wikiCreatedAt === "string"))
    })())
  if (
    value.version !== 1 ||
    !validSources ||
    !validPages ||
    !validReceipts ||
    (value.projectRootPath !== undefined && typeof value.projectRootPath !== "string") ||
    (value.vaultPath !== null && typeof value.vaultPath !== "string")
  )
    throw new Error("Invalid ingest records; original file preserved")
  const storedRoot = typeof value.projectRootPath === "string" ? value.projectRootPath : undefined
  const sources = Object.fromEntries(Object.entries(value.sources).map(([path, source]) => {
    const nextPath = rebaseProjectSourcePath(projectPath, storedRoot, path)
    const origin = source.originalPath && storedRoot && source.originalPath.replace(/\\/g, "/").startsWith(`${normalizePath(storedRoot).replace(/\/+$/, "")}/`)
      ? rebaseProjectSourcePath(projectPath, storedRoot, source.originalPath)
      : source.originalPath
    return [nextPath, origin === source.originalPath ? source : { ...source, originalPath: origin }]
  }))
  if (new Set(Object.keys(sources)).size !== Object.keys(value.sources).length)
    throw new Error("Conflicting source identities after project path relocation; original file preserved")
  const pages = Object.fromEntries(Object.entries(value.pages).map(([path, page]) => [path, {
    ...page,
    createdAt: page.createdAt ?? null,
    sources: page.sources.map(source => rebaseProjectSourcePath(projectPath, storedRoot, source)),
  }]))
  return { ...value, projectRootPath: normalizePath(projectPath), sources, pages }
}
export async function saveRecords(path: string, records: IngestRecords) {
  await createDirectory(`${normalizePath(path)}/.llm-wiki`)
  await writeFileAtomic(recordPath(path), JSON.stringify({ ...records, projectRootPath: normalizePath(path) }, null, 2))
}
