import { normalizePath } from "@/lib/path-utils"
import { recordWikiWrite, type WikiProvenanceCatalog } from "@/modules/wiki/domain"
import { loadIngestRecords, saveRecords, withRecordsLock } from "@/app/document-records/repository"

/** Persist a fact about a completed page write under the selected project root. */
export async function recordCompletedWikiWrite(input: {
  projectPath: string
  relativePath: string
  existed: boolean
  sources?: readonly string[]
}): Promise<void> {
  const path = normalizePath(input.relativePath)
  if (!path.startsWith("wiki/") || !/\.md$/i.test(path)) return
  await withRecordsLock(input.projectPath, async () => {
    const records = await loadIngestRecords(input.projectPath)
    records.pages = recordWikiWrite(records.pages as WikiProvenanceCatalog, path, {
      existed: input.existed,
      now: new Date().toISOString(),
      sources: input.sources,
    })
    await saveRecords(input.projectPath, records)
  })
}
