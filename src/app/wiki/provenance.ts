import { normalizePath } from "@/lib/path-utils"
import { recordWikiWrite, type WikiProvenanceCatalog } from "@/modules/wiki/domain"
import { loadIngestRecords, saveRecords, withRecordsLock } from "@/app/document-records/repository"
import { hashContentRevision } from "@/modules/documents/application"
import type { WikiWriteAttribution } from "@/modules/wiki/domain"

function wikiBody(content: string): string {
  const frontmatter = content.match(/^(---[ \t]*\r?\n)[\s\S]*?(\r?\n---[ \t]*(?:\r?\n|$))/)
  return frontmatter ? content.slice(frontmatter[0].length) : content
}

/** Persist a fact about a completed page write under the selected project root. */
export async function recordCompletedWikiWrite(input: {
  projectPath: string
  relativePath: string
  existed: boolean
  sources?: readonly string[]
  content?: string
  attribution?: WikiWriteAttribution
}): Promise<void> {
  const path = normalizePath(input.relativePath)
  if (!path.startsWith("wiki/") || !/\.md$/i.test(path)) return
  await withRecordsLock(input.projectPath, async () => {
    const records = await loadIngestRecords(input.projectPath)
    records.pages = recordWikiWrite(records.pages as WikiProvenanceCatalog, path, {
      existed: input.existed,
      now: new Date().toISOString(),
      sources: input.sources,
      // Bind contribution versions to the Markdown body. Frontmatter/date/link
      // metadata changes must not create an author contribution.
      contentHash: input.content === undefined ? undefined : await hashContentRevision(wikiBody(input.content)),
      attribution: input.attribution,
    })
    await saveRecords(input.projectPath, records)
  })
}
