import { createDirectory, fileExists, readFile, writeFileAtomic } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import { withProjectLock } from "@/lib/project-mutex"
import type { IngestRecords } from "./snapshot"
export const withRecordsLock = <T>(path: string, operation: () => Promise<T>) =>
  withProjectLock(`${normalizePath(path)}\0ingest-records`, operation)
export const emptyRecords = (): IngestRecords => ({
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
export async function saveRecords(path: string, records: IngestRecords) {
  await createDirectory(`${normalizePath(path)}/.llm-wiki`)
  await writeFileAtomic(recordPath(path), JSON.stringify(records, null, 2))
}
