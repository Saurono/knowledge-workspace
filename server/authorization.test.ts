import { afterEach, describe, expect, it } from "vitest"
import { accountFixture } from "./testing"
import type { ExecutionGateway } from "./resource-tools"
import type { ProjectPermission } from "@/modules/identity/domain"
const closers: (() => Promise<void>)[] = []
afterEach(async () => { for (const close of closers.splice(0)) await close() })
async function fixture(executions?: ExecutionGateway) {
  const f = await accountFixture(executions); closers.push(f.close); await f.bootstrap(); const admin = await f.login(), aliceAccount = await f.createAccount(admin.cookie, "alice"), alice = await f.login("alice")
  const project = (await f.json("/projects", "POST", { name: "Team" }, admin.cookie)).data
  let state = await f.authentication.catalog.read()
  await f.authentication.catalog.saveMembership(state.revision, { accountId: aliceAccount.id, projectId: project.id, permissionRole: "editor", workRoleIds: [] })
  const root = `/projects/${project.id}`
  const token = async (permissions: ProjectPermission[]) => {
    const agent = await f.createAccount(admin.cookie, "robot", "agent"), state = await f.authentication.catalog.read()
    await f.authentication.catalog.saveMembership(state.revision, { accountId: agent.id, projectId: project.id, permissionRole: "editor", workRoleIds: [] })
    return (await f.json("/auth/tokens", "POST", { accountId: agent.id, projectId: project.id, label: "Fixture", workRoleId: null, permissions, expiresAt: "2026-11-02T00:00:00.000Z" }, admin.cookie)).data
  }
  return { ...f, admin, alice, aliceAccount, project, root, token }
}
describe("shared service authorization across all resource entry points", () => {
  it("does not bypass project membership for admin and denies unauthenticated/readonly writes through every transport", async () => {
    const f = await fixture(), other = (await f.json("/projects", "POST", { name: "Alice only" }, f.alice.cookie)).data
    expect((await f.request(`/projects/${other.id}/wiki`, "GET", undefined, f.admin.cookie)).status).toBe(403)
    expect((await f.json("/projects", "GET", undefined, f.admin.cookie)).data.map((project: { id: string }) => project.id)).not.toContain(other.id)
    let state = await f.authentication.catalog.read()
    await f.authentication.catalog.saveMembership(state.revision, { accountId: f.aliceAccount.id, projectId: f.project.id, permissionRole: "viewer", workRoleIds: [] })
    for (const suffix of ["/wiki", "/documents", "/workspace", "/events", "/tasks", "/memories"]) expect((await f.request(f.root + suffix)).status).toBe(401)
    for (const suffix of ["/wiki/page?path=wiki/a.md", "/workspace"]) expect((await f.request(f.root + suffix, "PUT", {}, f.alice.cookie, { "If-None-Match": "*" })).status).toBe(403)
    for (const suffix of ["/cli", "/mcp"]) expect((await f.request(f.root + suffix, "POST", { tool: "wiki.write", path: "wiki/a.md", content: "denied", expectedRevision: null, actorId: f.admin.data.account.id }, f.alice.cookie)).status).toBe(403)
    expect((await f.request(f.root + "/documents", "POST", {}, f.alice.cookie)).status).toBe(403)
    expect((await f.request(f.root + "/tasks", "POST", {}, f.alice.cookie)).status).toBe(403)
    expect((await f.request(f.root + "/tasks", "POST", {}, f.admin.cookie)).status).toBe(501)
    expect((await f.request(f.root + "/cli", "POST", { command: "echo unsafe" }, f.admin.cookie)).status).toBe(501)
    expect((await f.request(f.root + "/members", "PUT", { revision: 1 }, f.alice.cookie)).status).toBe(403)
  })
  it("enforces readonly Token scopes in CLI, MCP, retrieval, memory and filtered events", async () => {
    const f = await fixture()
    await f.request(f.root + "/wiki/page?path=wiki/a.md", "PUT", { content: "shared telescope evidence" }, f.admin.cookie, { "If-None-Match": "*" })
    await f.repository.save(f.project.id, "document", "hidden-doc", { name: "hidden document" }, null, "2026-11-01T00:00:00Z")
    const issued = await f.token(["project.read", "wiki.read"]), headers = { Authorization: `Bearer ${issued.secret}` }
    for (const route of ["cli", "mcp"]) {
      expect((await f.json(f.root + "/" + route, "POST", { tool: "wiki.read", path: "wiki/a.md" }, "", headers)).data.data.content).toContain("telescope")
      expect((await f.request(f.root + "/" + route, "POST", { tool: "wiki.write", path: "wiki/a.md", content: "denied", expectedRevision: 1 }, "", headers)).status).toBe(403)
      expect((await f.request(f.root + "/" + route, "POST", { tool: "documents.list" }, "", headers)).status).toBe(403)
      expect((await f.request(f.root + "/" + route, "POST", { tool: "memory.list" }, "", headers)).status).toBe(403)
    }
    expect((await f.json(f.root + "/retrieval", "POST", { query: "telescope" }, "", headers)).data.results).toHaveLength(1)
    const events = (await f.json(f.root + "/events", "GET", undefined, "", headers)).data
    expect(JSON.stringify(events)).not.toContain("hidden-doc")
    expect((await f.request("/projects/other/mcp", "POST", { tool: "wiki.read", path: "wiki/a.md" }, "", headers)).status).toBe(403)
  })
  it("filters private memories and hidden relations, preserves them on visible saves and requires an actual-owner grant even for admin", async () => {
    const f = await fixture(), base = (await f.json(f.root + "/workspace", "GET", undefined, f.alice.cookie)).data
    const memory = (id: string, title: string, relatedIds: string[] = []) => ({ id, title, content: title, category: "fact", domainIds: [], relatedIds, createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z" })
    const privateMemory = { ...memory("private", "PRIVATE-CONTENT"), access: { visibility: "private", ownerId: f.aliceAccount.id } }
    await f.json(f.root + "/workspace", "PUT", { ...base.data, memories: [memory("public", "Public", ["private"]), privateMemory] }, f.alice.cookie, { "If-Match": `"v${base.revision}"` })
    let view = (await f.json(f.root + "/workspace", "GET", undefined, f.admin.cookie)).data
    expect(JSON.stringify(view)).not.toContain("PRIVATE-CONTENT"); expect(view.data.memories[0].relatedIds).toEqual([])
    view.data.memories[0].content = "public edit"
    expect((await f.json(f.root + "/workspace", "PUT", view.data, f.admin.cookie, { "If-Match": `"v${view.revision}"` })).response.status).toBe(200)
    const preserved = (await f.json(f.root + "/workspace", "GET", undefined, f.alice.cookie)).data
    expect(preserved.data.memories.find((memory: { id: string }) => memory.id === "private").content).toBe("PRIVATE-CONTENT")
    view = (await f.json(f.root + "/workspace", "GET", undefined, f.admin.cookie)).data
    expect((await f.request(f.root + "/workspace", "PUT", { ...view.data, memories: [...view.data.memories, privateMemory] }, f.admin.cookie, { "If-Match": `"v${view.revision}"` })).status).toBe(403)
    expect((await f.request(f.root + "/memories/private/grants", "POST", { accountId: f.admin.data.account.id, actions: ["read"], expiresAt: "2026-11-02T00:00:00Z" }, f.admin.cookie)).status).toBe(403)
    const grant = (await f.json(f.root + "/memories/private/grants", "POST", { accountId: f.admin.data.account.id, actions: ["read"], expiresAt: "2026-11-02T00:00:00Z" }, f.alice.cookie)).data
    view = (await f.json(f.root + "/workspace", "GET", undefined, f.admin.cookie)).data
    expect(view.data.memories).toHaveLength(2)
    view.data.memories.find((memory: { id: string }) => memory.id === "private").content = "denied"
    expect((await f.request(f.root + "/workspace", "PUT", view.data, f.admin.cookie, { "If-Match": `"v${view.revision}"` })).status).toBe(403)
    await f.request(f.root + "/memories/private/grants/" + grant.id, "DELETE", undefined, f.alice.cookie)
    expect(JSON.stringify((await f.json(f.root + "/workspace", "GET", undefined, f.admin.cookie)).data)).not.toContain("PRIVATE-CONTENT")
  })
  it("keeps running tasks bound to their original context and checks revocation before resource writes and result delivery", async () => {
    let signalStarted!: () => void, release!: () => void, capturedActor = "", capturedEffective = "", rejectedOtherProject = false
    const started = new Promise<void>(resolve => { signalStarted = resolve }), resume = new Promise<void>(resolve => { release = resolve })
    const f = await fixture({ async execute(_kind, _action, _input, access) {
      capturedActor = access.context.actorId; capturedEffective = access.context.effectiveAccountId
      try { await access.resources.get("other-project", "wiki", "wiki/a.md") } catch { rejectedOtherProject = true }
      signalStarted(); await resume
      await access.check("wiki.write")
      await access.resources.save(access.context.projectId, "wiki", "wiki/task.md", { content: "must not write after revoke" }, null, "2026-11-01T00:00:00Z")
      return { captured: access.context }
    } })
    const issued = await f.token(["project.read", "wiki.read", "wiki.write", "tasks.manage"]), headers = { Authorization: `Bearer ${issued.secret}` }
    const running = f.request(f.root + "/tasks", "POST", {}, "", headers)
    await started
    expect(rejectedOtherProject).toBe(true); expect(capturedActor).toBe(issued.token.accountId); expect(capturedEffective).toBe(issued.token.accountId)
    await f.request(`/auth/tokens/${issued.token.id}`, "DELETE", undefined, f.admin.cookie)
    release()
    expect((await running).status).toBe(401)
    expect(await f.repository.get(f.project.id, "wiki", "wiki/task.md")).toBeNull()
  })
  it("closes an established event stream after logout instead of retaining old authorization", async () => {
    const f = await fixture(), controller = new AbortController()
    const response = await fetch(f.origin + "/api/v1" + f.root + "/events/stream", { signal: controller.signal, headers: { Cookie: f.alice.cookie } })
    expect(response.status).toBe(200)
    const reader = response.body!.getReader(); await reader.read()
    await f.request("/auth/logout", "POST", {}, f.alice.cookie)
    const timeout = setTimeout(() => controller.abort(), 3000)
    try { for (;;) { if ((await reader.read()).done) break } } finally { clearTimeout(timeout); controller.abort() }
  })
  it("requires the selected granted work role to see role-shared memory", async () => {
    const f = await fixture()
    let state = await f.authentication.catalog.read()
    state = await f.authentication.catalog.saveWorkRole(state.revision, { projectId: f.project.id, name: "Research", permissionRole: "editor", permissions: ["project.read", "memory.read", "memory.write"] })
    const role = state.catalog.workRoles[0]
    await f.authentication.catalog.saveMembership(state.revision, { accountId: f.aliceAccount.id, projectId: f.project.id, permissionRole: "editor", workRoleIds: [role.id] })
    const selected = (await f.json(f.root + "/contexts", "POST", { workRoleId: role.id }, f.alice.cookie)).data
    const headers = { "X-KW-Context": selected.id }
    const base = (await f.json(f.root + "/workspace", "GET", undefined, f.alice.cookie, headers)).data
    const memory = { id: "role-memory", title: "ROLE-SECRET", content: "ROLE-SECRET", category: "fact", domainIds: [], relatedIds: [], createdAt: "time", updatedAt: "time", access: { visibility: "role", ownerId: f.aliceAccount.id, workRoleIds: [role.id] } }
    expect((await f.json(f.root + "/workspace", "PUT", { ...base.data, memories: [memory] }, f.alice.cookie, { ...headers, "If-Match": `"v${base.revision}"` })).response.status).toBe(200)
    expect(JSON.stringify((await f.json(f.root + "/workspace", "GET", undefined, f.alice.cookie)).data)).not.toContain("ROLE-SECRET")
    expect(JSON.stringify((await f.json(f.root + "/workspace", "GET", undefined, f.alice.cookie, headers)).data)).toContain("ROLE-SECRET")
    expect(JSON.stringify((await f.json(f.root + "/workspace", "GET", undefined, f.admin.cookie)).data)).not.toContain("ROLE-SECRET")
  })

})
