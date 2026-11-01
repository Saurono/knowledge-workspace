import { ServiceError } from "@/modules/service-api/domain"
import type { SharedRepository } from "@/modules/service-api/application"
import type { ResourceRecord } from "@/modules/service-api/domain"
import { createReceivedCheckpoint, summarizeIngestion, validateCheckpoint } from "@/modules/ingestion/domain"
import type { IngestionCheckpointV1 } from "@/modules/ingestion/domain"

function recordData(record: ResourceRecord): Record<string, unknown> {
  if (!record.data || typeof record.data !== "object" || Array.isArray(record.data)) throw new ServiceError("invalid_argument", "Document metadata is damaged")
  return record.data as Record<string, unknown>
}
function readCheckpoint(projectId: string, documentId: string, record: ResourceRecord): IngestionCheckpointV1 {
  const data = recordData(record)
  if ("ingestion" in data) {
    try { validateCheckpoint(data.ingestion) } catch { throw new ServiceError("invalid_argument", "Stored ingestion checkpoint is damaged") }
    const checkpoint = data.ingestion as IngestionCheckpointV1
    if (checkpoint.projectId !== projectId || checkpoint.documentId !== documentId) throw new ServiceError("invalid_argument", "Stored ingestion checkpoint ownership mismatch")
    return checkpoint
  }
  const name = typeof data.name === "string" ? data.name.normalize("NFC").trim() : ""
  const validName = !!name && name === data.name && name.length <= 255 && !/[\\/\x00-\x1f\x7f]/.test(name) && name !== "." && name !== ".."
  const validMediaType = typeof data.mediaType === "string" && /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/.test(data.mediaType)
  if (data.id !== documentId || data.sourceId !== documentId || data.status !== "received" || data.sourceIngestedAt !== null || typeof data.receivedAt !== "string" || !validName || !validMediaType || !Number.isSafeInteger(data.size) || (data.size as number) <= 0 || typeof data.sha256 !== "string" || !/^[a-fA-F0-9]{64}$/.test(data.sha256)) throw new ServiceError("invalid_argument", "Legacy document has no reliable receive metadata")
  try { return createReceivedCheckpoint({ projectId, documentId, receivedAt: data.receivedAt, artifactRef: `document:${documentId}` }) }
  catch { throw new ServiceError("invalid_argument", "Legacy receive metadata is damaged") }
}
export function createDocumentCheckpointRepository(sharedRepository: SharedRepository, now: () => string = () => new Date().toISOString()) {
  const read = async (projectId: string, documentId: string) => {
    const record = await sharedRepository.get(projectId, "document", documentId)
    return record ? { revision: record.revision, checkpoint: readCheckpoint(projectId, documentId, record) } : null
  }
  return {
    read,
    async save(projectId: string, documentId: string, expectedRevision: number, checkpoint: IngestionCheckpointV1) {
      validateCheckpoint(checkpoint)
      if (checkpoint.projectId !== projectId || checkpoint.documentId !== documentId) throw new ServiceError("invalid_argument", "Checkpoint ownership mismatch")
      const record = await sharedRepository.get(projectId, "document", documentId)
      if (!record) throw new ServiceError("not_found", "Document not found")
      if (record.revision !== expectedRevision) throw new ServiceError("conflict", "Document revision conflict")
      const oldData = recordData(record)
      const current = readCheckpoint(projectId, documentId, record)
      if (checkpoint.createdAt !== current.createdAt || checkpoint.policy.index !== current.policy.index || checkpoint.policy.feedback !== current.policy.feedback || Date.parse(checkpoint.updatedAt) < Date.parse(current.updatedAt)) throw new ServiceError("invalid_argument", "Checkpoint identity policy and time cannot be revised")
      if (JSON.stringify(checkpoint.stages.receive) !== JSON.stringify(current.stages.receive)) throw new ServiceError("invalid_argument", "Receive evidence cannot be revised")
      const saved = await sharedRepository.save(projectId, "document", documentId, { ...oldData, ingestion: checkpoint }, expectedRevision, now())
      return { revision: saved.revision, checkpoint: readCheckpoint(projectId, documentId, saved) }
    },
    async query(projectId: string, documentId: string) {
      const value = await read(projectId, documentId)
      return value && { ...value, summary: summarizeIngestion(value.checkpoint) }
    },
  }
}
