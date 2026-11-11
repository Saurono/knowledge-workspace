import { canonicalDomainResourceKey } from "@/modules/domains/domain"
import { ServiceError } from "@/modules/service-api/domain"

export interface DocumentCascadeResult {
  removed: boolean
  removedUpload: boolean
  clearedDomainLinks: number
  revision: number | null
}

export async function removeDocumentCascade(options: {
  repository: {
    get(projectId: string, kind: "document", key: string): Promise<{ revision: number; data: unknown } | null>
    remove(projectId: string, kind: "document", key: string, expected: number, now: string): Promise<void>
    get(projectId: string, kind: "workspace", key: "default"): Promise<{ revision: number; data: unknown } | null>
    save(projectId: string, kind: "workspace", key: "default", data: unknown, expected: number, now: string): Promise<{ revision: number }>
  }
  uploads: { remove(projectId: string, sourceId: string): Promise<void>; read(projectId: string, sourceId: string): Promise<Uint8Array> }
  projectId: string
  key: string
  expectedRevision: number
  now: string
}): Promise<DocumentCascadeResult> {
  const { repository, uploads, projectId, expectedRevision, now } = options
  const documentId = options.key.replace(/^raw\/documents\//, "")
  const record = await repository.get(projectId, "document", documentId)
  if (!record) throw new ServiceError("not_found", "Resource not found")
  const sourceId = (record.data as { sourceId: string }).sourceId
  const key = canonicalDomainResourceKey("document", sourceId)
  // 1. Delete the resource first; repository errors define whether deletion took effect.
  await repository.remove(projectId, "document", documentId, expectedRevision, now)
  // 2. Detect bytes before removal. Cleanup failure cannot undo the effective resource deletion.
  let hadBytes = false
  try { await uploads.read(projectId, sourceId); hadBytes = true }
  catch (error) { if ((error as { code?: string }).code !== "ENOENT") throw error }
  let removedUpload = false
  try { await uploads.remove(projectId, sourceId); removedUpload = hadBytes } catch { /* Best-effort byte cleanup. */ }
  // 3. Clear domain links last, using the revision just read for workspace CAS.
  const workspace = await repository.get(projectId, "workspace", "default")
  let revision = workspace?.revision ?? null
  let clearedDomainLinks = 0
  if (workspace) {
    const data = workspace.data as { resourceDomains?: Record<string, string[]> }
    if (data.resourceDomains && Object.prototype.hasOwnProperty.call(data.resourceDomains, key)) {
      clearedDomainLinks = Math.max(1, data.resourceDomains[key].length)
      const resourceDomains = { ...data.resourceDomains }
      delete resourceDomains[key]
      revision = (await repository.save(projectId, "workspace", "default", { ...data, resourceDomains }, workspace.revision, now)).revision
    }
  }
  return { removed: true, removedUpload, clearedDomainLinks, revision }
}
