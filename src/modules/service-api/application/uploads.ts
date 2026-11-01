import { ServiceError, requireId } from "../domain"
import type { SharedRepository } from "./ports"
export interface ReceivedDocument {
  id: string; sourceId: string; name: string; mediaType: string; size: number; sha256: string
  receivedAt: string; sourceIngestedAt: null; status: "received"
}
export interface UploadStorage {
  write(projectId: string, documentId: string, bytes: Uint8Array): Promise<void>
  read(projectId: string, documentId: string): Promise<Uint8Array>
  remove(projectId: string, documentId: string): Promise<void>
}
export function createDocumentReceiver(repository: SharedRepository, storage: UploadStorage, context: { id(): string; now(): string; hash(bytes: Uint8Array): string }) {
  return {
    async receive(projectId: string, name: string, mediaType: string, bytes: Uint8Array) {
      requireId(projectId)
      if (!(await repository.project(projectId))) throw new ServiceError("not_found", "Project not found")
      const normalized = name.normalize("NFC").trim()
      if (!normalized || normalized.length > 255 || /[/\\\x00-\x1f\x7f]/.test(normalized) || [".", ".."].includes(normalized)) throw new ServiceError("invalid_argument", "Upload requires a filename, not a filesystem path")
      if (!bytes.length) throw new ServiceError("invalid_argument", "Empty documents cannot be received")
      const id = context.id(), now = context.now()
      const data: ReceivedDocument = { id, sourceId: id, name: normalized, mediaType: mediaType || "application/octet-stream", size: bytes.length, sha256: context.hash(bytes), receivedAt: now, sourceIngestedAt: null, status: "received" }
      await storage.write(projectId, id, bytes)
      try { return await repository.save(projectId, "document", id, data, null, now) }
      catch (error) { await storage.remove(projectId, id).catch(() => {}); throw error }
    },
    async content(projectId: string, id: string) {
      requireId(projectId); requireId(id)
      const record = await repository.get(projectId, "document", id)
      if (!record) throw new ServiceError("not_found", "Document not found")
      return storage.read(projectId, id)
    },
  }
}
