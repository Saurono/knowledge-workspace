import type { DatabaseSync } from "node:sqlite"
import type { ContextRepository, AuthenticationRepository } from "@/modules/identity/application"
import type { AccessContext, IdentityDelegation } from "@/modules/identity/domain"
export function createContextRepository(db: DatabaseSync, auth: AuthenticationRepository): ContextRepository {
  return {
    identities: () => auth.identities(),
    async delegations() { return (db.prepare("SELECT data FROM identity_delegations ORDER BY id").all() as { data: string }[]).map(row => JSON.parse(row.data) as IdentityDelegation) },
    async saveDelegation(grant) { db.prepare("INSERT INTO identity_delegations(id,data) VALUES(?,?)").run(grant.id, JSON.stringify(grant)) },
    async revokeDelegation(id, now) { db.prepare("UPDATE identity_delegations SET data=json_set(data,'$.revokedAt',?) WHERE id=?").run(now, id) },
    async context(id) { const row = db.prepare("SELECT data FROM access_contexts WHERE id=?").get(id) as { data: string } | undefined; return row ? JSON.parse(row.data) as AccessContext : null },
    async saveContext(context) { db.prepare("INSERT INTO access_contexts(id,data) VALUES(?,?)").run(context.id, JSON.stringify(context)) },
  }
}
