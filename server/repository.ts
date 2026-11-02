import { createHash, randomUUID } from "node:crypto"
import { DatabaseSync } from "node:sqlite"
import { mkdirSync, chmodSync } from "node:fs"
import { join } from "node:path"
import type { ProjectRecord, ResourceKind, ResourceRecord, ProjectEvent } from "@/modules/service-api/domain"
import type { SharedRepository } from "@/modules/service-api/application"
import type { IdentityRepository } from "@/modules/identity/application"
import { emptyIdentityCatalog, validateIdentityCatalog, globalPermissions } from "@/modules/identity/domain"
import { createSqliteIdentityRepository } from "./identity"
import { createAuthenticationRepository } from "./auth-store"
import type { AuthenticationRepository } from "@/modules/identity/application"
import { createTokenRepository } from "./token-store"
import type { TokenRepository } from "@/modules/identity/application"
import { createContextRepository } from "./context-store"
import type { ContextRepository } from "@/modules/identity/application"
import { createMemoryGrantRepository } from "./memory-grants"
import { createAuditRepository } from "./audit"
import type { UploadRegistration, UploadRegistry, ReceivedDocument } from "@/modules/service-api/application"
import { ServiceError } from "@/modules/service-api/domain"
export const SERVICE_SCHEMA_VERSION = 8
type Row = Record<string, string | number | null>
const uploadSemanticHash = (name: string, mediaType: string, byteRevision: string, size: number) =>
  createHash("sha256").update(JSON.stringify([name, mediaType, byteRevision, size]), "utf8").digest("hex")
export class SqliteRepository implements SharedRepository, UploadRegistry {
  private db: DatabaseSync
  readonly identities: IdentityRepository
  readonly authentication: AuthenticationRepository
  readonly tokens: TokenRepository
  readonly audit: ReturnType<typeof createAuditRepository>
  readonly contexts: ContextRepository
  readonly memoryGrants: ReturnType<typeof createMemoryGrantRepository>
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
      if (version < 4) this.transaction(() => {
        this.db.exec("CREATE TABLE agent_tokens(id TEXT PRIMARY KEY, account_id TEXT NOT NULL, digest TEXT NOT NULL UNIQUE, data TEXT NOT NULL); PRAGMA user_version=4;")
      })
      if (version < 5) this.transaction(() => {
        this.db.exec("CREATE TABLE identity_delegations(id TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE access_contexts(id TEXT PRIMARY KEY, data TEXT NOT NULL); PRAGMA user_version=5;")
      })
      if (version < 6) this.transaction(() => {
        this.db.exec("CREATE TABLE memory_grants(id TEXT PRIMARY KEY, project_id TEXT NOT NULL, data TEXT NOT NULL); PRAGMA user_version=6;")
      })
      if (version < 7) this.transaction(() => {
        this.db.exec("CREATE TABLE audit_log(sequence INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT, actor_id TEXT, data TEXT NOT NULL); CREATE INDEX audit_scope ON audit_log(project_id,actor_id,sequence); PRAGMA user_version=7;")
      })
      const currentVersion = Number((this.db.prepare("PRAGMA user_version").get() as Row).user_version)
      if (currentVersion < 8) this.transaction(() => {
        this.db.exec(`CREATE TABLE upload_sources(project_id TEXT NOT NULL REFERENCES projects(id), source_id TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(project_id,source_id));
          CREATE TABLE upload_revisions(project_id TEXT NOT NULL, source_id TEXT NOT NULL, byte_revision TEXT NOT NULL, request_hash TEXT NOT NULL, name TEXT NOT NULL, media_type TEXT NOT NULL, size INTEGER NOT NULL, document_id TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL,
            PRIMARY KEY(project_id,source_id,byte_revision), UNIQUE(project_id,document_id),
            FOREIGN KEY(project_id,source_id) REFERENCES upload_sources(project_id,source_id));
          CREATE TABLE upload_idempotency(project_id TEXT NOT NULL REFERENCES projects(id), key_hash TEXT NOT NULL, source_id TEXT NOT NULL, byte_revision TEXT NOT NULL, binding_hash TEXT NOT NULL,
            PRIMARY KEY(project_id,key_hash),
            FOREIGN KEY(project_id,source_id,byte_revision) REFERENCES upload_revisions(project_id,source_id,byte_revision));
          CREATE INDEX upload_revisions_document ON upload_revisions(project_id,document_id);
          PRAGMA user_version=8;`)
      })
      this.audit = createAuditRepository(this.db)
      this.memoryGrants = createMemoryGrantRepository(this.db)
      this.authentication = createAuthenticationRepository(this.db)
      this.tokens = createTokenRepository(this.db, this.authentication)
      this.contexts = createContextRepository(this.db, this.authentication)
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
  async createProject(project: ProjectRecord, initial: unknown, ownerId?: string) {
    return this.transaction(() => {
      this.db.prepare("INSERT INTO projects(id,name,created_at) VALUES(?,?,?)").run(project.id, project.name, project.createdAt)
      this.db.prepare("INSERT INTO resources(project_id,kind,key,data,revision,created_at,updated_at) VALUES(?,?,?,?,1,?,?)").run(project.id, "workspace", "default", JSON.stringify(initial), project.createdAt, project.createdAt)
      if (ownerId) {
        const row = this.db.prepare("SELECT data,revision FROM identity_catalog WHERE id=1").get() as { data: string; revision: number }, catalog = validateIdentityCatalog(JSON.parse(row.data))
        const owner = catalog.accounts.find(account => account.id === ownerId)
        if (!owner || !globalPermissions(owner).includes("projects.create")) throw new ServiceError("forbidden", "Project creation is not authorized")
        catalog.memberships.push({ id: randomUUID(), projectId: project.id, accountId: ownerId, status: "active", permissionRole: "manager", workRoleIds: [], createdAt: project.createdAt, updatedAt: project.createdAt })
        this.db.prepare("UPDATE identity_catalog SET data=?,revision=? WHERE id=1").run(JSON.stringify(validateIdentityCatalog(catalog)), row.revision + 1)
      }
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
  async read(projectId: string, documentId: string): Promise<ResourceRecord<ReceivedDocument> | null> {
    const value = await this.get(projectId, "document", documentId)
    if (!value) return null
    const data = value.data as Partial<ReceivedDocument>
    const byteRevision = data.sourceRevision ?? data.sha256
    if (data.id !== documentId || typeof data.sourceId !== "string" || !/^[a-f0-9]{64}$/.test(String(byteRevision)) || data.sha256 !== byteRevision || (data.byteSha256 !== undefined && data.byteSha256 !== byteRevision))
      throw new ServiceError("internal", "Upload document is invalid")
    return value as ResourceRecord<ReceivedDocument>
  }
  async register(input: UploadRegistration) {
    return this.transaction(() => {
      const project = this.db.prepare("SELECT 1 FROM projects WHERE id=?").get(input.projectId)
      if (!project) throw new ServiceError("not_found", "Project not found")
      const priorKey = this.db.prepare(`SELECT r.*,i.binding_hash FROM upload_idempotency i JOIN upload_revisions r
        ON r.project_id=i.project_id AND r.source_id=i.source_id AND r.byte_revision=i.byte_revision
        WHERE i.project_id=? AND i.key_hash=?`).get(input.projectId, input.idempotencyHash) as Row | undefined
      if (priorKey) {
        const record = this.uploadRecord(priorKey)
        const matches = String(priorKey.request_hash) === input.requestHash && String(priorKey.binding_hash) === input.bindingHash
        return { status: matches ? "existing" as const : "conflict" as const, record }
      }
      const source = this.db.prepare("SELECT 1 FROM upload_sources WHERE project_id=? AND source_id=?").get(input.projectId, input.sourceId)
      let sourceExists = Boolean(source)
      if (!sourceExists) {
        const legacyRows = this.db.prepare("SELECT * FROM resources WHERE project_id=? AND kind='document' AND deleted=0").all(input.projectId) as Row[]
        const legacy = legacyRows.map(row => this.resource(row)).find(record => {
          const data = record.data as Partial<ReceivedDocument>
          return data?.id === input.sourceId || data?.sourceId === input.sourceId
        })
        if (!legacy && !input.createSource) throw new ServiceError("not_found", "Source identity is not registered in this project")
        if (legacy) {
        const data = legacy.data as Partial<ReceivedDocument>
        const legacyRevision = data.sourceRevision ?? data.sha256
        if (data.id !== legacy.key || data.sourceId !== input.sourceId || typeof legacyRevision !== "string" || !/^[a-f0-9]{64}$/.test(legacyRevision) || data.sha256 !== legacyRevision || typeof data.name !== "string" || !data.name || data.name !== data.name.normalize("NFC").trim() || typeof data.mediaType !== "string" || !data.mediaType || !Number.isSafeInteger(data.size) || (data.sourceRevision !== undefined && data.sourceRevision !== legacyRevision) || (data.byteSha256 !== undefined && data.byteSha256 !== legacyRevision) || (data.revisionKind !== undefined && data.revisionKind !== "raw-bytes-sha256") || (data.parsedTextRevision !== undefined && data.parsedTextRevision !== null) || data.status !== "received" || data.sourceIngestedAt !== null)
          throw new ServiceError("internal", "Legacy source identity is invalid")
        this.db.prepare("INSERT INTO upload_sources(project_id,source_id,created_at) VALUES(?,?,?)").run(input.projectId, input.sourceId, legacy.createdAt)
        this.db.prepare(`INSERT INTO upload_revisions(project_id,source_id,byte_revision,request_hash,name,media_type,size,document_id,data,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`)
          .run(input.projectId, input.sourceId, legacyRevision, uploadSemanticHash(data.name, data.mediaType, legacyRevision, Number(data.size)), data.name, data.mediaType, Number(data.size), legacy.key, JSON.stringify(legacy.data), legacy.createdAt)
        sourceExists = true
        }
      }
      if (!sourceExists) this.db.prepare("INSERT INTO upload_sources(project_id,source_id,created_at) VALUES(?,?,?)").run(input.projectId, input.sourceId, input.now)
      const priorRevision = this.db.prepare("SELECT * FROM upload_revisions WHERE project_id=? AND source_id=? AND byte_revision=?").get(input.projectId, input.sourceId, input.byteRevision) as Row | undefined
      if (priorRevision) {
        const record = this.uploadRecord(priorRevision)
        const sameSemantics = String(priorRevision.request_hash) === input.requestHash && String(priorRevision.name) === input.data.name && String(priorRevision.media_type) === input.data.mediaType && Number(priorRevision.size) === input.data.size
        if (!sameSemantics) return { status: "conflict" as const, record }
        this.db.prepare("INSERT INTO upload_idempotency(project_id,key_hash,source_id,byte_revision,binding_hash) VALUES(?,?,?,?,?)").run(input.projectId, input.idempotencyHash, input.sourceId, input.byteRevision, input.bindingHash)
        return { status: "existing" as const, record }
      }
      this.db.prepare(`INSERT INTO resources(project_id,kind,key,data,revision,created_at,updated_at,deleted) VALUES(?,?,?,?,1,?,?,0)`)
        .run(input.projectId, "document", input.documentId, JSON.stringify(input.data), input.now, input.now)
      this.event(input.projectId, "resource.updated", "document", input.documentId, 1, input.now)
      this.db.prepare(`INSERT INTO upload_revisions(project_id,source_id,byte_revision,request_hash,name,media_type,size,document_id,data,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`)
        .run(input.projectId, input.sourceId, input.byteRevision, input.requestHash, input.data.name, input.data.mediaType, input.data.size, input.documentId, JSON.stringify(input.data), input.now)
      this.db.prepare("INSERT INTO upload_idempotency(project_id,key_hash,source_id,byte_revision,binding_hash) VALUES(?,?,?,?,?)")
        .run(input.projectId, input.idempotencyHash, input.sourceId, input.byteRevision, input.bindingHash)
      return { status: "created" as const, record: { projectId: input.projectId, kind: "document" as const, key: input.documentId, data: input.data, revision: 1, createdAt: input.now, updatedAt: input.now } }
    })
  }
  private uploadRecord(row: Row) {
    const projectId = String(row.project_id), key = String(row.document_id)
    const resource = this.db.prepare("SELECT * FROM resources WHERE project_id=? AND kind='document' AND key=? AND deleted=0").get(projectId, key) as Row | undefined
    if (!resource) throw new ServiceError("internal", "Upload registry refers to a missing document")
    const record = this.resource(resource)
    const data = record.data as Partial<ReceivedDocument>
    const storedData = JSON.parse(String(row.data)) as Partial<ReceivedDocument>
    const byteRevision = data?.sourceRevision ?? data?.sha256
    const byteHash = data?.byteSha256 ?? data?.sha256
    const sizeIsValid = Number.isSafeInteger(data?.size) && Number(data?.size) >= 0
    if (!data || !storedData || data.id !== key || data.sourceId !== row.source_id || byteRevision !== row.byte_revision || data.sha256 !== row.byte_revision || byteHash !== row.byte_revision ||
        data.revisionKind !== "raw-bytes-sha256" && data.revisionKind !== undefined || data.parsedTextRevision !== null && data.parsedTextRevision !== undefined ||
        typeof data.name !== "string" || !data.name || data.name !== data.name.normalize("NFC").trim() || typeof data.mediaType !== "string" || !data.mediaType || !sizeIsValid ||
        data.status !== "received" || data.sourceIngestedAt !== null ||
        storedData.id !== key || storedData.sourceId !== row.source_id || (storedData.sourceRevision ?? storedData.sha256) !== row.byte_revision || storedData.sha256 !== row.byte_revision ||
        storedData.name !== row.name || storedData.mediaType !== row.media_type || storedData.size !== row.size || data.name !== row.name || data.mediaType !== row.media_type || data.size !== row.size ||
        String(row.request_hash) !== uploadSemanticHash(String(row.name), String(row.media_type), String(row.byte_revision), Number(row.size)))
      throw new ServiceError("internal", "Upload registry document is invalid")
    return record as import("@/modules/service-api/domain").ResourceRecord<ReceivedDocument>
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
