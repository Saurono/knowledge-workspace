import { afterEach, describe, expect, it } from "vitest"
import { accountFixture } from "./testing"
const cleanups: (() => Promise<void>)[] = []
afterEach(async () => { for (const close of cleanups.splice(0)) await close() })
describe("server-authenticated access contexts", () => {
  it("captures verified actor rather than client identity headers and requires project membership", async () => {
    const f = await accountFixture(); cleanups.push(f.close); await f.bootstrap(); const admin = await f.login()
    const project = (await f.json("/projects", "POST", { name: "Project" }, admin.cookie)).data
    const state = await f.authentication.catalog.read()
    await f.authentication.catalog.saveMembership(state.revision, { accountId: admin.data.account.id, projectId: project.id, permissionRole: "manager", workRoleIds: [] })
    const result = await f.json(`/projects/${project.id}/access?accountId=spoof`, "GET", undefined, admin.cookie, { "X-Account-Id": "spoof", "X-Role": "admin" })
    expect(result.response.status).toBe(200)
    expect(result.data).toMatchObject({ actorId: admin.data.account.id, effectiveAccountId: admin.data.account.id, projectId: project.id, credential: { channel: "session" } })
    expect((await f.request("/projects/unrelated/access", "GET", undefined, admin.cookie)).status).toBe(403)
  })
})

describe("role and delegated identity switching", () => {
  it("requires explicit grants, binds contexts to credential/project and rechecks revocation without changing old contexts", async () => {
    const f = await accountFixture(); cleanups.push(f.close); await f.bootstrap(); const admin = await f.login(), userAccount = await f.createAccount(admin.cookie, "alice"), user = await f.login("alice")
    const project = (await f.json("/projects", "POST", { name: "Project" }, admin.cookie)).data
    let state = await f.authentication.catalog.read()
    state = await f.authentication.catalog.saveMembership(state.revision, { accountId: admin.data.account.id, projectId: project.id, permissionRole: "manager", workRoleIds: [] })
    state = await f.authentication.catalog.saveMembership(state.revision, { accountId: userAccount.id, projectId: project.id, permissionRole: "viewer", workRoleIds: [] })
    state = await f.authentication.catalog.saveWorkRole(state.revision, { projectId: project.id, name: "Writer", permissionRole: "editor", permissions: ["project.read", "wiki.read", "wiki.write"] })
    const role = state.catalog.workRoles[0]
    state = await f.authentication.catalog.saveMembership(state.revision, { accountId: admin.data.account.id, projectId: project.id, permissionRole: "manager", workRoleIds: [role.id] })
    const root = `/projects/${project.id}`
    expect((await f.json(root + "/contexts", "POST", { effectiveAccountId: admin.data.account.id }, user.cookie)).response.status).toBe(403)
    expect((await f.json(root + "/contexts", "POST", { workRoleId: role.id }, user.cookie)).response.status).toBe(403)
    const grant = (await f.json(root + "/delegations", "POST", { granteeId: userAccount.id, workRoleId: role.id, permissions: ["project.read", "wiki.read", "wiki.write"], expiresAt: "2026-11-02T00:00:00.000Z" }, admin.cookie)).data
    const borrowed = await f.json(root + "/contexts", "POST", { effectiveAccountId: admin.data.account.id, delegationId: grant.id }, user.cookie)
    expect(borrowed.response.status).toBe(201)
    expect(borrowed.data).toMatchObject({ actorId: userAccount.id, effectiveAccountId: admin.data.account.id, workRoleId: role.id, basis: { delegationId: grant.id } })
    expect(borrowed.data.permissions).toContain("wiki.write")
    const own = await f.json(root + "/contexts", "POST", {}, user.cookie)
    expect(own.data.permissions).not.toContain("wiki.write")
    const header = { "X-KW-Context": borrowed.data.id }
    expect((await f.json(root + "/access", "GET", undefined, user.cookie, header)).data.permissions).toContain("wiki.write")
    const otherLogin = await f.login("alice")
    expect((await f.request(root + "/access", "GET", undefined, otherLogin.cookie, header)).status).toBe(403)
    expect((await f.request("/projects/other/access", "GET", undefined, user.cookie, header)).status).toBe(403)
    await f.request(root + "/delegations/" + grant.id, "DELETE", undefined, admin.cookie)
    expect((await f.request(root + "/access", "GET", undefined, user.cookie, header)).status).toBe(403)
    expect((await f.json(root + "/access", "GET", undefined, user.cookie, { "X-KW-Context": own.data.id })).data.permissions).not.toContain("wiki.write")
  })
  it("does not upgrade a previously captured execution when membership gains rights; rejects expired delegation", async () => {
    const f = await accountFixture(); cleanups.push(f.close); await f.bootstrap(); const admin = await f.login(), userAccount = await f.createAccount(admin.cookie, "alice"), user = await f.login("alice")
    const project = (await f.json("/projects", "POST", { name: "Project" }, admin.cookie)).data
    let state = await f.authentication.catalog.read()
    state = await f.authentication.catalog.saveMembership(state.revision, { accountId: admin.data.account.id, projectId: project.id, permissionRole: "manager", workRoleIds: [] })
    state = await f.authentication.catalog.saveMembership(state.revision, { accountId: userAccount.id, projectId: project.id, permissionRole: "viewer", workRoleIds: [] })
    const captured = (await f.json(`/projects/${project.id}/contexts`, "POST", {}, user.cookie)).data
    await f.authentication.catalog.saveMembership(state.revision, { accountId: userAccount.id, projectId: project.id, permissionRole: "editor", workRoleIds: [] })
    const previous = (await f.json(`/projects/${project.id}/access`, "GET", undefined, user.cookie, { "X-KW-Context": captured.id })).data
    expect(previous.permissions).not.toContain("wiki.write")
    expect((await f.json(`/projects/${project.id}/access`, "GET", undefined, user.cookie)).data.permissions).toContain("wiki.write")
    const grant = (await f.json(`/projects/${project.id}/delegations`, "POST", { granteeId: userAccount.id, permissions: ["project.read", "wiki.read"], expiresAt: "2026-11-01T00:01:00.000Z" }, admin.cookie)).data
    f.clock("2026-11-01T00:02:00.000Z")
    expect((await f.json(`/projects/${project.id}/contexts`, "POST", { effectiveAccountId: admin.data.account.id, delegationId: grant.id }, user.cookie)).response.status).toBe(403)
  })
})
