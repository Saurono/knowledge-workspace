import type { SourceProvenance } from "@/modules/documents/domain"
export { RECEIPT_DIRECTORY } from "@/modules/obsidian/domain"
export type { SourceProvenance } from "@/modules/documents/domain"
import type { WikiProvenance } from "@/modules/wiki/domain"
export type { WikiProvenance } from "@/modules/wiki/domain"
import type { IngestReceipt } from "@/modules/obsidian/domain"
export type { IngestReceipt } from "@/modules/obsidian/domain"
export interface IngestRecords {
  version: 1
  /** Absolute project root recorded by new writers to make relocation deterministic. */
  projectRootPath?: string
  vaultPath: string | null
  sources: Record<string, SourceProvenance>
  pages: Record<string, WikiProvenance>
  receipts: Record<string, IngestReceipt>
}
