import type { DatabaseSync } from "node:sqlite"
import { AuthError } from "@/modules/identity/domain"
import type { AuditEntry, AuditPage } from "@/modules/identity/domain"
const keywords = new Set("api v1 projects wiki page documents content workspace events stream auth login logout me bootstrap password status tokens admin accounts access options contexts members roles delegations memories grants retrieval search tasks cancel cli mcp audit".split(" "))
export const auditAction = (method: string, pathname: string) => `${method} ${pathname.split("/").map(part => !part || keywords.has(part) ? part : ":id").join("/")}`
export function createAuditRepository(db: DatabaseSync) {
  return {
    start(entry: Omit<AuditEntry, "sequence">): number {
      return Number(db.prepare("INSERT INTO audit_log(project_id,actor_id,data) VALUES(?,?,?)").run(entry.projectId, entry.actorId, JSON.stringify(entry)).lastInsertRowid)
    },
    finish(sequence: number, update: Partial<AuditEntry>) {
      const row = db.prepare("SELECT data FROM audit_log WHERE sequence=?").get(sequence) as { data: string }
      const entry = { ...JSON.parse(row.data), ...update }
      db.prepare("UPDATE audit_log SET project_id=?,actor_id=?,data=? WHERE sequence=?").run(entry.projectId, entry.actorId, JSON.stringify(entry), sequence)
    },
    async list(projectId: string | null, actorId: string | undefined, before?: string | null, limit?: string | null, result?: string | null): Promise<AuditPage> {
      const cursor = before == null ? Number.MAX_SAFE_INTEGER : Number(before), size = limit == null ? 50 : Number(limit)
      if (!Number.isSafeInteger(cursor) || cursor < 1 || !Number.isInteger(size) || size < 1 || size > 100 || (result && !["allowed", "denied", "failed"].includes(result))) throw new AuthError("invalid_argument", "Invalid audit cursor, limit or result filter")
      const rows = db.prepare("SELECT sequence,data FROM audit_log WHERE project_id IS ? AND (? IS NULL OR actor_id=?) AND sequence<? AND (? IS NULL OR json_extract(data,'$.result')=?) ORDER BY sequence DESC LIMIT ?").all(projectId, actorId ?? null, actorId ?? null, cursor, result || null, result || null, size + 1) as { sequence: number; data: string }[]
      const items = rows.slice(0, size).map(row => ({ ...JSON.parse(row.data), sequence: row.sequence }) as AuditEntry)
      return { items, nextCursor: rows.length > size ? items[items.length - 1].sequence : null }
    },
  }
}
