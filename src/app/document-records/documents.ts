import { createDocumentService, type DocumentRepository } from "@/modules/documents/application"
import { loadIngestRecords, saveRecords, withRecordsLock } from "./repository"
export const documentRepository: DocumentRepository = {
  read: async (path) => (await loadIngestRecords(path)).sources,
  update: (path, change) =>
    withRecordsLock(path, async () => {
      const records = await loadIngestRecords(path)
      const updated = change(records.sources)
      if (updated === records.sources) return
      records.sources = updated
      await saveRecords(path, records)
    }),
  revisions: async (path, sourceId) =>
    Object.values((await loadIngestRecords(path)).receipts)
      .filter((receipt) => receipt.sourceId === sourceId)
      .map((receipt) => ({
        sourceId,
        revision: receipt.sourceRevision,
        firstIngestedAt: receipt.revisionIngestedAt,
        recordedAt: receipt.recordedAt,
        taskId: receipt.taskId,
        outputPaths: receipt.wikiResults.map((result) => result.path),
        ...(receipt.idempotencyKey ? { idempotencyKey: receipt.idempotencyKey } : {}),
      })),
}
export const documents = createDocumentService(documentRepository, {
  createId: () => crypto.randomUUID(),
  now: () => new Date().toISOString(),
})
export const { registerImportedSource, reserveImportedSource, confirmImportedSource } = documents
