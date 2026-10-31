import type { SourceProvenance } from "@/modules/documents/domain"
export const RECEIPT_DIRECTORY = "kb-ingest-records"
export type { SourceProvenance } from "@/modules/documents/domain"
import type { WikiProvenance } from "@/modules/wiki/domain"
export type { WikiProvenance } from "@/modules/wiki/domain"
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
