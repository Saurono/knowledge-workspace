import { expect, it } from "vitest"
import type { AccessContext, MemoryGrant } from "@/modules/identity/domain"
import { createMemoryRecord, type MemoryRecord } from "@/modules/memory/domain"
import { canAccessMemory, visibleWorkspace, mergeAuthorizedWorkspace } from "./workspace-authorization"
import { accountFixture } from "../../../../server/testing"
const now = "2026-11-01T00:00:00Z"
const context: AccessContext = { id: "c", actorKind: "user", entrypoint: "web", actorId: "alice", effectiveAccountId: "alice", projectId: "p", workRoleId: "r", credential: { channel: "session", id: "s" }, permissions: ["memory.read", "memory.write"], basis: { membershipId: "m", catalogRevision: 1, tokenId: null, delegationId: null }, capturedAt: now }
const memory = (patch: Partial<MemoryRecord> = {}) => createMemoryRecord({ id: "m", title: "M", content: "text", category: "general", domainIds: [], relatedIds: [], createdAt: now, updatedAt: now, source: { kind: "user", actorId: "alice" }, ...patch })
const grant: MemoryGrant = { id: "g", projectId: "p", memoryId: "m", ownerId: "bob", accountId: "alice", actions: ["read"], expiresAt: "2026-12-01T00:00:00Z", revokedAt: null }
const read = (m: MemoryRecord, c = context, grants: MemoryGrant[] = []) => canAccessMemory(c, m, grants, now, "read")
it("HTTP and memory.list return identical memory sets for same credentials", async () => {
  const f = await accountFixture()
  try {
    await f.bootstrap()
    const admin = await f.login()
    const project = (await f.json("/projects", "POST", { name: "Memory scopes" }, admin.cookie)).data
    const current = await f.repository.get(project.id, "workspace", "default")
    await f.repository.save(project.id, "workspace", "default", { version: 1, domains: [], resourceDomains: {}, memories: [memory(), memory({ id: "hidden", status: "archived" })] }, current?.revision ?? null, now)
    const root = `/projects/${project.id}`
    const http = (await f.json(root + "/memories", "GET", undefined, admin.cookie)).data
    for (const route of ["cli", "mcp"]) {
      const tool = (await f.json(root + "/" + route, "POST", { tool: "memory.list" }, admin.cookie)).data
      expect(tool.memories.map((m: MemoryRecord) => m.id).sort()).toEqual(http.memories.map((m: MemoryRecord) => m.id).sort())
    }
    expect(http.memories.map((m: MemoryRecord) => m.id)).toEqual(["m"])
  } finally { await f.close() }
})
it("project requires permission", () => {
  expect(read(memory())).toBe(true)
  expect(read(memory(), { ...context, permissions: [] })).toBe(false)
})
it("role requires selected matching nonempty role", () => {
  const m = memory({ access: { visibility: "role", ownerId: "bob", workRoleIds: ["r"] } })
  expect(read(m)).toBe(true)
  for (const workRoleId of [null, "other"]) expect(read(m, { ...context, workRoleId })).toBe(false)
  expect(read(memory({ access: { ...m.access!, workRoleIds: [] } }))).toBe(false)
})
it("private requires owner or exact live grant", () => {
  const m = memory({ access: { visibility: "private", ownerId: "bob" } })
  expect(read(m)).toBe(false)
  expect(read(m, context, [grant])).toBe(true)
  expect(read(m, { ...context, actorId: "bob", effectiveAccountId: "bob" })).toBe(true)
})
it.each([ ["revoked", { revokedAt: now }], ["expires at now", { expiresAt: now }], ["cross memory", { memoryId: "other" }], ["cross account", { accountId: "other" }] ] as const)("private denies %s", (_, patch) => {
  expect(read(memory({ access: { visibility: "private", ownerId: "bob" } }), context, [{ ...grant, ...patch }])).toBe(false)
})
it("candidate requires creator acting as self", () => {
  const m = memory({ status: "candidate" })
  expect(read(m)).toBe(true)
  expect(read(m, { ...context, actorId: "other" })).toBe(false)
  expect(read(m, { ...context, effectiveAccountId: "other" })).toBe(false)
})
it.each(["expired", "superseded", "archived"] as const)("%s visible to creator with original status but hidden from others", status => {
  for (const visibility of ["project", "role", "private"] as const) {
    const m = memory({ status, access: { visibility, ownerId: "alice", workRoleIds: ["r"] } })
    expect(read(m, context, [grant])).toBe(true)
    expect(visibleWorkspace({ version: 1, domains: [], resourceDomains: {}, memories: [m] }, context, [], now).memories).toEqual([expect.objectContaining({ id: m.id, status })])
    expect(read(m, { ...context, actorId: "other", effectiveAccountId: "other" }, [grant])).toBe(false)
    expect(canAccessMemory(context, m, [], now, "write")).toBe(true)
  }
})
it("filters hidden relations alongside relatedIds and preserves self references", () => {
  const workspace = { version: 1 as const, domains: [], resourceDomains: {}, memories: [
    memory({ id: "A", relatedIds: ["B", "C", "A"], relations: [{ type: "related", targetId: "B" }, { type: "related", targetId: "C" }, { type: "related", targetId: "A" }] }),
    memory({ id: "B", access: { visibility: "private", ownerId: "bob" } }),
    memory({ id: "C" }),
  ] }
  const visible = visibleWorkspace(workspace, context, [], now)
  expect(visible.memories.map(m => m.id)).toEqual(["A", "C"])
  expect(visible.memories[0].relations).toEqual([{ type: "related", targetId: "C" }, { type: "related", targetId: "A" }])
  expect(visible.memories[0].relatedIds).toEqual(["C", "A"])
  expect(workspace.memories[0].relations).toHaveLength(3)
})
it("hidden relatedIds stay hidden and survive writeback", () => {
  const workspace = { version: 1 as const, domains: [], resourceDomains: {}, memories: [memory({ relatedIds: ["own-archived", "hidden"] }), memory({ id: "own-archived", status: "archived" }), memory({ id: "hidden", status: "archived", source: { kind: "user", actorId: "bob" } })] }
  const visible = visibleWorkspace(workspace, context, [], now)
  expect(visible.memories.map(m => m.id)).toEqual(["m", "own-archived"])
  expect(visible.memories[0].relatedIds).toEqual(["own-archived"])
  expect(visible.memories[1].status).toBe("archived")
  expect(mergeAuthorizedWorkspace(workspace, visible, context, [], now).memories.find(m => m.id === "m")?.relatedIds).toEqual(["own-archived", "hidden"])
})
it.each(["2026-10-31T00:00:00Z", now, "2026-12-01T00:00:00Z", undefined])("filters validity until %s without changing status", until => {
  const m = memory({ validity: { until } })
  const workspace = { version: 1 as const, domains: [], resourceDomains: {}, memories: [m] }
  expect(visibleWorkspace(workspace, context, [], now).memories).toHaveLength(!until || Date.parse(until) > Date.parse(now) ? 1 : 0)
  expect(m.status).toBe("active")
})
it("valid private grant cannot expose expired memory", () => {
  const m = memory({ access: { visibility: "private", ownerId: "bob" }, validity: { until: now } })
  expect(read(m, context, [grant])).toBe(true)
  expect(visibleWorkspace({ version: 1, domains: [], resourceDomains: {}, memories: [m] }, context, [grant], now).memories).toEqual([])
})
