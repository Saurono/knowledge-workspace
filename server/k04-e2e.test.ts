import { expect, it } from "vitest"
import { accountFixture } from "./testing"
import { recallForContext } from "@/modules/service-api/application/memory-recall"
import type { AccessContext } from "@/modules/identity/domain"

it("K04 keeps pending and rejected proposals out of retrieval and context, and applies approval once", async () => {
  const f = await accountFixture()
  try {
    await f.bootstrap()
    const admin = await f.login()
    const project = (await f.json("/projects", "POST", { name: "K04" }, admin.cookie)).data
    const root = `/projects/${project.id}`
    const call = (path: string, method = "GET", body?: unknown) => f.json(root + path, method, body, admin.cookie)
    const input = { target: { kind: "wiki", path: "wiki/proposed.md", content: "pendingonlyword", expectedRevision: null }, idempotencyKey: "once", evidence: [{ source: "test", ref: "K04" }] }
    const first = await call("/proposals", "POST", input)
    expect(first.response.status).toBe(201)
    expect(first.data.created).toBe(true)
    const duplicate = await call("/proposals", "POST", input)
    expect(duplicate.response.status).toBe(200)
    expect(duplicate.data.created).toBe(false)
    expect((await call("/proposals")).data).toHaveLength(1)
    expect((await call("/proposals", "POST", { ...input, evidence: [{ source: "changed", ref: "K04" }] })).response.status).toBe(409)
    const search = async (query: string) => (await call("/retrieval", "POST", { query })).data.results
    expect(await search("pendingonlyword")).toHaveLength(0)
    expect((await call("/wiki/page?path=wiki/proposed.md")).response.status).toBe(404)
    const workspace = (await call("/workspace")).data.data
    const context: AccessContext = { id: "c", actorKind: "user", actorId: admin.data.account.id, effectiveAccountId: admin.data.account.id, projectId: project.id, entrypoint: "web", workRoleId: null, credential: { channel: "session", id: "s" }, permissions: ["memory.read"], basis: { membershipId: "m", catalogRevision: 1, tokenId: null, delegationId: null }, capturedAt: "2026-11-10T00:00:00Z" }
    expect(recallForContext(workspace, context, [], { now: context.capturedAt, limit: 5 }).injection.text).not.toContain("pendingonlyword")
    const memory = await call("/proposals", "POST", { idempotencyKey: "memory", evidence: [{ source: "test", ref: "K04" }], target: { kind: "memory", memoryId: null, payload: { title: "memoryonlyword", content: "memoryonlyword", category: "general" } } })
    expect(JSON.stringify((await call("/workspace")).data.data.memories)).not.toContain("memoryonlyword")
    expect(recallForContext((await call("/workspace")).data.data, context, [], { now: context.capturedAt, limit: 5 }).injection.text).not.toContain("memoryonlyword")
    expect((await call(`/proposals/${memory.data.proposal.id}/approve`, "POST")).response.status).toBe(200)
    const applied = (await call("/workspace")).data.data
    expect(JSON.stringify(applied.memories)).toContain("memoryonlyword")
    expect(recallForContext(applied, context, [], { now: new Date().toISOString(), limit: 5 }).injection.text).toContain("memoryonlyword")
    const decision = `/proposals/${first.data.proposal.id}/approve`
    expect((await call(decision, "POST")).response.status).toBe(200)
    const hits = await search("pendingonlyword")
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].path).toBe("wiki/proposed.md")
    expect((await call("/wiki/page?path=wiki/proposed.md")).data.data.content).toContain("pendingonlyword")
    expect((await call(decision, "POST")).response.status).toBe(409)
    expect(await search("pendingonlyword")).toHaveLength(hits.length)
    const other = await call("/proposals", "POST", { ...input, idempotencyKey: "reject", target: { ...input.target, path: "wiki/rejected.md", content: "rejectedonlyword" } })
    const reject = `/proposals/${other.data.proposal.id}/reject`
    expect((await call(reject, "POST", { reason: " " })).response.status).toBe(400)
    expect((await call(reject, "POST", { reason: "unsupported evidence" })).response.status).toBe(200)
    expect(await search("rejectedonlyword")).toHaveLength(0)
  } finally { await f.close() }
})
