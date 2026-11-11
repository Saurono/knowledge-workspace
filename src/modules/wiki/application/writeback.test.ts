import { describe, expect, it } from "vitest"
import { createWritebackDraftService, type WritebackDraftRepository } from "./writeback"
import type { WikiWritebackDraft } from "../domain/writeback"

function fixture(verificationPort?: Parameters<typeof createWritebackDraftService>[2]) {
  const records = new Map<string, WikiWritebackDraft>()
  const repo: WritebackDraftRepository = {
    getByIdempotencyKey: async (projectId, key) => [...records.values()].find(x => x.projectId === projectId && x.idempotencyKey === key) ?? null,
    insert: async draft => { records.set(draft.id, structuredClone(draft)) },
    read: async (projectId, id) => records.get(id)?.projectId === projectId ? structuredClone(records.get(id)!) : null,
    update: async (projectId, id, expected, next) => { const found = records.get(id); if (!found || found.projectId !== projectId || found.revision !== expected) return false; records.set(id, structuredClone(next)); return true },
    list: async projectId => [...records.values()].filter(x => x.projectId === projectId).map(x => structuredClone(x)),
  }
  let id = 0
  const service = createWritebackDraftService(repo, { now: () => "2026-11-09T00:00:00.000Z", id: () => `draft-${++id}` }, verificationPort)
  return { service, records }
}
const input = () => ({
  projectId: "p1", runId: "run1", scopeId: "scope1", expectedBaseRevision: null,
  observations: [{ id: "obs1", tool: "wiki.search", outcome: "failed" as const, occurredAt: "2026-11-09T00:00:00.000Z" }],
  artifacts: [], knowledge: [{ kind: "troubleshooting" as const, title: "Search failed", symptom: "Search returned an error", environment: "local", applicability: ["current project"], rootCause: "", rootCauseStatus: "unknown" as const, attempts: [{ id: "a1", description: "Search attempted", outcome: "unverified" as const, evidenceRefs: ["obs1"] }], resolution: "open" as const, solution: "", evidenceRefs: ["obs1"], limitations: [] }],
  creator: { kind: "system" as const, id: "local-system-writeback" },
})
describe("Wiki writeback draft service", () => {
  it("is idempotent for the same canonical payload and conflicts on edits", async () => {
    const { service } = fixture(), value = input()
    const [a, b] = await Promise.all([service.submit(value), service.submit(value)])
    expect(a.id).toBe(b.id)
    expect(a.idempotencyKey).toBe(b.idempotencyKey)
    expect(a.payloadDigest).toBe(b.payloadDigest)
  })
  it("uses compare-and-swap revisions and preserves conflicts", async () => {
    const { service } = fixture(), draft = await service.submit(input())
    const changed = { ...draft, status: "conflict" as const, revision: 2 }
    await expect(service.revise("p1", draft.id, 1, () => changed)).resolves.toMatchObject({ status: "conflict", revision: 2 })
    await expect(service.revise("p1", draft.id, 1, () => changed)).rejects.toThrow("revision conflict")
  })
  it("does not treat ordinary successful tool observations as verification", async () => {
    const { service } = fixture(), draft = await service.submit(input())
    expect(draft.knowledge[0]).toMatchObject({ resolution: "open" })
  })
})

it("rejects corrupt journal without replacing data", async () => {
  const { service, records } = fixture()
  const draft = await service.submit(input())
  records.set(draft.id, { ...draft, observations: [null] } as unknown as WikiWritebackDraft)
  await expect(service.list("p1")).rejects.toThrow("Corrupt")
  expect(records.size).toBe(1)
})
it("retains a draft on base conflict and rejects terminal edits", async () => {
  const { service } = fixture()
  const draft = await service.submit(input())
  expect(await service.checkBase("p1", draft.id, 1, "changed")).toMatchObject({ status: "conflict", knowledge: draft.knowledge })
  await expect(service.revise("p1", draft.id, 2, d => ({ ...d, revision: 3, status: "published" }))).rejects.toThrow()
})

it("rejects unbound verified claims on submit and revise", async () => {
  const { service } = fixture()
  const value = input()
  await expect(service.submit({ ...value, knowledge: [{ ...value.knowledge[0], resolution: "verified" }] })).rejects.toThrow("Invalid")
  const draft = await service.submit(value)
  await expect(service.revise("p1", draft.id, 1, d => ({ ...d, revision: 2, knowledge: [{ ...value.knowledge[0], resolution: "verified" }] }))).rejects.toThrow("Invalid")
})
it("preserves old guide bindings while creating a new version", async () => {
  const { service } = fixture()
  const artifact = { id: "art", path: "out.txt", version: "1", contentHash: "a".repeat(64), visibility: "private" as const }
  const guide = { kind: "usage-guide" as const, title: "Guide", artifact, purpose: "Use", prerequisites: [], steps: [], checks: [], limitations: [], relatedProblemIds: [], status: "needs-authoring" as const }
  const draft = await service.submit({ ...input(), artifacts: [artifact], knowledge: [guide] })
  const nextArtifact = { ...artifact, version: "2", contentHash: "b".repeat(64) }
  const next = await service.updateGuide("p1", draft.id, 1, nextArtifact, { ...guide, artifact: nextArtifact })
  expect(next.knowledge).toEqual([{ ...guide, status: "needs-update" }, { ...guide, artifact: nextArtifact }])
  expect(draft.knowledge).toEqual([guide])
})

it.each(["match", "hash", "environment", "forged"] as const)("trusted executor upgrade: %s", async mode => {
 const artifact = { id: "art", path: "out.txt", version: "1", contentHash: "a".repeat(64), visibility: "private" as const }
 const verification = { kind: "bound-executor" as const, targetHash: (mode === "hash" ? "b" : "a").repeat(64), environment: mode === "environment" ? "other" : "local", observedAt: "now", artifactId: "art", version: "1" }
 const { service, records } = fixture(mode === "forged" ? undefined : { resolve: async () => verification })
 const value = input()
 const draft = await service.submit({ ...value, artifacts: [artifact], observations: [{ ...value.observations[0], outcome: "succeeded", verification }] })
 expect(draft.knowledge[0]).toMatchObject({ resolution: "open" })
 const upgrade = service.revise("p1", draft.id, 1, d => ({ ...d, revision: 2, knowledge: [{ ...value.knowledge[0], resolution: "verified" }] }))
 if (mode === "match") {
   await expect(upgrade).resolves.toMatchObject({ knowledge: [{ resolution: "verified" }] })
 } else {
   await expect(upgrade).rejects.toThrow("Invalid")
   expect(records.get(draft.id)?.knowledge[0]).toMatchObject({ resolution: "open" })
 }
 if (mode === "forged") {
   await expect(service.submit({ ...value, runId: "forged-run", artifacts: [artifact], observations: [{ ...value.observations[0], outcome: "succeeded", verification }], knowledge: [{ ...value.knowledge[0], resolution: "verified" }] })).rejects.toThrow("Invalid")
   expect(records.get(draft.id)?.knowledge[0]).toMatchObject({ resolution: "open" })
 }
})

