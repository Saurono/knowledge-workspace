import type { DatabaseSync } from "node:sqlite"
import { AuthError, IdentityError, validateIdentityCatalog } from "@/modules/identity/domain"
import type { IdentitySnapshot, LoginSession } from "@/modules/identity/domain"
import type { AuthenticationRepository } from "@/modules/identity/application"
export function createAuthenticationRepository(db: DatabaseSync): AuthenticationRepository {
  const identities = (): IdentitySnapshot => {
    const row = db.prepare("SELECT data,revision FROM identity_catalog WHERE id=1").get() as { data: string; revision: number }
    return { catalog: validateIdentityCatalog(JSON.parse(row.data)), revision: row.revision }
  }
  const transaction = <T>(change: () => T): T => { db.exec("BEGIN IMMEDIATE"); try { const value = change(); db.exec("COMMIT"); return value } catch (error) { db.exec("ROLLBACK"); throw error } }
  const initialized = () => identities().catalog.accounts.some(account => account.kind === "admin" && !!db.prepare("SELECT 1 FROM passwords WHERE account_id=?").get(account.id))
  return {
    async identities() { return identities() },
    async initialized() { return initialized() },
    async register(account, hash, expectedRevision) {
      return transaction(() => {
        const state = identities()
        if (expectedRevision === null) { if (initialized()) throw new AuthError("conflict", "Initial administrator already exists") }
        else if (!Number.isSafeInteger(expectedRevision) || state.revision !== expectedRevision) throw new IdentityError("conflict", "Identity catalog changed; reload", state.revision)
        const legacy = expectedRevision === null ? state.catalog.accounts.find(previous => previous.handle === account.handle && previous.kind === "admin" && previous.status === "active") : undefined
        const registered = legacy ?? account
        const catalog = validateIdentityCatalog({ ...state.catalog, accounts: legacy ? state.catalog.accounts : [...state.catalog.accounts, account] }), revision = state.revision + 1
        db.prepare("UPDATE identity_catalog SET data=?,revision=? WHERE id=1").run(JSON.stringify(catalog), revision)
        if (hash) db.prepare("INSERT INTO passwords(account_id,hash) VALUES(?,?)").run(registered.id, hash)
        return { snapshot: { catalog, revision }, account: registered }
      })
    },
    async password(handle) {
      const account = identities().catalog.accounts.find(account => account.handle === handle)
      if (!account) return null
      const row = db.prepare("SELECT hash FROM passwords WHERE account_id=?").get(account.id) as { hash: string } | undefined
      return row ? { account, hash: row.hash } : null
    },
    async sessionById(id) { const row = db.prepare("SELECT data FROM login_sessions WHERE id=?").get(id) as { data: string } | undefined; return row ? JSON.parse(row.data) as LoginSession : null },
    async session(digest) {
      const row = db.prepare("SELECT data FROM login_sessions WHERE digest=?").get(digest) as { data: string } | undefined
      return row ? JSON.parse(row.data) as LoginSession : null
    },
    async saveSession(session) { db.prepare("INSERT INTO login_sessions(id,account_id,digest,data) VALUES(?,?,?,?)").run(session.id, session.accountId, session.digest, JSON.stringify(session)) },
    async touchSession(id, now) { db.prepare("UPDATE login_sessions SET data=json_set(data,'$.lastSeenAt',?) WHERE id=? AND json_extract(data,'$.revokedAt') IS NULL").run(now, id) },
    async revokeSession(id, now) { db.prepare("UPDATE login_sessions SET data=json_set(data,'$.revokedAt',?) WHERE id=?").run(now, id) },
    async changePassword(accountId, hash, now) {
      transaction(() => {
        db.prepare("UPDATE passwords SET hash=? WHERE account_id=?").run(hash, accountId)
        db.prepare("UPDATE login_sessions SET data=json_set(data,'$.revokedAt',?) WHERE account_id=?").run(now, accountId)
      })
    },
    async loginFailures(key, since) { return Number((db.prepare("SELECT count(*) AS count FROM login_attempts WHERE key=? AND attempted_at>?").get(key, since) as { count: number }).count) },
    async failedLogin(key, now) {
      db.prepare("DELETE FROM login_attempts WHERE attempted_at<=?").run(new Date(Date.parse(now) - 15 * 60_000).toISOString())
      db.prepare("INSERT INTO login_attempts(key,attempted_at) VALUES(?,?)").run(key, now)
      return Number((db.prepare("SELECT count(*) AS count FROM login_attempts WHERE key=?").get(key) as { count: number }).count)
    },
    async clearFailures(key) { db.prepare("DELETE FROM login_attempts WHERE key=?").run(key) },
  }
}
