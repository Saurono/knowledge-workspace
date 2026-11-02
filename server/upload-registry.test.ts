import { afterEach, describe, expect, it } from "vitest"
import { DatabaseSync } from "node:sqlite"
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AddressInfo } from "node:net"
import { SqliteRepository, SERVICE_SCHEMA_VERSION } from "./repository"
import { createAccountAuthentication } from "./auth-http"
import { createServiceHttp } from "./http"
import { DiskUploads } from "./uploads"

const closers: Array<() => Promise<void>> = []
const password = "Upload-registry-fixture-4917!"

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "kw-upload-registry-")), setupKey = "schema-fixture-setup-key-not-production"
  let repository: SqliteRepository, authentication: ReturnType<typeof createAccountAuthentication>, http: ReturnType<typeof createServiceHttp>, origin = "", running = false
  const start = async () => {
    repository = new SqliteRepository(directory)
    authentication = createAccountAuthentication(repository, setupKey)
    http = createServiceHttp({ repository, authentication, uploads: new DiskUploads(directory) })
    await new Promise<void>(resolve => http.server.listen(0, "127.0.0.1", resolve))
    origin = `http://127.0.0.1:${(http.server.address() as AddressInfo).port}`
    running = true
  }
  const stop = async () => {
    if (!running) return
    http.closeStreams(); http.server.closeAllConnections()
    await new Promise<void>(resolve => http.server.close(() => resolve()))
    repository.close(); running = false
  }
  await start()
  const rootRequest = (path: string, method = "GET", body?: unknown, cookie = "", extra: Record<string, string> = {}) => {
    const isJson = body !== undefined && typeof body !== "string"
    return fetch(origin + `/api/v1${path}`, {
      method,
      headers: {
        ...(isJson ? { "Content-Type": "application/json" } : {}),
        ...(cookie ? { Cookie: cookie, "X-KW-CSRF": "1" } : {}),
        ...extra,
      },
      ...(body === undefined ? {} : { body: isJson ? JSON.stringify(body) : body as string }),
    })
  }
  const bootstrapResponse = await rootRequest("/auth/bootstrap", "POST", { handle: "admin", displayName: "Admin", password }, "", { "X-KW-Setup-Key": setupKey })
  if (bootstrapResponse.status !== 201) throw new Error(`fixture bootstrap failed: ${bootstrapResponse.status}`)
  const loginResponse = await rootRequest("/auth/login", "POST", { handle: "admin", password })
  const cookie = loginResponse.headers.get("set-cookie")?.split(";")[0] ?? ""
  if (!cookie) throw new Error("fixture login did not issue a session")
  const projectResponse = await rootRequest("/projects", "POST", { name: "Upload registry fixture" }, cookie)
  const projectEnvelope = await projectResponse.json() as { data: { id: string } }
  if (projectResponse.status !== 201) throw new Error(`fixture project failed: ${projectResponse.status}`)
  const project = projectEnvelope.data
  const path = `/projects/${project.id}`
  const request = (suffix: string, method = "GET", body?: unknown, extra: Record<string, string> = {}) => rootRequest(`${path}${suffix}`, method, body, cookie, extra)
  const upload = (name: string, bytes: string, options: { key?: string; sourceId?: string; createSource?: boolean } = {}) => request("/documents", "POST", bytes, {
    "X-File-Name": encodeURIComponent(name), "Content-Type": "text/markdown",
    ...(options.key ? { "Idempotency-Key": options.key } : {}),
    ...(options.sourceId ? { "X-Source-Id": options.sourceId } : {}),
    ...(options.createSource ? { "X-Create-Source": "1" } : {}),
  })
  const body = async (response: Response) => await response.json() as { data: Record<string, any> }
  const dbFile = join(directory, "service.sqlite")
  const reopen = async () => { await stop(); await start() }
  const close = async () => { await stop(); rmSync(directory, { recursive: true, force: true }) }
  closers.push(close)
  return {
    directory, dbFile, project, cookie, path, request, upload, body, stop, reopen, close,
    get repository() { return repository }, get origin() { return origin },
  }
}

function tableCount(db: DatabaseSync, table: string): number {
  return Number((db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count)
}

function uploadedFilePaths(directory: string): string[] {
  const root = join(directory, "uploads")
  if (!existsSync(root)) return []
  const out: string[] = []
  const visit = (path: string) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name)
      if (entry.isDirectory()) visit(child)
      else if (entry.name === "source.bin") out.push(child)
    }
  }
  visit(root)
  return out
}

afterEach(async () => { for (const close of closers.splice(0)) await close() })

describe("SQLite schema 8 upload registry persistence", () => {
  it("migrates schema 7 without losing resources, events or tombstones and preserves legacy bytes across first new revision and old revision replay", async () => {
    const f = await fixture()
    const legacyResponse = await f.upload("legacy.md", "original bytes")
    expect(legacyResponse.status).toBe(201)
    const legacy = (await f.body(legacyResponse)).data
    await f.repository.save(f.project.id, "wiki", "wiki/live.md", { content: "preserve me" }, null, "2026-11-02T00:00:00.000Z")
    const removed = await f.repository.save(f.project.id, "wiki", "wiki/deleted.md", { content: "tombstone" }, null, "2026-11-02T00:00:01.000Z")
    await f.repository.remove(f.project.id, "wiki", "wiki/deleted.md", removed.revision, "2026-11-02T00:00:02.000Z")
    const beforeEvents = await f.repository.events(f.project.id, 0, 100)
    const beforeLive = await f.repository.get(f.project.id, "wiki", "wiki/live.md")
    const tombstoneBefore = new DatabaseSync(f.dbFile)
    const tombstoneRow = tombstoneBefore.prepare("SELECT revision,deleted,data FROM resources WHERE project_id=? AND kind='wiki' AND key=?").get(f.project.id, "wiki/deleted.md")
    tombstoneBefore.close()

    await f.stop()
    const downgrade = new DatabaseSync(f.dbFile)
    downgrade.exec("DROP TABLE upload_idempotency; DROP TABLE upload_revisions; DROP TABLE upload_sources; PRAGMA user_version=7")
    downgrade.close()
    await f.reopen()

    const verify = new DatabaseSync(f.dbFile)
    expect(verify.prepare("PRAGMA user_version").get()).toMatchObject({ user_version: SERVICE_SCHEMA_VERSION })
    expect(verify.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'upload_%' ORDER BY name").all().map((row: any) => row.name)).toEqual(["upload_idempotency", "upload_revisions", "upload_sources"])
    expect(verify.prepare("SELECT revision,deleted,data FROM resources WHERE project_id=? AND kind='wiki' AND key=?").get(f.project.id, "wiki/deleted.md")).toEqual(tombstoneRow)
    verify.close()
    expect(await f.repository.get(f.project.id, "wiki", "wiki/live.md")).toEqual(beforeLive)
    expect(await f.repository.get(f.project.id, "wiki", "wiki/deleted.md")).toBeNull()
    expect(await f.repository.events(f.project.id, 0, 100)).toEqual(beforeEvents)

    const changedFirst = await f.upload("legacy.md", "new bytes", { key: "legacy-v2", sourceId: legacy.data.sourceId })
    expect(changedFirst.status).toBe(201)
    const revised = (await f.body(changedFirst)).data
    expect(revised.key).not.toBe(legacy.key)
    expect(revised.data.sourceId).toBe(legacy.data.sourceId)
    const oldReplay = await f.upload("legacy.md", "original bytes", { key: "legacy-old-replay", sourceId: legacy.data.sourceId })
    expect([200, 201]).toContain(oldReplay.status)
    expect((await f.body(oldReplay)).data.key).toBe(legacy.key)
    expect(await (await f.request(`/documents/${legacy.key}/content`)).text()).toBe("original bytes")
    expect(await (await f.request(`/documents/${revised.key}/content`)).text()).toBe("new bytes")
    const registry = new DatabaseSync(f.dbFile)
    expect(tableCount(registry, "upload_sources")).toBe(1)
    expect(tableCount(registry, "upload_revisions")).toBe(2)
    expect(tableCount(registry, "upload_idempotency")).toBe(2)
    registry.close()
  })

  it("refuses a future schema version without resetting its database file", async () => {
    const f = await fixture()
    await f.repository.save(f.project.id, "wiki", "wiki/keep.md", { content: "keep database" }, null, "2026-11-02T00:00:00.000Z")
    await f.stop()
    const db = new DatabaseSync(f.dbFile)
    db.exec(`PRAGMA user_version=${SERVICE_SCHEMA_VERSION + 1}`)
    const before = db.prepare("SELECT * FROM resources WHERE project_id=? ORDER BY kind,key").all(f.project.id)
    db.close()
    expect(() => new SqliteRepository(f.directory)).toThrow("Unsupported service database schema")
    const after = new DatabaseSync(f.dbFile)
    expect(after.prepare("PRAGMA user_version").get()).toMatchObject({ user_version: SERVICE_SCHEMA_VERSION + 1 })
    expect(after.prepare("SELECT * FROM resources WHERE project_id=? ORDER BY kind,key").all(f.project.id)).toEqual(before)
    after.close()
  })

  it("rolls back source, revision, idempotency, resource and event writes on registry failure without deleting an earlier upload", async () => {
    const f = await fixture()
    const winnerResponse = await f.upload("winner.md", "winner bytes", { key: "winner", createSource: true })
    expect(winnerResponse.status).toBe(201)
    const winner = (await f.body(winnerResponse)).data
    const beforeEvents = await f.repository.events(f.project.id, 0, 100)
    const beforeResources = await f.repository.list(f.project.id, "document", "", 100)
    const db = new DatabaseSync(f.dbFile)
    db.exec(`CREATE TRIGGER fail_upload_idempotency BEFORE INSERT ON upload_idempotency BEGIN SELECT RAISE(ABORT, 'synthetic upload registry failure'); END`)
    db.close()

    const failed = await f.upload("next.md", "losing bytes", { key: "fail-second-source", createSource: true })
    expect(failed.status).toBe(500)
    expect(await f.repository.list(f.project.id, "document", "", 100)).toEqual(beforeResources)
    expect(await f.repository.events(f.project.id, 0, 100)).toEqual(beforeEvents)
    expect(uploadedFilePaths(f.directory)).toHaveLength(1)
    expect(readFileSync(uploadedFilePaths(f.directory)[0], "utf8")).toBe("winner bytes")
    const verify = new DatabaseSync(f.dbFile)
    expect(tableCount(verify, "upload_sources")).toBe(1)
    expect(tableCount(verify, "upload_revisions")).toBe(1)
    expect(tableCount(verify, "upload_idempotency")).toBe(1)
    expect(verify.prepare("SELECT document_id FROM upload_revisions").all()).toEqual([{ document_id: winner.key }])
    verify.close()
  })

  it.each([
    ["source_id", "resource source identity", "sourceId"],
    ["hash", "resource byte revision", "sha256"],
    ["metadata", "revision row metadata", "name"],
  ] as const)("rejects replay after authoritative %s corruption and leaves the stored record intact", async (kind, _label, field) => {
    const f = await fixture()
    const accepted = await f.upload("stable.md", "stable bytes", { key: `tamper-${kind}`, createSource: true })
    expect(accepted.status).toBe(201)
    const original = (await f.body(accepted)).data
    const db = new DatabaseSync(f.dbFile)
    if (field === "name") {
      db.prepare("UPDATE upload_revisions SET name=? WHERE project_id=? AND document_id=?").run("tampered.md", f.project.id, original.key)
    } else {
      const row = db.prepare("SELECT data FROM resources WHERE project_id=? AND kind='document' AND key=?").get(f.project.id, original.key) as { data: string }
      const data = JSON.parse(row.data)
      if (field === "sourceId") data.sourceId = "tampered-source"
      else data.sha256 = "0".repeat(64)
      db.prepare("UPDATE resources SET data=? WHERE project_id=? AND kind='document' AND key=?").run(JSON.stringify(data), f.project.id, original.key)
    }
    const corrupted = field === "name"
      ? db.prepare("SELECT name FROM upload_revisions WHERE project_id=? AND document_id=?").get(f.project.id, original.key)
      : db.prepare("SELECT data FROM resources WHERE project_id=? AND kind='document' AND key=?").get(f.project.id, original.key)
    db.close()

    const replay = await f.upload("stable.md", "stable bytes", { key: `tamper-${kind}`, createSource: true })
    expect(replay.status).toBe(500)
    const after = new DatabaseSync(f.dbFile)
    const stillCorrupted = field === "name"
      ? after.prepare("SELECT name FROM upload_revisions WHERE project_id=? AND document_id=?").get(f.project.id, original.key)
      : after.prepare("SELECT data FROM resources WHERE project_id=? AND kind='document' AND key=?").get(f.project.id, original.key)
    expect(stillCorrupted).toEqual(corrupted)
    expect(tableCount(after, "upload_revisions")).toBe(1)
    expect(tableCount(after, "upload_idempotency")).toBe(1)
    after.close()
    expect(await f.repository.list(f.project.id, "document", "", 100)).toHaveLength(1)
    expect(uploadedFilePaths(f.directory)).toHaveLength(1)
  })
})
