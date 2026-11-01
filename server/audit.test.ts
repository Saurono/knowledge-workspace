import { afterEach, describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { accountFixture } from "./testing"
const cleanups: (() => Promise<void>)[] = []
afterEach(async () => { for (const close of cleanups.splice(0)) await close() })
describe("persistent authorization audit", () => {
  it("records actual/effective identity, denied access and cursor pages without credentials, body or query text", async () => {
    const f = await accountFixture(); cleanups.push(f.close); await f.bootstrap(); const admin = await f.login(), aliceAccount = await f.createAccount(admin.cookie, "alice"), alice = await f.login("alice")
    const project = (await f.json("/projects", "POST", { name: "Team" }, admin.cookie)).data, root = `/projects/${project.id}`
    let state = await f.authentication.catalog.read()
    await f.authentication.catalog.saveMembership(state.revision, { accountId: aliceAccount.id, projectId: project.id, permissionRole: "viewer", workRoleIds: [] })
    const grant = (await f.json(root + "/delegations", "POST", { granteeId: aliceAccount.id, permissions: ["project.read", "wiki.read", "wiki.write"], expiresAt: "2026-11-02T00:00:00Z" }, admin.cookie)).data
    const context = (await f.json(root + "/contexts", "POST", { effectiveAccountId: admin.data.account.id, delegationId: grant.id }, alice.cookie)).data
    const secretBody = "PRIVATE-NOTE-DO-NOT-AUDIT", secretQuery = "private-query-do-not-audit"
    await f.request(root + "/wiki/page?path=wiki/a.md", "PUT", { content: secretBody }, alice.cookie, { "If-None-Match": "*", "X-KW-Context": context.id })
    await f.request(root + "/search", "POST", { query: secretQuery }, alice.cookie)
    expect((await f.request(root + "/wiki/page?path=wiki/a.md", "PUT", { content: "denied" }, alice.cookie, { "If-Match": '"v1"' })).status).toBe(403)
    const first = (await f.json(root + "/audit?limit=2", "GET", undefined, admin.cookie)).data
    expect(first.items).toHaveLength(2); expect(first.nextCursor).not.toBeNull()
    const older = (await f.json(root + `/audit?before=${first.nextCursor}&limit=100`, "GET", undefined, admin.cookie)).data
    expect(older.items.every((entry: { sequence: number }) => entry.sequence < first.nextCursor)).toBe(true)
    const all = (await f.json(root + "/audit?limit=100", "GET", undefined, admin.cookie)).data.items
    expect(all.some((entry: { actorId: string; effectiveAccountId: string; contextId: string; result: string }) => entry.actorId === aliceAccount.id && entry.effectiveAccountId === admin.data.account.id && entry.contextId === context.id && entry.result === "allowed")).toBe(true)
    expect(all.some((entry: { actorId: string; result: string }) => entry.actorId === aliceAccount.id && entry.result === "denied")).toBe(true)
    const own = (await f.json(root + "/audit", "GET", undefined, alice.cookie)).data.items
    expect(own.every((entry: { actorId: string }) => entry.actorId === aliceAccount.id)).toBe(true)
    expect((await f.request(root + `/audit?actor=${admin.data.account.id}`, "GET", undefined, alice.cookie)).status).toBe(403)
    const globalOwn = (await f.json("/auth/audit", "GET", undefined, alice.cookie)).data.items
    expect(globalOwn.every((entry: { actorId: string }) => entry.actorId === aliceAccount.id)).toBe(true)
    const serialized = JSON.stringify(await f.repository.audit.list(project.id, undefined))
    expect(serialized).not.toContain(secretBody); expect(serialized).not.toContain(secretQuery); expect(serialized).not.toContain(alice.cookie.slice("kw_session=".length))
    // Audit storage is persistent, not an in-memory UI trace.
    expect(readFileSync(join(f.directory, "service.sqlite-wal")).includes(Buffer.from("PUT /api/v1/projects/:id/wiki/page"))).toBe(true)
    const beforeRestart = await f.repository.audit.list(project.id, undefined)
    await f.restart()
    expect(await f.repository.audit.list(project.id, undefined)).toEqual(beforeRestart)
    expect((await f.json(root + "/access", "GET", undefined, alice.cookie, { "X-KW-Context": context.id })).data.effectiveAccountId).toBe(admin.data.account.id)
    const options = (await f.json(root + "/access/options", "GET", undefined, alice.cookie)).data
    expect(options.some((option: { id: string }) => option.id === grant.id)).toBe(true)
  })
  it("does not let admin query another project's audit without membership or expose plaintext Token issuance", async () => {
    const f = await accountFixture(); cleanups.push(f.close); await f.bootstrap(); const admin = await f.login(), userAccount = await f.createAccount(admin.cookie, "alice"), alice = await f.login("alice")
    const privateProject = (await f.json("/projects", "POST", { name: "Private" }, alice.cookie)).data
    expect((await f.request(`/projects/${privateProject.id}/audit`, "GET", undefined, admin.cookie)).status).toBe(403)
    expect((await f.request("/admin/audit", "GET", undefined, alice.cookie)).status).toBe(403)
    const project = (await f.json("/projects", "POST", { name: "Admin team" }, admin.cookie)).data, agent = await f.createAccount(admin.cookie, "robot", "agent"), state = await f.authentication.catalog.read()
    await f.authentication.catalog.saveMembership(state.revision, { projectId: project.id, accountId: agent.id, permissionRole: "viewer", workRoleIds: [] })
    const minted = (await f.json("/auth/tokens", "POST", { accountId: agent.id, projectId: project.id, workRoleId: null, permissions: ["project.read", "wiki.read"], label: "Reader", expiresAt: "2026-11-02T00:00:00Z" }, admin.cookie)).data
    const audit = (await f.json(`/projects/${project.id}/audit`, "GET", undefined, admin.cookie)).data
    expect(JSON.stringify(audit)).not.toContain(minted.secret)
    expect(audit.items.some((entry: { action: string }) => entry.action === "POST /api/v1/auth/tokens")).toBe(true)
    expect((await f.request(`/projects/${project.id}/audit?limit=1000`, "GET", undefined, admin.cookie)).status).toBe(400)
    expect(userAccount.id).toBeTruthy()
  })
})
