import { afterEach, describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { accountFixture, fixturePassword } from "./testing"
const closers: (() => Promise<void>)[] = []
afterEach(async () => { for (const close of closers.splice(0)) await close() })
async function fixture() { const f = await accountFixture(); closers.push(f.close); return f }
describe("account login and session lifecycle", () => {
  it("uses the initialization key only once, hashes passwords, and never authenticates data with that key", async () => {
    const f = await fixture()
    expect((await f.json("/auth/status")).data.initialized).toBe(false)
    expect((await f.json("/auth/bootstrap", "POST", { handle: "admin", displayName: "Admin", password: fixturePassword })).response.status).toBe(403)
    const results = await Promise.all([f.bootstrap(), f.bootstrap()]); expect(results.map(result => result.response.status).sort()).toEqual([201, 409])
    expect((await f.json("/auth/status")).data.initialized).toBe(true)
    expect((await f.request("/projects", "GET", undefined, "", { Authorization: `Bearer ${f.setupKey}` })).status).toBe(401)
    const login = await f.login(); expect(login.response.status).toBe(200)
    const cookie = login.response.headers.get("set-cookie")!; expect(cookie).toContain("HttpOnly; SameSite=Strict")
    expect((await f.json("/auth/me", "GET", undefined, login.cookie)).data.account.kind).toBe("admin")
    expect(JSON.stringify((await f.json("/admin/accounts", "GET", undefined, login.cookie)).data)).not.toMatch(/scrypt|digest|password/)
    expect(readFileSync(join(f.directory, "service.sqlite-wal")).includes(Buffer.from(fixturePassword))).toBe(false)
  })
  it("invalidates logout, idle/absolute expiry, password changes and disabled accounts; Agent has no password login", async () => {
    const f = await fixture(); await f.bootstrap(); const admin = await f.login()
    const user = await f.createAccount(admin.cookie, "alice"); await f.createAccount(admin.cookie, "robot", "agent")
    expect((await f.login("robot")).response.status).toBe(401)
    let session = await f.login("alice")
    expect((await f.json("/auth/logout", "POST", {}, session.cookie)).response.status).toBe(200)
    expect((await f.request("/auth/me", "GET", undefined, session.cookie)).status).toBe(401)
    session = await f.login("alice")
    f.clock("2026-11-01T00:31:00.000Z")
    expect((await f.request("/auth/me", "GET", undefined, session.cookie)).status).toBe(401)
    f.clock("2026-11-01T00:00:00.000Z"); session = await f.login("alice")
    expect((await f.json("/auth/password", "POST", { oldPassword: fixturePassword, newPassword: "New-password-23581!" }, session.cookie)).response.status).toBe(200)
    expect((await f.request("/auth/me", "GET", undefined, session.cookie)).status).toBe(401)
    session = await f.login("alice", "New-password-23581!")
    let state = (await f.json("/admin/accounts", "GET", undefined, admin.cookie)).data
    state = (await f.json(`/admin/accounts/${user.id}/status`, "PUT", { revision: state.revision, status: "disabled" }, admin.cookie)).data
    expect((await f.request("/auth/me", "GET", undefined, session.cookie)).status).toBe(401)
    await f.json(`/admin/accounts/${user.id}/status`, "PUT", { revision: state.revision, status: "active" }, admin.cookie)
    expect((await f.request("/auth/me", "GET", undefined, session.cookie)).status).toBe(401)
    const fresh = await f.login("alice", "New-password-23581!")
    f.clock("2026-11-01T13:00:00.000Z")
    expect((await f.request("/auth/me", "GET", undefined, fresh.cookie)).status).toBe(401)
  })
  it("rejects cross-origin mutations, missing CSRF headers and non-admin account management; throttles bad logins", async () => {
    const f = await fixture(); await f.bootstrap(); const admin = await f.login()
    await f.createAccount(admin.cookie, "alice"); const user = await f.login("alice")
    expect((await f.request("/admin/accounts", "GET", undefined, user.cookie)).status).toBe(403)
    expect((await f.request("/auth/logout", "POST", {}, user.cookie, { "X-KW-CSRF": "" })).status).toBe(403)
    expect((await f.request("/auth/logout", "POST", {}, user.cookie, { Origin: "https://other.invalid" })).status).toBe(403)
    for (let i = 0; i < 5; i++) expect((await f.login("unknown", "bad-password")).response.status).toBe(401)
    expect((await f.login("unknown", "bad-password")).response.status).toBe(429)
  })
  it("initializes a pre-C05 admin without changing its stable account or memberships", async () => {
    const f = await fixture()
    const state = await f.authentication.catalog.createAccount(1, { handle: "admin", displayName: "Legacy Admin", kind: "admin" }), id = state.catalog.accounts[0].id
    expect((await f.json("/auth/status")).data.initialized).toBe(false)
    const bootstrapped = await f.bootstrap()
    expect(bootstrapped.data.account.id).toBe(id)
    expect((await f.authentication.catalog.read()).catalog.accounts).toHaveLength(1)
    expect((await f.login()).response.status).toBe(200)
    expect((await f.bootstrap()).response.status).toBe(409)
  })

})
