import { expect, it } from "vitest"
import { accountFixture } from "./testing"
import { createMemoryRecord, expireDue, detectConflicts } from "@/modules/memory/domain"

it("F10 records HTTP expiry visibility and verifies the pure lifecycle transition", async () => {
  const f = await accountFixture()
  try {
    await f.bootstrap()
    const admin = await f.login()
    const project = (await f.json("/projects", "POST", { name: "F10 expiry" }, admin.cookie)).data
    const path = `/projects/${project.id}/workspace`
    const base = (await f.json(path, "GET", undefined, admin.cookie)).data
    const now = "2026-11-01T00:00:00.000Z"
    const memory = createMemoryRecord({ id: "expired-active", title: "Expired", content: "Expired", category: "fact", domainIds: [], relatedIds: [], createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z", status: "active", validity: { until: "2026-10-02T00:00:00Z" } })
    expect((await f.request(path, "PUT", { ...base.data, memories: [memory] }, admin.cookie, { "If-Match": `"v${base.revision}"` })).status).toBe(200)
    const view = await f.json(path, "GET", undefined, admin.cookie)
    expect(view.response.status).toBe(200)
    const expired = expireDue([memory], now)
    expect(expired[0].status).toBe("expired")
    expect(expired[0].transitions).toHaveLength(memory.transitions.length + 1)
    expect(view.data.data.memories.map((item: { id: string }) => item.id)).not.toContain(memory.id)
  } finally { await f.close() }
})

it("F10 private grant lifecycle, role switching and concurrent workspace writes", async () => {
  const f = await accountFixture()
  try {
    await f.bootstrap()
    const admin = await f.login(), other = await f.createAccount(admin.cookie, "reader")
    const reader = await f.login("reader")
    const project = (await f.json("/projects", "POST", { name: "F10" }, admin.cookie)).data
    const root = `/projects/${project.id}`, path = root + "/workspace"
    let state = await f.authentication.catalog.read()
    state = await f.authentication.catalog.saveMembership(state.revision, { accountId: other.id, projectId: project.id, permissionRole: "editor", workRoleIds: [] })
    for (const name of ["R1", "R2"]) state = await f.authentication.catalog.saveWorkRole(state.revision, { projectId: project.id, name, permissionRole: "editor", permissions: ["project.read", "memory.read", "memory.write"] })
    const roles = state.catalog.workRoles.filter(r => r.projectId === project.id)
    await f.authentication.catalog.saveMembership(state.revision, { accountId: other.id, projectId: project.id, permissionRole: "editor", workRoleIds: roles.map(r => r.id) })
    const make = (id: string) => createMemoryRecord({ id, title: id, content: id, category: "fact", domainIds: [], relatedIds: [], createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z" })
    const current = await f.repository.get(project.id, "workspace", "default")
    await f.repository.save(project.id, "workspace", "default", { version: 1, domains: [], resourceDomains: {}, memories: [{ ...make("private"), access: { visibility: "private", ownerId: admin.data.account.id } }, { ...make("role"), access: { visibility: "role", ownerId: admin.data.account.id, workRoleIds: [roles[0].id] } }] }, current?.revision ?? null, "2026-11-01T00:00:00Z")
    const ids = async (headers: Record<string, string> = {}) => (await f.json(path, "GET", undefined, reader.cookie, headers)).data.data.memories.map((m: { id: string }) => m.id)
    expect(await ids()).not.toContain("private")
    const issue = async () => (await f.json(root + "/memories/private/grants", "POST", { accountId: other.id, actions: ["read"], expiresAt: "2026-11-02T00:00:00Z" }, admin.cookie)).data
    const grant = await issue()
    expect(await ids()).toContain("private")
    expect((await f.request(root + "/memories/private/grants/" + grant.id, "DELETE", undefined, admin.cookie)).status).toBe(200)
    expect(await ids()).not.toContain("private")
    await issue()
    f.clock("2026-11-02T00:00:01Z")
    reader.cookie = (await f.login("reader")).cookie
    admin.cookie = (await f.login()).cookie
    expect(await ids()).not.toContain("private")
    for (const workRoleId of [roles[0].id, roles[1].id, null]) {
      const selected = (await f.json(root + "/contexts", "POST", { workRoleId }, reader.cookie)).data
      expect((await ids({ "X-KW-Context": selected.id })).includes("role")).toBe(workRoleId === roles[0].id)
    }
    const base = (await f.json(path, "GET", undefined, admin.cookie)).data
    const results = await Promise.all([1, 2].map(() => f.request(path, "PUT", base.data, admin.cookie, { "If-Match": `"v${base.revision}"` })))
    // The existing workspace CAS implementation returns 409 for a stale revision.
    expect(results.map(r => r.status).sort()).toEqual([200, 409])
  } finally { await f.close() }
})

it("F10 reciprocal contradictions report once and disappear after archival", () => {
  const make = (id: string, targetId: string) => createMemoryRecord({ id, title: id, content: id, category: "fact", domainIds: [], relatedIds: [targetId], createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z" })
  const a = { ...make("a", "b"), relations: [{ type: "contradicts" as const, targetId: "b" }] }, b = { ...make("b", "a"), relations: [{ type: "contradicts" as const, targetId: "a" }] }
  expect(detectConflicts([a, b])).toHaveLength(1)
  expect(detectConflicts([a, { ...b, status: "archived" }])).toEqual([])
})
