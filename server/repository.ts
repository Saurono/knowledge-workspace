import { DatabaseSync } from "node:sqlite"
import { mkdirSync, chmodSync } from "node:fs"
import { join } from "node:path"
import { ServiceError } from "@/modules/service-api/domain"
import type { ProjectRecord, ResourceKind, ResourceRecord, ProjectEvent } from "@/modules/service-api/domain"
import type { SharedRepository } from "@/modules/service-api/application"
import type { IdentityRepository } from "@/modules/identity/application"
import { emptyIdentityCatalog } from "@/modules/identity/domain"
import { createSqliteIdentityRepository } from "./identity"
import { createAuthenticationRepository } from "./auth-store"
import type { AuthenticationRepository } from "@/modules/identity/application"
export const SERVICE_SCHEMA_VERSION = 3
type Row = Record<string, string | number | null>
export class SqliteRepository implements SharedRepository {
  private db: DatabaseSync
  readonly identities: IdentityRepository
  readonly authentication: AuthenticationRepository
  constructor(directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    const file = join(directory, "service.sqlite")
    this.db = new DatabaseSync(file)
    if (process.platform !== "win32") chmodSync(file, 0o600)
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;")
    const version = Number((this.db.prepare("PRAGMA user_version").get() as Row).user_version)
    if (version > SERVICE_SCHEMA_VERSION) { this.db.close(); throw new Error("Unsupported service database schema; original database preserved") }
    if (version === 0) this.db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE projects(id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE resources(project_id TEXT NOT NULL REFERENCES projects(id), kind TEXT NOT NULL, key TEXT NOT NULL, data TEXT NOT NULL, revision INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(project_id,kind,key));
      CREATE TABLE events(sequence INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL REFERENCES projects(id), type TEXT NOT NULL, kind TEXT NOT NULL, key TEXT NOT NULL, revision INTEGER NOT NULL, recorded_at TEXT NOT NULL);
      CREATE INDEX events_project_sequence ON events(project_id,sequence);
      PRAGMA user_version=1; COMMIT;`)
    try {
      if (version < 2) this.transaction(() => {
        this.db.exec("CREATE TABLE identity_catalog(id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0))")
        this.db.prepare("INSERT INTO identity_catalog(id,data,revision) VALUES(1,?,1)").run(JSON.stringify(emptyIdentityCatalog()))
        this.db.exec("PRAGMA user_version=2")
      })
      if (version < 3) this.transaction(() => {
        this.db.exec(`CREATE TABLE passwords(account_id TEXT PRIMARY KEY, hash TEXT NOT NULL);
          CREATE TABLE login_sessions(id TEXT PRIMARY KEY, account_id TEXT NOT NULL, digest TEXT UNIQUE NOT NULL, data TEXT NOT NULL);
          CREATE TABLE login_attempts(key TEXT NOT NULL, attempted_at TEXT NOT NULL);
          CREATE INDEX login_attempts_key ON login_attempts(key,attempted_at);
          PRAGMA user_version=3;`)
      })
      this.authentication = createAuthenticationRepository(this.db)
      this.identities = createSqliteIdentityRepository(this.db)
    } catch (error) { this.db.close(); throw error }
  }
  close() { this.db.close() }
  private transaction<T>(operation: () => T): T {
    this.db.exec("BEGIN IMMEDIATE")
    try { const result = operation(); this.db.exec("COMMIT"); return result }
    catch (error) { this.db.exec("ROLLBACK"); throw error }
  }
  private event(project: string, type: string, kind: string, key: string, revision: number, now: string) {
    this.db.prepare("INSERT INTO events(project_id,type,kind,key,revision,recorded_at) VALUES(?,?,?,?,?,?)").run(project, type, kind, key, revision, now)
  }
  private resource(row: Row): ResourceRecord {
    return { projectId: String(row.project_id), kind: row.kind as ResourceKind, key: String(row.key), data: JSON.parse(String(row.data)), revision: Number(row.revision), createdAt: String(row.created_at), updatedAt: String(row.updated_at) }
  }
  async createProject(project: ProjectRecord, initial: unknown) {
    return this.transaction(() => {
      this.db.prepare("INSERT INTO projects(id,name,created_at) VALUES(?,?,?)").run(project.id, project.name, project.createdAt)
      this.db.prepare("INSERT INTO resources(project_id,kind,key,data,revision,created_at,updated_at) VALUES(?,?,?,?,1,?,?)").run(project.id, "workspace", "default", JSON.stringify(initial), project.createdAt, project.createdAt)
      this.event(project.id, "project.created", "project", project.id, 1, project.createdAt)
      return project
    })
  }
  async project(id: string) {
    const row = this.db.prepare("SELECT * FROM projects WHERE id=?").get(id) as Row | undefined
    return row ? { id: String(row.id), name: String(row.name), createdAt: String(row.created_at) } : null
  }
  async projects(after: string, limit: number) {
    return (this.db.prepare("SELECT * FROM projects WHERE id>? ORDER BY id LIMIT ?").all(after, limit) as Row[]).map(row => ({ id: String(row.id), name: String(row.name), createdAt: String(row.created_at) }))
  }
  async get(project: string, kind: ResourceKind, key: string) {
    const row = this.db.prepare("SELECT * FROM resources WHERE project_id=? AND kind=? AND key=? AND deleted=0").get(project, kind, key) as Row | undefined
    return row ? this.resource(row) : null
  }
  async list(project: string, kind: ResourceKind, after: string, limit: number) {
    return (this.db.prepare("SELECT * FROM resources WHERE project_id=? AND kind=? AND key>? AND deleted=0 ORDER BY key LIMIT ?").all(project, kind, after, limit) as Row[]).map(row => this.resource(row))
  }
  async save(project: string, kind: ResourceKind, key: string, data: unknown, expected: number | null, now: string) {
    return this.transaction(() => {
      const previous = this.db.prepare("SELECT * FROM resources WHERE project_id=? AND kind=? AND key=?").get(project, kind, key) as Row | undefined
      const actual = previous && !previous.deleted ? Number(previous.revision) : null
      if (actual !== expected) throw new ServiceError("conflict", "Resource changed; reload before merging", { actualRevision: actual })
      const revision = Number(previous?.revision ?? 0) + 1, created = previous && !previous.deleted ? String(previous.created_at) : now
      this.db.prepare("INSERT INTO resources(project_id,kind,key,data,revision,created_at,updated_at,deleted) VALUES(?,?,?,?,?,?,?,0) ON CONFLICT(project_id,kind,key) DO UPDATE SET data=excluded.data, revision=excluded.revision, created_at=excluded.created_at, updated_at=excluded.updated_at, deleted=0").run(project, kind, key, JSON.stringify(data), revision, created, now)
      this.event(project, "resource.updated", kind, key, revision, now)
      return { projectId: project, kind, key, data, revision, createdAt: created, updatedAt: now }
    })
  }
  async remove(project: string, kind: ResourceKind, key: string, expected: number, now: string) {
    this.transaction(() => {
      const row = this.db.prepare("SELECT revision FROM resources WHERE project_id=? AND kind=? AND key=? AND deleted=0").get(project, kind, key) as Row | undefined
      if (!row) throw new ServiceError("not_found", "Resource not found")
      if (Number(row.revision) !== expected) throw new ServiceError("conflict", "Resource changed", { actualRevision: Number(row.revision) })
      this.db.prepare("UPDATE resources SET deleted=1,revision=revision+1,updated_at=? WHERE project_id=? AND kind=? AND key=?").run(now, project, kind, key)
      this.event(project, "resource.deleted", kind, key, expected + 1, now)
    })
  }
  async events(project: string, after: number, limit: number): Promise<ProjectEvent[]> {
    return (this.db.prepare("SELECT * FROM events WHERE project_id=? AND sequence>? ORDER BY sequence LIMIT ?").all(project, after, limit) as Row[]).map(row => ({ sequence: Number(row.sequence), projectId: String(row.project_id), type: String(row.type), resource: { kind: row.kind as ResourceKind | "project", key: String(row.key), revision: Number(row.revision) }, recordedAt: String(row.recorded_at) }))
  }
}
