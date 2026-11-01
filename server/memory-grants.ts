import type { DatabaseSync } from "node:sqlite"
import type { MemoryGrant } from "@/modules/identity/domain"
export function createMemoryGrantRepository(db: DatabaseSync) {
  return {
    async list(projectId: string) { return (db.prepare("SELECT data FROM memory_grants WHERE project_id=?").all(projectId) as { data: string }[]).map(row => JSON.parse(row.data) as MemoryGrant) },
    async save(grant: MemoryGrant) { db.prepare("INSERT INTO memory_grants(id,project_id,data) VALUES(?,?,?)").run(grant.id, grant.projectId, JSON.stringify(grant)) },
    async revoke(id: string, now: string) { db.prepare("UPDATE memory_grants SET data=json_set(data,'$.revokedAt',?) WHERE id=?").run(now, id) },
  }
}
