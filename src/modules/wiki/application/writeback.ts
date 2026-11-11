import type { UsageGuideKnowledge, WritebackArtifact, WritebackObservation, WikiWritebackDraft } from "../domain/writeback"
import { assertWritebackTransition, markGuideForArtifactChange, validateWritebackDraft, writebackIdempotencyKey } from "../domain/writeback"

export interface WritebackDraftRepository {
  getByIdempotencyKey(projectId: string, key: string): Promise<WikiWritebackDraft | null>
  insert(draft: WikiWritebackDraft): Promise<void>
  read(projectId: string, draftId: string): Promise<WikiWritebackDraft | null>
  update(projectId: string, draftId: string, expectedRevision: number, next: WikiWritebackDraft): Promise<boolean>
  list(projectId: string): Promise<WikiWritebackDraft[]>
}
export interface WritebackRuntime { now(): string; id(): string }

async function digest(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const result = await globalThis.crypto.subtle.digest("SHA-256", bytes)
  return [...new Uint8Array(result)].map(byte => byte.toString(16).padStart(2, "0")).join("")
}

export function createWritebackDraftService(repository: WritebackDraftRepository, runtime: WritebackRuntime, verificationPort?: { resolve(projectId: string, runId: string, observationId: string): Promise<WritebackObservation["verification"]> }) {
  async function trustedObservations(draft: Pick<WikiWritebackDraft, "projectId" | "runId" | "observations">) {
    return Promise.all(draft.observations.map(async observation => ({ ...observation, verification: await verificationPort?.resolve(draft.projectId, draft.runId, observation.id) })))
  }
  let queue = Promise.resolve()
  return {
    async submit(input: Omit<WikiWritebackDraft, "schemaVersion" | "id" | "idempotencyKey" | "payloadDigest" | "status" | "revision" | "createdAt" | "updatedAt" | "publishedPageIds">): Promise<WikiWritebackDraft> {
      const previous = queue
      let release!: () => void
      queue = new Promise<void>(resolve => { release = resolve })
      await previous
      try {
      input = { ...input, observations: await trustedObservations(input) }
      const payload = JSON.stringify({ projectId: input.projectId, runId: input.runId, scopeId: input.scopeId, observations: input.observations, artifacts: input.artifacts, knowledge: input.knowledge, creator: input.creator, expectedBaseRevision: input.expectedBaseRevision })
      const payloadDigest = await digest(payload)
      const idempotencyKey = writebackIdempotencyKey(input)
      const prior = await repository.getByIdempotencyKey(input.projectId, idempotencyKey)
      if (prior) {
        if (!validateWritebackDraft(prior)) throw new Error("Corrupt Wiki writeback draft journal; original data preserved")
        return prior
      }
      const now = runtime.now()
      const draft: WikiWritebackDraft = {
        ...input, schemaVersion: 1, id: runtime.id(), idempotencyKey, payloadDigest,
        status: "draft", revision: 1, createdAt: now, updatedAt: now, publishedPageIds: [],
      }
      if (!validateWritebackDraft(draft)) throw new Error("Invalid Wiki writeback draft")
      await repository.insert(draft)
      return draft
      } finally { release() }
    },
    async revise(projectId: string, draftId: string, expectedRevision: number, change: (draft: WikiWritebackDraft) => WikiWritebackDraft): Promise<WikiWritebackDraft> {
      const current = await repository.read(projectId, draftId)
      if (!current) throw new Error("Wiki writeback draft not found")
      if (!validateWritebackDraft(current)) throw new Error("Corrupt Wiki writeback draft journal; original data preserved")
      if (current.revision !== expectedRevision) throw new Error("Wiki writeback draft revision conflict")
      const next = change(structuredClone(current))
      next.observations = await trustedObservations(next)
      if (next.id !== current.id || next.projectId !== current.projectId || next.idempotencyKey !== current.idempotencyKey ||
        next.payloadDigest !== current.payloadDigest || next.revision !== current.revision + 1) throw new Error("Invalid writeback draft revision")
      assertWritebackTransition(current, next)
      next.updatedAt = runtime.now()
      if (!validateWritebackDraft(next)) throw new Error("Invalid Wiki writeback draft")
      if (!await repository.update(projectId, draftId, expectedRevision, next)) throw new Error("Wiki writeback draft revision conflict")
      return next
    },
    async updateGuide(projectId: string, draftId: string, expectedRevision: number, artifact: WritebackArtifact, guide: UsageGuideKnowledge) {
      return this.revise(projectId, draftId, expectedRevision, draft => {
        if (guide.artifact.id !== artifact.id || JSON.stringify(guide.artifact) !== JSON.stringify(artifact)) throw new Error("Guide artifact binding mismatch")
        const old = draft.knowledge.filter(k => k.kind === "usage-guide" && k.artifact.id === artifact.id)
        if (old.some(k => k.kind === "usage-guide" && k.artifact.version === artifact.version && k.artifact.contentHash === artifact.contentHash)) throw new Error("Guide version already exists")
        return { ...draft, revision: draft.revision + 1,
          artifacts: [...draft.artifacts.filter(a => a.id !== artifact.id), structuredClone(artifact)],
          knowledge: [...draft.knowledge.map(k => k.kind === "usage-guide" ? markGuideForArtifactChange(k, artifact) : k), structuredClone(guide)] }
      })
    },
    async checkBase(projectId: string, draftId: string, expectedRevision: number, actualBaseRevision: string | null) {
      return this.revise(projectId, draftId, expectedRevision, draft => ({
        ...draft, revision: draft.revision + 1,
        status: draft.expectedBaseRevision === actualBaseRevision ? draft.status : "conflict",
      }))
    },
    async list(projectId: string) {
      const drafts = await repository.list(projectId)
      if (!drafts.every(validateWritebackDraft)) throw new Error("Corrupt Wiki writeback draft journal; original data preserved")
      return drafts
    },
  }
}
