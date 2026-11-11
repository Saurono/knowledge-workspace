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
import type { MemoryRecord } from "@/modules/memory/domain"
export const SERVICE_SCHEMA_VERSION = 15
import type { MemorySummary as importSummary, MemorySummaryCursor } from "@/modules/service-api/domain"
export type { MemorySummaryCursor } from "@/modules/service-api/domain"
export interface MemorySummary extends importSummary {
  access: unknown | null
  source: { kind: string; actorId?: string | null } | null
  validityUntil: string | null
}
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
      if (currentVersion < 9) this.transaction(() => {
        try {
          this.db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS wiki_fts USING fts5(project_id UNINDEXED, path UNINDEXED, title, body, tokenize='unicode61')")
        } catch (cause) { throw new Error(`FTS5 wiki index creation failed: ${String(cause)}`) }
        for (const row of this.db.prepare("SELECT project_id,key,data FROM resources WHERE kind='wiki' AND deleted=0").all() as Row[])
          this.indexWiki(String(row.project_id), String(row.key), JSON.parse(String(row.data)))
        this.db.exec("PRAGMA user_version=9")
      })
      if (currentVersion < 10) this.transaction(() => {
        this.db.exec(`CREATE TABLE IF NOT EXISTS write_proposals(project_id TEXT NOT NULL REFERENCES projects(id), id TEXT NOT NULL, status TEXT NOT NULL, idempotency_key TEXT NOT NULL, fingerprint TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(project_id,id), UNIQUE(project_id,idempotency_key)); PRAGMA user_version=10;`)
      })
      if (currentVersion < 11) this.transaction(() => {
        this.db.exec(`CREATE TABLE IF NOT EXISTS memory_write_idempotency(project_id TEXT NOT NULL REFERENCES projects(id), idempotency_key TEXT NOT NULL, fingerprint TEXT NOT NULL, result TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(project_id,idempotency_key)); PRAGMA user_version=11;`)
      })
      if (currentVersion < 12) this.transaction(() => {
        try { this.db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(project_id UNINDEXED, memory_id UNINDEXED, title, body, tokenize='trigram')") }
        catch (cause) { throw new Error(`Memory FTS5 trigram creation failed: ${String(cause)}`) }
        for (const row of this.db.prepare("SELECT project_id,data FROM resources WHERE kind='workspace' AND key='default' AND deleted=0").all()) this.indexMemories(String(row.project_id), JSON.parse(String(row.data)))
        this.db.exec("PRAGMA user_version=12")
      })
      if (currentVersion < 13) this.transaction(() => {
        this.db.exec("DROP TABLE IF EXISTS wiki_fts")
        try { this.db.exec("CREATE VIRTUAL TABLE wiki_fts USING fts5(project_id UNINDEXED, path UNINDEXED, title, body, tokenize='trigram')") }
        catch (cause) { throw new Error(`Wiki FTS5 trigram creation failed: ${String(cause)}`) }
        for (const row of this.db.prepare("SELECT project_id,key,data FROM resources WHERE kind='wiki' AND deleted=0").all() as Row[])
          this.indexWiki(String(row.project_id), String(row.key), JSON.parse(String(row.data)))
        this.db.exec("PRAGMA user_version=13")
      })
      if (currentVersion < 14) this.transaction(() => {
        this.db.exec(`CREATE TABLE IF NOT EXISTS memory_revision_archive(
          project_id TEXT NOT NULL REFERENCES projects(id),
          memory_id TEXT NOT NULL,
          version INTEGER NOT NULL,
          data TEXT NOT NULL,
          archived_at TEXT NOT NULL,
          PRIMARY KEY(project_id, memory_id, version)
        ); PRAGMA user_version=14;`)
      })
      if (currentVersion < 15) this.transaction(() => {
        this.db.exec(`CREATE TABLE IF NOT EXISTS memories (
          project_id TEXT NOT NULL REFERENCES projects(id), id TEXT NOT NULL,
          version INTEGER NOT NULL CHECK(version >= 0), status TEXT NOT NULL, owner TEXT,
          content_hash TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL,
          record_json TEXT NOT NULL CHECK(json_valid(record_json)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
          PRIMARY KEY(project_id,id));
          CREATE INDEX IF NOT EXISTS memories_project_status ON memories(project_id,status,id);
          CREATE INDEX IF NOT EXISTS memories_project_owner ON memories(project_id,owner,id);
          CREATE INDEX IF NOT EXISTS memories_project_hash ON memories(project_id,content_hash);
          CREATE TABLE IF NOT EXISTS memory_transitions (
            project_id TEXT NOT NULL, memory_id TEXT NOT NULL, sequence INTEGER NOT NULL,
            data TEXT NOT NULL CHECK(json_valid(data)), PRIMARY KEY(project_id,memory_id,sequence),
            FOREIGN KEY(project_id,memory_id) REFERENCES memories(project_id,id));`)
        const insert = this.db.prepare("INSERT INTO memories(project_id,id,version,status,owner,content_hash,title,content,record_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
        const transition = this.db.prepare("INSERT INTO memory_transitions(project_id,memory_id,sequence,data) VALUES(?,?,?,?)")
        for (const row of this.db.prepare("SELECT project_id,key,data FROM resources WHERE kind='workspace' AND key='default' AND deleted=0").all()) {
          try {
            const workspace = JSON.parse(String(row.data))
            for (const memory of workspace.memories ?? []) {
              insert.run(row.project_id, memory.id, memory.version, memory.status,
                memory.access?.ownerId ?? memory.source?.actorId ?? null,
                createHash("sha256").update(memory.content, "utf8").digest("hex"),
                memory.title, memory.content, JSON.stringify(memory), memory.createdAt, memory.updatedAt)
              for (const [sequence, data] of (memory.transitions ?? []).entries()) {
                transition.run(row.project_id, memory.id, sequence, JSON.stringify(data))
              }
            }
          } catch (cause) { throw new Error(`Memory migration failed for project ${row.project_id}, resource ${row.key}: ${String(cause)}`) }
        }
        this.db.exec("PRAGMA user_version=15")
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
  private mirrorMemories(projectId: string, data: unknown) {
    const next = (data as { memories?: MemoryRecord[] }).memories ?? []
    const existing = new Set(this.db.prepare("SELECT id FROM memories WHERE project_id=?").all(projectId).map(row => String(row.id)))
    const ids = new Set(next.map(memory => memory.id))
    const insert = this.db.prepare("INSERT INTO memories(project_id,id,version,status,owner,content_hash,title,content,record_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
    const update = this.db.prepare("UPDATE memories SET version=?,status=?,owner=?,content_hash=?,title=?,content=?,record_json=?,created_at=?,updated_at=? WHERE project_id=? AND id=?")
    const clearTransitions = this.db.prepare("DELETE FROM memory_transitions WHERE project_id=? AND memory_id=?")
    const transition = this.db.prepare("INSERT INTO memory_transitions(project_id,memory_id,sequence,data) VALUES(?,?,?,?)")
    try {
      for (const memory of next) {
        const values = [memory.version, memory.status, memory.access?.ownerId ?? memory.source?.actorId ?? null,
          createHash("sha256").update(memory.content, "utf8").digest("hex"), memory.title, memory.content,
          JSON.stringify(memory), memory.createdAt, memory.updatedAt]
        if (existing.has(memory.id)) update.run(...values, projectId, memory.id)
        else insert.run(projectId, memory.id, ...values)
        existing.add(memory.id)
        clearTransitions.run(projectId, memory.id)
        for (const [sequence, entry] of (memory.transitions ?? []).entries()) transition.run(projectId, memory.id, sequence, JSON.stringify(entry))
      }
      for (const id of existing) if (!ids.has(id)) {
        clearTransitions.run(projectId, id)
        this.db.prepare("DELETE FROM memories WHERE project_id=? AND id=?").run(projectId, id)
      }
    } catch (cause) { throw new Error(`Memory mirror write failed for project ${projectId}: ${String(cause)}`) }
  }
  async verifyMemoryMirror(projectId: string): Promise<{ ok: boolean; jsonCount: number; rowCount: number; missingInRows: string[]; extraInRows: string[]; mismatched: string[] }> {
    const workspace = await this.get(projectId, "workspace", "default")
    const memories = (workspace?.data as { memories?: MemoryRecord[] } | undefined)?.memories ?? []
    const rows = await this.memoryRows(projectId)
    const byId = new Map(rows.map(row => [row.id, row]))
    const ids = new Set(memories.map(memory => memory.id))
    const missingInRows = memories.filter(memory => !byId.has(memory.id)).map(memory => memory.id)
    const extraInRows = rows.filter(row => !ids.has(row.id)).map(row => row.id)
    const normalize = (value: unknown): unknown => Array.isArray(value) ? value.map(normalize)
      : value !== null && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, normalize(entry)])) : value
    const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(normalize(value)) ?? "undefined", "utf8").digest("hex")
    const mismatched: string[] = []
    for (const memory of memories) {
      const row = byId.get(memory.id)
      if (!row) continue
      const expected = { version: memory.version, status: memory.status, owner: memory.access?.ownerId ?? memory.source?.actorId ?? null,
        contentHash: createHash("sha256").update(memory.content, "utf8").digest("hex"), title: memory.title, content: memory.content,
        record: memory, createdAt: memory.createdAt, updatedAt: memory.updatedAt }
      for (const field of Object.keys(expected) as (keyof typeof expected)[]) {
        if (digest(expected[field]) !== digest(row[field])) mismatched.push(`${memory.id}:${field}`)
      }
    }
    return { ok: !missingInRows.length && !extraInRows.length && !mismatched.length, jsonCount: memories.length, rowCount: rows.length, missingInRows, extraInRows, mismatched }
  }
  async memorySummaries(projectId: string, options: { limit: number; after?: MemorySummaryCursor | null }): Promise<{ items: MemorySummary[]; nextCursor: MemorySummaryCursor | null }> {
    const { limit, after } = options
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new ServiceError("invalid_argument", "limit must be an integer between 1 and 200")
    const rows = this.db.prepare(`SELECT id,title,status,version,updated_at,owner,json_extract(record_json,'$.category') AS category,
      json_extract(record_json,'$.access') AS access,json_extract(record_json,'$.source.kind') AS source_kind,
      json_extract(record_json,'$.source.actorId') AS source_actor_id,json_extract(record_json,'$.validity.until') AS validity_until
      FROM memories WHERE project_id=:projectId
      ${after ? "AND (updated_at < :updatedAt OR (updated_at = :updatedAt AND id > :id))" : ""}
      ORDER BY updated_at DESC, id ASC LIMIT :limit`).all({ projectId, limit: limit + 1, ...(after ? { updatedAt: after.updatedAt, id: after.id } : {}) })
    const items = rows.slice(0, limit).map(row => ({
      id: String(row.id), title: String(row.title), status: String(row.status), version: Number(row.version),
      updatedAt: String(row.updated_at), owner: row.owner === null ? null : String(row.owner), category: row.category === null ? null : String(row.category),
      access: row.access === null ? null : JSON.parse(String(row.access)) as unknown,
      source: row.source_kind === null ? null : { kind: String(row.source_kind), actorId: row.source_actor_id === null ? null : String(row.source_actor_id) },
      validityUntil: row.validity_until === null ? null : String(row.validity_until),
    }))
    const last = items[items.length - 1]
    return { items, nextCursor: rows.length > limit ? { updatedAt: last.updatedAt, id: last.id } : null }
  }
  async memoryGraph(projectId: string, options: { limit: number }): Promise<import("@/modules/service-api/domain").MemoryGraphNode[]> {
    const { limit } = options
    if (!Number.isInteger(limit) || limit < 1 || limit > 2000) throw new ServiceError("invalid_argument", "limit must be an integer between 1 and 2000")
    const array = (value: unknown): unknown[] => { try { const parsed: unknown = JSON.parse(String(value)); return Array.isArray(parsed) ? parsed : [] } catch { return [] } }
    return this.db.prepare(`SELECT id,title,status,updated_at,owner,
      json_extract(record_json,'$.category') AS category,json_extract(record_json,'$.domainIds') AS domain_ids,
      json_extract(record_json,'$.relations') AS relations,json_extract(record_json,'$.access') AS access,
      json_extract(record_json,'$.source.kind') AS source_kind,json_extract(record_json,'$.source.actorId') AS source_actor_id,
      json_extract(record_json,'$.validity.until') AS validity_until
      FROM memories WHERE project_id=:projectId ORDER BY updated_at DESC, id ASC LIMIT :limit`).all({ projectId, limit }).map(row => ({
      id: String(row.id), title: String(row.title), status: String(row.status), updatedAt: String(row.updated_at),
      owner: row.owner === null ? null : String(row.owner), category: row.category === null ? null : String(row.category),
      domainIds: array(row.domain_ids).filter((id): id is string => typeof id === "string"),
      relations: array(row.relations).filter((entry): entry is { type: string; targetId: string } => !!entry && typeof entry === "object" && typeof (entry as { type?: unknown }).type === "string" && typeof (entry as { targetId?: unknown }).targetId === "string"),
      access: row.access === null ? null : JSON.parse(String(row.access)) as unknown,
      source: row.source_kind === null ? null : { kind: String(row.source_kind), actorId: row.source_actor_id === null ? null : String(row.source_actor_id) },
      validityUntil: row.validity_until === null ? null : String(row.validity_until),
    }))
  }
  async memoryRows(projectId: string) {
    return this.db.prepare("SELECT * FROM memories WHERE project_id=? ORDER BY id").all(projectId).map(row => ({
      id: String(row.id), version: Number(row.version), status: String(row.status), owner: row.owner === null ? null : String(row.owner),
      contentHash: String(row.content_hash), title: String(row.title), content: String(row.content), record: JSON.parse(String(row.record_json)) as unknown,
      createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    }))
  }
  async memoryTransitionRows(projectId: string, memoryId: string) {
    return this.db.prepare("SELECT sequence,data FROM memory_transitions WHERE project_id=? AND memory_id=? ORDER BY sequence").all(projectId, memoryId)
      .map(row => ({ sequence: Number(row.sequence), data: JSON.parse(String(row.data)) as unknown }))
  }
  async saveMemoryAtomic(projectId: string, next: unknown, expected: { memoryVersion: number | null }, now: string): Promise<{ revision: number; memory: unknown }> {
    return this.transaction(() => {
      const memory = next as MemoryRecord
      const workspace = this.db.prepare("SELECT data,revision FROM resources WHERE project_id=? AND kind='workspace' AND key='default' AND deleted=0").get(projectId)
      if (!workspace) throw new Error("Workspace not found")
      const current = this.db.prepare("SELECT version FROM memories WHERE project_id=? AND id=?").get(projectId, memory.id)
      if (expected.memoryVersion === null) {
        if (current) throw new Error("conflict: memory already exists")
      } else if (!current || Number(current.version) !== expected.memoryVersion) throw new Error("conflict: memory version mismatch")
      if (current && memory.version !== Number(current.version) + 1) throw new Error("conflict: memory version mismatch")
      const data = JSON.parse(String(workspace.data)) as { memories?: MemoryRecord[] }
      const memories = data.memories ?? []
      const index = memories.findIndex(entry => entry.id === memory.id)
      if (index < 0) memories.push(memory)
      else memories[index] = memory
      data.memories = memories
      const revision = Number(workspace.revision) + 1
      this.db.prepare("UPDATE resources SET data=?,revision=?,updated_at=? WHERE project_id=? AND kind='workspace' AND key='default'").run(JSON.stringify(data), revision, now, projectId)
      this.db.prepare("DELETE FROM memory_transitions WHERE project_id=? AND memory_id=?").run(projectId, memory.id)
      this.db.prepare("DELETE FROM memories WHERE project_id=? AND id=?").run(projectId, memory.id)
      this.db.prepare("INSERT INTO memories(project_id,id,version,status,owner,content_hash,title,content,record_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(projectId, memory.id, memory.version, memory.status, memory.access?.ownerId ?? memory.source?.actorId ?? null, createHash("sha256").update(memory.content, "utf8").digest("hex"), memory.title, memory.content, JSON.stringify(memory), memory.createdAt, memory.updatedAt)
      for (const [sequence, entry] of (memory.transitions ?? []).entries()) this.db.prepare("INSERT INTO memory_transitions(project_id,memory_id,sequence,data) VALUES(?,?,?,?)").run(projectId, memory.id, sequence, JSON.stringify(entry))
      this.db.prepare("DELETE FROM memory_fts WHERE project_id=? AND memory_id=?").run(projectId, memory.id)
      this.db.prepare("INSERT INTO memory_fts(project_id,memory_id,title,body) VALUES(?,?,?,?)").run(projectId, memory.id, memory.title, memory.content)
      return { revision, memory }
    })
  }
  async archiveMemoryRevisions(projectId: string, memoryId: string, revisions: Array<{ version: number; data: unknown }>): Promise<void> {
    if (memoryId === "") throw new Error("Memory id is required")
    if (revisions.length === 0) return
    const insert = this.db.prepare("INSERT INTO memory_revision_archive(project_id,memory_id,version,data,archived_at) VALUES(?,?,?,?,?) ON CONFLICT(project_id,memory_id,version) DO NOTHING")
    for (const revision of revisions) insert.run(projectId, memoryId, revision.version, JSON.stringify(revision.data), new Date().toISOString())
  }
  async memoryWriteReplay(projectId: string, key: string) {
    const row = this.db.prepare("SELECT fingerprint,result FROM memory_write_idempotency WHERE project_id=? AND idempotency_key=?").get(projectId, key)
    return row ? { fingerprint: String(row.fingerprint), result: JSON.parse(String(row.result)) as unknown } : null
  }
  async saveMemoryWriteReplay(projectId: string, key: string, entry: { fingerprint: string; result: unknown }) {
    this.db.prepare("INSERT INTO memory_write_idempotency(project_id,idempotency_key,fingerprint,result,created_at) VALUES(?,?,?,?,?) ON CONFLICT(project_id,idempotency_key) DO UPDATE SET fingerprint=excluded.fingerprint,result=excluded.result").run(projectId, key, entry.fingerprint, JSON.stringify(entry.result), new Date().toISOString())
  }
  async proposals(projectId: string): Promise<import("@/modules/service-api/domain").WriteProposal[]> {
    return this.db.prepare("SELECT data FROM write_proposals WHERE project_id=? ORDER BY id").all(projectId).map(row => JSON.parse(String(row.data)))
  }
  async proposal(projectId: string, id: string): Promise<import("@/modules/service-api/domain").WriteProposal | null> {
    const row = this.db.prepare("SELECT data FROM write_proposals WHERE project_id=? AND id=?").get(projectId, id)
    return row ? JSON.parse(String(row.data)) : null
  }
  async saveProposal(proposal: import("@/modules/service-api/domain").WriteProposal) {
    this.db.prepare("INSERT INTO write_proposals(project_id,id,status,idempotency_key,fingerprint,data,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(project_id,id) DO UPDATE SET status=excluded.status,idempotency_key=excluded.idempotency_key,fingerprint=excluded.fingerprint,data=excluded.data").run(proposal.projectId, proposal.id, proposal.status, proposal.idempotencyKey, proposal.fingerprint, JSON.stringify(proposal), proposal.createdAt)
    return proposal
  }
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
      this.mirrorMemories(project.id, initial)
      this.indexMemories(project.id, initial)
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
  async governanceWorkspace(project: string) {
    const value = await this.get(project, "workspace", "default")
    return value ? { data: value.data as NonNullable<Awaited<ReturnType<SharedRepository["governanceWorkspace"]>>>["data"], revision: value.revision } : null
  }
  async governanceSaveWorkspace(project: string, data: Parameters<SharedRepository["governanceSaveWorkspace"]>[1], expected: number | null) {
    const saved = await this.save(project, "workspace", "default", data, expected, new Date().toISOString())
    return { data: saved.data as typeof data, revision: saved.revision }
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
  private indexMemories(project: string, data: unknown) {
    this.db.prepare("DELETE FROM memory_fts WHERE project_id=?").run(project)
    for (const memory of (data as { memories?: Array<{ id: string; title: string; content: string }> }).memories ?? [])
      this.db.prepare("INSERT INTO memory_fts(project_id,memory_id,title,body) VALUES(?,?,?,?)").run(project, memory.id, memory.title, memory.content)
  }
  async searchMemories(input: { projectId: string; query: string; limit?: number }) {
    const query = input.query.trim()
    if (Array.from(query).length < 3) return []
    const limit = Number.isFinite(input.limit) ? Math.max(1, Math.min(100, Math.trunc(input.limit!))) : 20
    const rows = this.db.prepare("SELECT m.memory_id,m.title,snippet(memory_fts,3,'[',']','...',24) AS snip,bm25(memory_fts) AS rank FROM memory_fts m WHERE memory_fts MATCH ? AND project_id=? ORDER BY rank,m.memory_id LIMIT ?").all(query, input.projectId, limit)
    return rows.map(row => ({ memoryId: String(row.memory_id), title: String(row.title), snippet: String(row.snip), score: -Number(row.rank) }))
  }
  private indexWiki(project: string, path: string, data: unknown) {
    const content = (data as { content?: unknown })?.content
    const text = typeof content === "string" ? content : ""
    const frontmatter = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)
    const rawTitle = frontmatter?.[1].match(/^title:\s*(.+)$/m)?.[1]?.trim()
    const title = rawTitle?.replace(/^(["'])(.*)\1$/, "$2") || path.split("/").pop() || path
    this.db.prepare("DELETE FROM wiki_fts WHERE project_id=? AND path=?").run(project, path)
    this.db.prepare("INSERT INTO wiki_fts(project_id,path,title,body) VALUES(?,?,?,?)").run(project, path, title, frontmatter ? text.slice(frontmatter[0].length) : text)
  }
  async searchWiki(input: { projectId: string; query: string; limit?: number; domainFilter?: string[] }): Promise<Array<{ path: string; title: string; snippet: string; titleMatch: boolean; score: number }>> {
    const query = input.query.trim()
    if (Array.from(query).length < 3) return []
    const phrase = `"${query.replace(/"/g, '""')}"`
    const tokens = input.query.match(/[\p{L}\p{N}_]+/gu) ?? []
    const limit = Number.isFinite(input.limit) ? Math.max(1, Math.min(100, Math.trunc(input.limit!))) : 20
    const domains = input.domainFilter ?? []
    const filter = domains.length ? ` AND (${domains.map(() => "substr(path,1,length(?))=?").join(" OR ")})` : ""
    const rows = this.db.prepare(`SELECT path, title, snippet(wiki_fts, 3, '[', ']', '…', 12) AS snip, bm25(wiki_fts) AS rank FROM wiki_fts WHERE wiki_fts MATCH ? AND project_id = ?${filter} ORDER BY rank, path LIMIT ?`)
      .all(phrase, input.projectId, ...domains.flatMap(domain => [domain, domain]), limit) as Row[]
    return rows.map(row => ({ path: String(row.path), title: String(row.title), snippet: String(row.snip), titleMatch: tokens.some(token => String(row.title).toLowerCase().includes(token.toLowerCase())), score: -Number(row.rank) }))
  }
  async save(project: string, kind: ResourceKind, key: string, data: unknown, expected: number | null, now: string) {
    return this.transaction(() => {
      const previous = this.db.prepare("SELECT * FROM resources WHERE project_id=? AND kind=? AND key=?").get(project, kind, key) as Row | undefined
      const actual = previous && !previous.deleted ? Number(previous.revision) : null
      if (actual !== expected) throw new ServiceError("conflict", "Resource changed; reload before merging", { actualRevision: actual })
      const revision = Number(previous?.revision ?? 0) + 1, created = previous && !previous.deleted ? String(previous.created_at) : now
      this.db.prepare("INSERT INTO resources(project_id,kind,key,data,revision,created_at,updated_at,deleted) VALUES(?,?,?,?,?,?,?,0) ON CONFLICT(project_id,kind,key) DO UPDATE SET data=excluded.data, revision=excluded.revision, created_at=excluded.created_at, updated_at=excluded.updated_at, deleted=0").run(project, kind, key, JSON.stringify(data), revision, created, now)
      if (kind === "wiki") this.indexWiki(project, key, data)
      if (kind === "workspace" && key === "default") this.mirrorMemories(project, data)
      if (kind === "workspace" && key === "default") this.indexMemories(project, data)
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
      if (kind === "wiki") this.db.prepare("DELETE FROM wiki_fts WHERE project_id=? AND path=?").run(project, key)
      if (kind === "workspace" && key === "default") {
        this.db.prepare("DELETE FROM memory_transitions WHERE project_id=?").run(project)
        this.db.prepare("DELETE FROM memories WHERE project_id=?").run(project)
        this.db.prepare("DELETE FROM memory_fts WHERE project_id=?").run(project)
      }
      this.event(project, "resource.deleted", kind, key, expected + 1, now)
    })
  }
  async events(project: string, after: number, limit: number): Promise<ProjectEvent[]> {
    return (this.db.prepare("SELECT * FROM events WHERE project_id=? AND sequence>? ORDER BY sequence LIMIT ?").all(project, after, limit) as Row[]).map(row => ({ sequence: Number(row.sequence), projectId: String(row.project_id), type: String(row.type), resource: { kind: row.kind as ResourceKind | "project", key: String(row.key), revision: Number(row.revision) }, recordedAt: String(row.recorded_at) }))
  }
}
