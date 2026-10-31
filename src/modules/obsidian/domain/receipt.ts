export const RECEIPT_DIRECTORY = "kb-ingest-records"
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
export const normalizeVaultPath = (path: string) => path.replace(/\\/g, "/").replace(/\/+$/, "")
export function receiptBelongsToVault(receipt: Pick<IngestReceipt, "originalPath">, vaultPath: string) {
  return !!receipt.originalPath?.startsWith(`${vaultPath}/`)
}
export function makeIngestReceipt(input: {
  id: string; taskId: string; source: { id: string; originalPath: string | null; ingestedAt: string | null }
  sourcePath: string; revision: string; cacheHit: boolean; recordedAt: string; vaultPath: string | null
  previous?: IngestReceipt; wikiResults: IngestReceipt["wikiResults"]
}): IngestReceipt {
  return {
    schemaVersion: 1, id: input.id, taskId: input.taskId, sourceId: input.source.id,
    sourcePath: input.sourcePath, originalPath: input.source.originalPath,
    sourceRevision: input.revision, sourceIngestedAt: input.source.ingestedAt,
    revisionIngestedAt: input.previous?.revisionIngestedAt ?? (input.cacheHit ? null : input.recordedAt),
    wikiResults: input.wikiResults, recordedAt: input.recordedAt,
    status: "content_ingested", indexStatus: "unknown",
    delivery: input.previous?.delivery === "delivered" ? "delivered"
      : input.vaultPath && receiptBelongsToVault(input.source, input.vaultPath) ? "pending" : "not_connected",
    error: null,
  }
}
export function receiptPayload(receipt: IngestReceipt) {
  const { delivery: _delivery, error: _error, ...payload } = receipt
  return payload
}
