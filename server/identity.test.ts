import { afterEach, describe, expect, it } from "vitest"
import { DatabaseSync } from "node:sqlite"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createIdentityCatalogService } from "@/modules/identity/application"
import { evaluateProjectPermission } from "@/modules/identity/domain"
import { SqliteRepository } from "./repository"
const now = "2026-11-01T00:00:00.000Z"
const cleanups: (() => void)[] = []
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup() })
function directory() {
  const path = mkdtempSync(join(tmpdir(), "kw-identity-"))
  cleanups.push(() => rmSync(path, { recursive: true, force: true }))
  return path
}
async function fixture() {
  const path = directory(); let repository = new SqliteRepository(path), id = 0
  await repository.createProject({ id: "p", name: "Project", createdAt: now }, {})
  const service = () => createIdentityCatalogService(repository.identities, { id: () => `identity-${++id}`, now: () => now, projectExists: async id => !!(await repository.project(id)) })
  cleanups.push(() => repository.close())
  return { service, repo: () => repository, restart: () => { repository.close(); repository = new SqliteRepository(path) } }
}
describe("persisted identity catalog", () => {
  it("normalizes unique handles, protects the last admin and persists disabled identities on restart", async () => {
    const f = await fixture(), service = f.service()
    let state = await service.createAccount(1, { handle: " ＡＤＭＩＮ ", displayName: " Owner ", kind: "admin" })
    const first = state.catalog.accounts[0]
    expect(first).toMatchObject({ handle: "admin", displayName: "Owner", kind: "admin" })
    await expect(service.createAccount(state.revision, { handle: "Admin", displayName: "Duplicate", kind: "user" })).rejects.toMatchObject({ code: "invalid_argument" })
    await expect(service.setAccountStatus(state.revision, first.id, "disabled")).rejects.toMatchObject({ code: "last_admin" })
    expect((await service.read()).revision).toBe(state.revision)
    state = await service.createAccount(state.revision, { handle: "backup", displayName: "Backup", kind: "admin" })
    state = await service.setAccountStatus(state.revision, first.id, "disabled")
    expect((await service.setAccountStatus(state.revision, first.id, "disabled")).revision).toBe(state.revision)
    f.restart()
    expect(await f.service().read()).toEqual(state)
    // Caller-owned snapshots cannot mutate persisted state.
    state.catalog.accounts[0].handle = "changed"
    expect((await f.service().read()).catalog.accounts[0].handle).toBe("admin")
  })
  it("allows only one concurrent revision update across connections and recovers after rollback", async () => {
    const path = directory(), first = new SqliteRepository(path), second = new SqliteRepository(path)
    cleanups.push(() => { first.close(); second.close() })
    const make = (repo: SqliteRepository, id: string) => createIdentityCatalogService(repo.identities, { id: () => id, now: () => now, projectExists: async () => false })
    const results = await Promise.allSettled([make(first, "one").createAccount(1, { handle: "alice", displayName: "Alice", kind: "user" }), make(second, "two").createAccount(1, { handle: "agent", displayName: "Agent", kind: "agent" })])
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1)
    const rejected = results.find(result => result.status === "rejected") as PromiseRejectedResult
    expect(rejected.reason).toMatchObject({ code: "conflict", actualRevision: 2 })
    expect((await second.identities.read()).catalog.accounts).toHaveLength(1)
    await expect(second.identities.update(2, () => { throw new Error("aborted change") })).rejects.toThrow("aborted change")
    expect((await make(second, "three").createAccount(2, { handle: "third", displayName: "Third", kind: "agent" })).revision).toBe(3)
  })
  it("maintains project membership ceilings and preserves granted identity when a work role is retired", async () => {
    const f = await fixture(), service = f.service()
    let state = await service.createAccount(1, { handle: "worker", displayName: "Worker", kind: "agent" })
    const accountId = state.catalog.accounts[0].id
    await expect(service.saveMembership(state.revision, { projectId: "missing", accountId, permissionRole: "editor", workRoleIds: [] })).rejects.toMatchObject({ code: "not_found" })
    state = await service.saveWorkRole(state.revision, { projectId: "p", name: "Research", permissionRole: "viewer", permissions: ["wiki.read", "memory.read"] })
    const role = state.catalog.workRoles[0]
    state = await service.saveMembership(state.revision, { projectId: "p", accountId, permissionRole: "editor", workRoleIds: [role.id] })
    const memberId = state.catalog.memberships[0].id
    await expect(service.saveWorkRole(state.revision, { ...role, permissionRole: "manager" })).rejects.toMatchObject({ code: "invalid_argument" })
    await expect(service.saveMembership(state.revision, { projectId: "p", accountId: "missing", permissionRole: "editor", workRoleIds: [] })).rejects.toMatchObject({ code: "invalid_argument" })
    state = await service.saveWorkRole(state.revision, { ...role, status: "retired" })
    expect(evaluateProjectPermission(state.catalog, { accountId, projectId: "p", workRoleId: role.id, permission: "wiki.read" }).reason).toBe("role_not_granted")
    state = await service.saveMembership(state.revision, { projectId: "p", accountId, permissionRole: "editor", workRoleIds: [], status: "revoked" })
    expect(state.catalog.memberships[0].id).toBe(memberId)
    state = await service.saveMembership(state.revision, { projectId: "p", accountId, permissionRole: "viewer", workRoleIds: [] })
    expect(state.catalog.memberships[0].status).toBe("revoked")
    expect(evaluateProjectPermission(state.catalog, { accountId, projectId: "p", permission: "wiki.read" }).reason).toBe("membership_required")
    f.restart(); expect(await f.service().read()).toEqual(state)
  })
  it("migrates a real schema-1 database without changing project resources, revisions or events", async () => {
    const path = directory(), db = new DatabaseSync(join(path, "service.sqlite"))
    // Exact C02 table layout, with no identity catalog present.
    db.exec(`CREATE TABLE projects(id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE resources(project_id TEXT NOT NULL REFERENCES projects(id), kind TEXT NOT NULL, key TEXT NOT NULL, data TEXT NOT NULL, revision INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(project_id,kind,key));
      CREATE TABLE events(sequence INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL REFERENCES projects(id), type TEXT NOT NULL, kind TEXT NOT NULL, key TEXT NOT NULL, revision INTEGER NOT NULL, recorded_at TEXT NOT NULL);
      CREATE INDEX events_project_sequence ON events(project_id,sequence);
      PRAGMA user_version=1;`)
    db.prepare("INSERT INTO projects VALUES(?,?,?)").run("p", "Existing", now)
    db.prepare("INSERT INTO resources VALUES(?,?,?,?,?,?,?,0)").run("p", "wiki", "wiki/a.md", JSON.stringify({ content: "preserved" }), 7, now, now)
    db.prepare("INSERT INTO events(project_id,type,kind,key,revision,recorded_at) VALUES(?,?,?,?,?,?)").run("p", "resource.updated", "wiki", "wiki/a.md", 7, now)
    const before = { projects: db.prepare("SELECT * FROM projects").all(), resources: db.prepare("SELECT * FROM resources").all(), events: db.prepare("SELECT * FROM events").all() }
    db.close()
    const repo = new SqliteRepository(path)
    expect(await repo.identities.read()).toMatchObject({ revision: 1, catalog: { accounts: [], memberships: [], workRoles: [] } })
    expect(await repo.get("p", "wiki", "wiki/a.md")).toMatchObject({ revision: 7, data: { content: "preserved" } })
    repo.close()
    const reopened = new DatabaseSync(join(path, "service.sqlite"))
    expect(reopened.prepare("PRAGMA user_version").get()).toMatchObject({ user_version: 2 })
    expect({ projects: reopened.prepare("SELECT * FROM projects").all(), resources: reopened.prepare("SELECT * FROM resources").all(), events: reopened.prepare("SELECT * FROM events").all() }).toEqual(before)
    reopened.close()
  })
  it("rejects future schema versions and corrupt identity data without silently resetting them", () => {
    const path = directory(), repo = new SqliteRepository(path); repo.close()
    let db = new DatabaseSync(join(path, "service.sqlite"))
    db.exec("PRAGMA user_version=99"); db.close()
    expect(() => new SqliteRepository(path)).toThrow("Unsupported service database schema")
    db = new DatabaseSync(join(path, "service.sqlite"))
    expect(db.prepare("PRAGMA user_version").get()).toMatchObject({ user_version: 99 })
    db.exec("PRAGMA user_version=2")
    db.prepare("UPDATE identity_catalog SET data=?").run('{"schemaVersion":999}')
    db.close()
    expect(() => new SqliteRepository(path)).toThrow("Unsupported identity catalog")
    db = new DatabaseSync(join(path, "service.sqlite"))
    expect(db.prepare("SELECT data FROM identity_catalog").get()).toMatchObject({ data: '{"schemaVersion":999}' })
    db.close()
  })
})
