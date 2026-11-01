import { afterEach, describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { accountFixture } from "./testing"
const close: (() => Promise<void>)[] = []
afterEach(async () => { for (const cleanup of close.splice(0)) await cleanup() })
async function fixture() {
  const f = await accountFixture(); close.push(f.close); await f.bootstrap(); const admin = await f.login(), agent = await f.createAccount(admin.cookie, "robot", "agent")
  const project = (await f.json("/projects", "POST", { name: "Project" }, admin.cookie)).data
  let state = await f.authentication.catalog.read()
  state = await f.authentication.catalog.saveMembership(state.revision, { projectId: project.id, accountId: admin.data.account.id, permissionRole: "manager", workRoleIds: [] })
  await f.authentication.catalog.saveMembership(state.revision, { projectId: project.id, accountId: agent.id, permissionRole: "editor", workRoleIds: [] })
  const mint = (override = {}) => f.json("/auth/tokens", "POST", { accountId: agent.id, projectId: project.id, workRoleId: null, label: "Reader", permissions: ["project.read", "wiki.read"], expiresAt: "2026-11-02T00:00:00.000Z", ...override }, admin.cookie)
  return { ...f, mint, admin, agent, project }
}
describe("scoped Agent Tokens", () => {
  it("returns plaintext once, stores only digests, limits routes/projects and revokes immediately", async () => {
    const f = await fixture(), created = await f.mint()
    expect(created.response.status).toBe(201); const raw = created.data.secret, headers = { Authorization: `Bearer ${raw}` }
    const list = await f.json("/auth/tokens", "GET", undefined, f.admin.cookie)
    expect(JSON.stringify(list.data)).not.toContain(raw); expect(JSON.stringify(list.data)).not.toContain("digest")
    expect(readFileSync(join(f.directory, "service.sqlite-wal")).includes(Buffer.from(raw))).toBe(false)
    expect((await f.request(`/projects/${f.project.id}/wiki`, "GET", undefined, "", headers)).status).toBe(200)
    expect((await f.request(`/projects/${f.project.id}/wiki/page?path=wiki/a.md`, "PUT", { content: "deny" }, "", { ...headers, "If-None-Match": "*" })).status).toBe(403)
    expect((await f.request("/projects/other/wiki", "GET", undefined, "", headers)).status).toBe(403)
    expect((await f.json("/projects", "GET", undefined, "", headers)).data.map((item: { id: string }) => item.id)).toEqual([f.project.id])
    await f.request(`/auth/tokens/${created.data.token.id}`, "DELETE", undefined, f.admin.cookie)
    expect((await f.request("/auth/me", "GET", undefined, "", headers)).status).toBe(401)
  })
  it("rejects excessive scope, wrong account/role, token chaining, expiry and membership loss", async () => {
    const f = await fixture()
    expect((await f.mint({ permissions: ["project.read", "accounts.manage"] })).response.status).toBe(400)
    expect((await f.mint({ permissions: ["project.read", "members.manage"] })).response.status).toBe(403)
    expect((await f.mint({ workRoleId: "ungranted" })).response.status).toBe(403)
    expect((await f.mint({ accountId: f.admin.data.account.id })).response.status).toBe(400)
    expect((await f.mint({ expiresAt: "2030-01-01T00:00:00.000Z" })).response.status).toBe(400)
    const created = await f.mint(), headers = { Authorization: `Bearer ${created.data.secret}` }
    expect((await f.request("/auth/tokens", "POST", {}, "", headers)).status).toBe(403)
    f.clock("2026-11-03T00:00:00.000Z")
    expect((await f.request("/auth/me", "GET", undefined, "", headers)).status).toBe(401)
    f.clock("2026-11-01T00:00:00.000Z")
    const state = await f.authentication.catalog.read()
    await f.authentication.catalog.saveMembership(state.revision, { accountId: f.agent.id, projectId: f.project.id, permissionRole: "editor", status: "revoked", workRoleIds: [] })
    expect((await f.request("/auth/me", "GET", undefined, "", headers)).status).toBe(401)
  })
  it("limits bearer credential management to itself and cannot turn a temporary Token into a lasting identity delegation", async () => {
    const f = await fixture(), first = await f.mint(), secondProject = (await f.json("/projects", "POST", { name: "Other" }, f.admin.cookie)).data
    const state = await f.authentication.catalog.read()
    await f.authentication.catalog.saveMembership(state.revision, { projectId: secondProject.id, accountId: f.agent.id, permissionRole: "editor", workRoleIds: [] })
    const second = await f.mint({ projectId: secondProject.id }), headers = { Authorization: `Bearer ${first.data.secret}` }
    const visible = (await f.json("/auth/tokens", "GET", undefined, "", headers)).data
    expect(visible.map((token: { id: string }) => token.id)).toEqual([first.data.token.id])
    expect((await f.request(`/auth/tokens/${second.data.token.id}`, "DELETE", undefined, "", headers)).status).toBe(404)
    expect((await f.request("/auth/me", "GET", undefined, "", { Authorization: `Bearer ${second.data.secret}` })).status).toBe(200)
    expect((await f.request(`/projects/${f.project.id}/delegations`, "POST", { granteeId: f.admin.data.account.id, permissions: ["project.read", "wiki.read"], expiresAt: "2026-11-02T00:00:00Z" }, "", headers)).status).toBe(403)
    expect((await f.request(`/auth/tokens/${first.data.token.id}`, "DELETE", undefined, "", headers)).status).toBe(200)
    expect((await f.request("/auth/me", "GET", undefined, "", headers)).status).toBe(401)
  })

})
