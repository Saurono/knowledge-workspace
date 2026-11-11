import { afterEach, expect, it } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { SqliteRepository } from "./repository"
import { createSharedService } from "../src/modules/service-api/application"
import type { SubmitProposalInput } from "../src/modules/service-api/domain"
const cleanup: Array<() => void> = []
it("approves a memory proposal without category and persists context", async () => {
  const { service, repository, id, input } = await fixture()
  const { proposal } = await service.submitProposal(id, {
    ...input, target: { kind: "memory", memoryId: null, payload: { title: "Default category", content: "Remember this" } },
  }, actor)
  expect((await service.approveProposal(id, proposal.id, actor)).status).toBe("approved")
  const memories = (await repository.governanceWorkspace(id))!.data.memories
  expect(memories).toHaveLength(1)
  expect(memories[0].category).toBe("context")
})
it("approves distinct pending memories atomically and leaves duplicates pending", async () => {
  const { service, repository, id, input } = await fixture()
  const proposals = await Promise.all(["first", "second"].map(content => service.submitProposal(id, {
    ...input, idempotencyKey: content, target: { kind: "memory", memoryId: null, payload: { title: content, content, category: "fact" } },
  }, { ...actor, kind: "agent", id: content })))
  for (const { proposal } of proposals) {
    expect(proposal.status).toBe("pending")
    const approved = await service.approveProposal(id, proposal.id, actor)
    expect(approved.status).toBe("approved")
    expect(approved.appliedRevision).toBeTypeOf("number")
    expect(await repository.proposal(id, proposal.id)).toEqual(approved)
  }
  expect(((await service.readWorkspace(id)).data as { memories: unknown[] }).memories).toHaveLength(2)
  expect(await repository.verifyMemoryMirror(id)).toMatchObject({ ok: true })
  const duplicate = await service.submitProposal(id, { ...input, idempotencyKey: "duplicate", target: proposals[0].proposal.target }, actor)
  await expect(service.approveProposal(id, duplicate.proposal.id, actor)).rejects.toMatchObject({ code: "conflict" })
  expect((await repository.proposal(id, duplicate.proposal.id))?.status).toBe("pending")
})
it("expires due memories when approving a memory proposal", async () => {
  const { service, repository, id, input } = await fixture()
  const { createMemoryRecord } = await import("@/modules/memory/domain")
  const workspace = (await repository.governanceWorkspace(id))!
  const due = createMemoryRecord({ id: "due", title: "due", content: "due", category: "fact", domainIds: [], relatedIds: [], status: "active", createdAt: "2020-01-01T00:00:00Z", updatedAt: "2020-01-01T00:00:00Z", validity: { until: "2020-02-01T00:00:00Z" } })
  await service.saveWorkspace(id, { ...workspace.data, memories: [due] }, workspace.revision)
  const { proposal } = await service.submitProposal(id, { ...input, target: { kind: "memory", memoryId: null, payload: { title: "new", content: "new", category: "fact" } } }, actor)
  await service.approveProposal(id, proposal.id, actor)
  const expired = (await repository.governanceWorkspace(id))!.data.memories.find(m => m.id === "due")!
  expect(expired.status).toBe("expired")
  expect(expired.transitions).toHaveLength(due.transitions.length + 1)
  expect(expired.transitions[expired.transitions.length - 1]).toMatchObject({ to: "expired", at: expect.any(String) })
})
afterEach(() => { cleanup.splice(0).forEach(fn => fn()) })
const actor = { kind: "user" as const, id: "reviewer", entrypoint: "test", via: "manual" as const }
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "write-proposals-")), repository = new SqliteRepository(dir)
  cleanup.push(() => { repository.close(); rmSync(dir, { recursive: true, force: true }) })
  const service = createSharedService(repository, { id: randomUUID, now: () => new Date().toISOString() })
  const project = await service.createProject("Proposals")
  const input: SubmitProposalInput = { idempotencyKey: "key", target: { kind: "wiki", path: "wiki/proposal.md", content: "proposed", expectedRevision: null }, evidence: [{ source: "test", ref: "source" }] }
  return { repository, service, id: project.id, input }
}
it("submits pending, requires evidence, and deduplicates stable fingerprints", async () => {
  const { repository, service, id, input } = await fixture()
  await expect(service.submitProposal(id, { ...input, evidence: [] }, actor)).rejects.toMatchObject({ code: "invalid_argument" })
  const first = await service.submitProposal(id, input, actor)
  expect(first.created).toBe(true); expect(first.proposal.status).toBe("pending")
  expect(await service.submitProposal(id, { ...input, target: { expectedRevision: null, content: "proposed", path: "wiki/proposal.md", kind: "wiki" } }, actor)).toEqual({ proposal: first.proposal, created: false })
  expect(await repository.proposals(id)).toHaveLength(1)
  await expect(service.submitProposal(id, { ...input, evidence: [{ source: "changed", ref: "source" }] }, actor)).rejects.toMatchObject({ code: "conflict" })
})
it("approves wiki once with a readable applied revision", async () => {
  const { service, id, input } = await fixture()
  const { proposal } = await service.submitProposal(id, input, actor)
  const approved = await service.approveProposal(id, proposal.id, actor)
  expect(approved.status).toBe("approved"); expect(approved.appliedRevision).toBe(1)
  expect((await service.readWiki(id, "wiki/proposal.md")).data.content).toBe("proposed")
  await expect(service.approveProposal(id, proposal.id, actor)).rejects.toMatchObject({ code: "conflict" })
})
it("keeps pending when the wiki revision conflicts", async () => {
  const { repository, service, id, input } = await fixture()
  const { proposal } = await service.submitProposal(id, { ...input, target: { kind: "wiki", path: "wiki/proposal.md", content: "bad", expectedRevision: 99 } }, actor)
  await expect(service.approveProposal(id, proposal.id, actor)).rejects.toMatchObject({ code: "conflict" })
  expect((await repository.proposal(id, proposal.id))?.status).toBe("pending")
})
it("persists rejection and prevents later approval", async () => {
  const { repository, service, id, input } = await fixture()
  const { proposal } = await service.submitProposal(id, input, actor)
  await service.rejectProposal(id, proposal.id, actor, "insufficient support")
  expect(await repository.proposal(id, proposal.id)).toMatchObject({ status: "rejected", rejectionReason: "insufficient support", decidedBy: { actorId: actor.id, via: "manual" } })
  await expect(service.approveProposal(id, proposal.id, actor)).rejects.toMatchObject({ code: "conflict" })
})
it("leaves invalid memory proposals pending", async () => {
  const { repository, service, id, input } = await fixture()
  const { proposal } = await service.submitProposal(id, { ...input, target: { kind: "memory", memoryId: null, payload: {} } }, actor)
  await expect(service.approveProposal(id, proposal.id, actor)).rejects.toMatchObject({ code: "invalid_argument" })
  expect((await repository.proposal(id, proposal.id))?.status).toBe("pending")
})
it("creates and updates memory once with provenance and revision history", async () => {
  const { service, id, input } = await fixture()
  const payload = { title: "Memory", content: "remember", category: "general" }
  const { proposal } = await service.submitProposal(id, { ...input, target: { kind: "memory", memoryId: null, payload } }, actor)
  const approved = await service.approveProposal(id, proposal.id, actor)
  const workspace = await service.readWorkspace(id)
  const memories = (workspace.data as { memories: import("@/modules/memory/domain").MemoryRecord[] }).memories
  expect(memories).toHaveLength(1)
  const first = memories[0]
  expect(first).toMatchObject({ status: "active", source: { kind: "user", actorId: actor.id, ref: "source" } })
  expect(approved.appliedRevision).toBe(workspace.revision)
  await expect(service.approveProposal(id, proposal.id, actor)).rejects.toMatchObject({ code: "conflict" })
  const next = await service.submitProposal(id, { ...input, idempotencyKey: "update", target: { kind: "memory", memoryId: first.id, payload: { ...payload, id: first.id, content: "updated" } } }, actor)
  await service.approveProposal(id, next.proposal.id, actor)
  const updated = ((await service.readWorkspace(id)).data as { memories: typeof memories }).memories
  expect(updated).toHaveLength(1)
  expect(updated[0]).toMatchObject({ version: first.version + 1, createdAt: first.createdAt })
  expect(updated[0].revisions).toHaveLength(first.revisions.length + 1)
  const missing = await service.submitProposal(id, { ...input, idempotencyKey: "missing", target: { kind: "memory", memoryId: "missing", payload: { ...payload, id: "missing" } } }, actor)
  await expect(service.approveProposal(id, missing.proposal.id, actor)).rejects.toMatchObject({ code: "not_found" })
  expect((await service.proposal(id, missing.proposal.id))?.status).toBe("pending")
})
