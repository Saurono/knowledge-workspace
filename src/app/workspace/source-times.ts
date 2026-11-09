import { loadIngestRecords } from "@/app/document-records/repository"
import { normalizePath } from "@/lib/path-utils"

export interface LocalSourceTimes {
  id: string
  receivedAt: string | null
  sourceIngestedAt: string | null
  revisionIngestedAt: string | null
}

/** Read a batch from one catalog and receipt snapshot without registering sources. */
export async function readLocalSourceTimes(
  projectPath: string,
  sourcePaths: readonly string[],
): Promise<Record<string, LocalSourceTimes | null>> {
  const records = await loadIngestRecords(projectPath)
  return Object.fromEntries(sourcePaths.map(path => {
    const normalized = normalizePath(path)
    const source = records.sources[normalized]
    if (!source) return [normalized, null]
    const currentReceipt = source.contentRevision
      ? Object.values(records.receipts).find(receipt => receipt.sourceId === source.id && receipt.sourceRevision === source.contentRevision)
      : undefined
    return [normalized, {
      id: source.id,
      receivedAt: source.receivedAt,
      sourceIngestedAt: source.ingestedAt,
      revisionIngestedAt: currentReceipt?.revisionIngestedAt ?? null,
    }]
  }))
}
