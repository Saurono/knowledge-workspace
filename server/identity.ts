import type { DatabaseSync } from "node:sqlite"
import { IdentityError, validateIdentityCatalog } from "@/modules/identity/domain"
import type { IdentitySnapshot } from "@/modules/identity/domain"
import type { IdentityRepository } from "@/modules/identity/application"

/** Internal administrative storage; never registered as unauthenticated HTTP routes. */
export function createSqliteIdentityRepository(db: DatabaseSync): IdentityRepository {
  const read = (): IdentitySnapshot => {
    const row = db.prepare("SELECT data,revision FROM identity_catalog WHERE id=1").get() as { data: string; revision: number } | undefined
    if (!row) throw new Error("Identity catalog missing; original database preserved")
    return { revision: row.revision, catalog: validateIdentityCatalog(JSON.parse(row.data)) }
  }
  read() // Fail at startup instead of silently replacing corrupt persisted identities.
  return {
    async read() { return read() },
    async update(expectedRevision, change) {
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new IdentityError("invalid_argument", "An identity catalog revision is required")
      db.exec("BEGIN IMMEDIATE")
      try {
        const current = read()
        if (current.revision !== expectedRevision) throw new IdentityError("conflict", "Identity catalog changed; reload before updating", current.revision)
        const before = JSON.stringify(current.catalog)
        const next = validateIdentityCatalog(change(current.catalog))
        const serialized = JSON.stringify(next)
        if (serialized === before) { db.exec("COMMIT"); return current }
        for (const account of next.accounts) if (account.status === "disabled" && current.catalog.accounts.find(previous => previous.id === account.id)?.status !== "disabled") {
          db.prepare("UPDATE agent_tokens SET data=json_set(data,'$.revokedAt',?) WHERE account_id=?").run(account.updatedAt, account.id)
          db.prepare("UPDATE login_sessions SET data=json_set(data,'$.revokedAt',?) WHERE account_id=?").run(account.updatedAt, account.id)
        }
        const revision = current.revision + 1
        db.prepare("UPDATE identity_catalog SET data=?,revision=? WHERE id=1").run(serialized, revision)
        db.exec("COMMIT")
        return { revision, catalog: next }
      } catch (error) { db.exec("ROLLBACK"); throw error }
    },
  }
}
