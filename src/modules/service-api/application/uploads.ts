import { ServiceError, requireId } from "../domain"
import type { SharedRepository } from "./ports"
import type { ResourceRecord } from "../domain"
import { AuthError } from "@/modules/identity/domain"
import type { AccessContext } from "@/modules/identity/domain"
import { createReceivedCheckpoint } from "@/modules/ingestion/domain"
export interface ReceivedDocument {
  id: string; sourceId: string; name: string; mediaType: string; size: number; sha256: string
  byteSha256?: string; sourceRevision?: string; revisionKind?: "raw-bytes-sha256"; parsedTextRevision?: string | null
  receivedAt: string; sourceIngestedAt: null; status: "received"; ingestion?: ReturnType<typeof createReceivedCheckpoint>
}
export interface UploadStorage {
  write(projectId: string, documentId: string, bytes: Uint8Array): Promise<void>
  read(projectId: string, documentId: string): Promise<Uint8Array>
  remove(projectId: string, documentId: string): Promise<void>
}
export interface UploadRegistration {
  projectId: string; idempotencyHash: string; sourceId: string; byteRevision: string
  requestHash: string; bindingHash: string; documentId: string; data: ReceivedDocument; now: string; createSource: boolean
}
export interface UploadRegistry {
  register(input: UploadRegistration): Promise<{ status: "created" | "existing" | "conflict"; record: ResourceRecord<ReceivedDocument> }>
  read(projectId: string, documentId: string): Promise<ResourceRecord<ReceivedDocument> | null>
}
export function createAuthorizedUploadRegistry(
  registry: UploadRegistry,
  access: (projectId: string) => Promise<AccessContext>,
): UploadRegistry {
  const check = async (projectId: string, permission: "documents.read" | "documents.write") => {
    const context = await access(projectId)
    if (context.projectId !== projectId || !context.permissions.includes(permission))
      throw new AuthError("forbidden", `${permission} permission required`)
  }
  return {
    async register(input) { await check(input.projectId, "documents.write"); return registry.register(input) },
    async read(projectId, documentId) { await check(projectId, "documents.read"); return registry.read(projectId, documentId) },
  }
}
export function createDocumentReceiver(repository: SharedRepository, storage: UploadStorage, context: { id(): string; now(): string; hash(bytes: Uint8Array): string }, registry?: UploadRegistry) {
  return {
    async receive(projectId: string, name: string, mediaType: string, bytes: Uint8Array, options: { idempotencyKey?: string; sourceId?: string; createSource?: boolean } = {}) {
      requireId(projectId)
      if (!(await repository.project(projectId))) throw new ServiceError("not_found", "Project not found")
      const normalized = name.normalize("NFC").trim()
      if (!normalized || normalized.length > 255 || /[/\\\x00-\x1f\x7f]/.test(normalized) || [".", ".."].includes(normalized)) throw new ServiceError("invalid_argument", "Upload requires a filename, not a filesystem path")
      if (!bytes.length) throw new ServiceError("invalid_argument", "Empty documents cannot be received")
      const id = context.id(), now = context.now(), byteRevision = context.hash(bytes), normalizedMediaType = mediaType || "application/octet-stream"
      if (options.idempotencyKey === undefined && (options.sourceId !== undefined || options.createSource))
        throw new ServiceError("invalid_argument", "Source identity options require an idempotency key")
      if (options.idempotencyKey !== undefined) {
        if (!registry) throw new ServiceError("unsupported", "Idempotent uploads are not configured")
        const key = options.idempotencyKey
        if (key.length < 1 || key.length > 200 || /[\x00-\x1f\x7f]/.test(key)) throw new ServiceError("invalid_argument", "Invalid idempotency key")
        if (options.sourceId !== undefined) requireId(options.sourceId)
        const sourceId = options.sourceId ?? context.id()
        const requestHash = context.hash(new TextEncoder().encode(JSON.stringify([normalized, normalizedMediaType, byteRevision, bytes.length])))
        const bindingHash = context.hash(new TextEncoder().encode(JSON.stringify([requestHash, options.sourceId ?? null, options.createSource === true])))
        const data: ReceivedDocument = { id, sourceId, name: normalized, mediaType: normalizedMediaType, size: bytes.length, sha256: byteRevision, byteSha256: byteRevision, sourceRevision: byteRevision, revisionKind: "raw-bytes-sha256", parsedTextRevision: null, receivedAt: now, sourceIngestedAt: null, status: "received", ingestion: createReceivedCheckpoint({ projectId, documentId: id, receivedAt: now, artifactRef: `document:${id}` }) }
        await storage.write(projectId, id, bytes)
        try {
          const result = await registry.register({ projectId, idempotencyHash: context.hash(new TextEncoder().encode(`${projectId}\0${key}`)), sourceId, byteRevision, requestHash, bindingHash, documentId: id, data, now, createSource: options.sourceId === undefined || options.createSource === true })
          if (result.status !== "created") {
            if (result.status === "conflict") {
              await storage.remove(projectId, id).catch(() => {})
              throw new ServiceError("conflict", "Idempotency key or source revision is already bound to different upload semantics")
            }
            // Replays need both write (checked at the route) and current read
            // authorization before any existing document is disclosed.
            const visible = await registry.read(projectId, result.record.key)
            if (!visible) throw new ServiceError("not_found", "Document not found")
            const published = visible.data as ReceivedDocument
            if (visible.key !== result.record.key || published.id !== visible.key ||
                published.name !== normalized || published.mediaType !== normalizedMediaType ||
                published.size !== bytes.length || published.sha256 !== byteRevision ||
                (published.byteSha256 !== undefined && published.byteSha256 !== byteRevision) ||
                (published.sourceRevision !== undefined && published.sourceRevision !== byteRevision))
              throw new ServiceError("internal", "Registered upload metadata is inconsistent")
            let publishedBytes: Uint8Array
            try { publishedBytes = await storage.read(projectId, published.id) }
            catch { throw new ServiceError("internal", "Registered upload bytes are missing or damaged") }
            if (publishedBytes.length !== bytes.length || context.hash(publishedBytes) !== byteRevision)
              throw new ServiceError("internal", "Registered upload bytes are missing or damaged")
            await storage.remove(projectId, id).catch(() => {})
            return visible
          }
          return result.record
        } catch (error) {
          await storage.remove(projectId, id).catch(() => {})
          throw error
        }
      }
      const data: ReceivedDocument = { id, sourceId: id, name: normalized, mediaType: normalizedMediaType, size: bytes.length, sha256: byteRevision, byteSha256: byteRevision, sourceRevision: byteRevision, revisionKind: "raw-bytes-sha256", parsedTextRevision: null, receivedAt: now, sourceIngestedAt: null, status: "received", ingestion: createReceivedCheckpoint({ projectId, documentId: id, receivedAt: now, artifactRef: `document:${id}` }) }
      await storage.write(projectId, id, bytes)
      try { return await repository.save(projectId, "document", id, data, null, now) }
      catch (error) { await storage.remove(projectId, id).catch(() => {}); throw error }
    },
    async content(projectId: string, id: string) {
      requireId(projectId); requireId(id)
      const record = await repository.get(projectId, "document", id)
      if (!record) throw new ServiceError("not_found", "Document not found")
      const storageId = (record.data as Partial<ReceivedDocument>)?.id
      if (storageId !== id) throw new ServiceError("internal", "Upload document storage identity is invalid")
      return storage.read(projectId, id)
    },
  }
}
