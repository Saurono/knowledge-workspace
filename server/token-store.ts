import type { DatabaseSync } from "node:sqlite"
import type { AgentToken } from "@/modules/identity/domain"
import type { AuthenticationRepository, TokenRepository } from "@/modules/identity/application"
export function createTokenRepository(db: DatabaseSync, auth: AuthenticationRepository): TokenRepository {
  return {
    identities: () => auth.identities(),
    async tokens() { return (db.prepare("SELECT data FROM agent_tokens ORDER BY id").all() as { data: string }[]).map(row => JSON.parse(row.data) as AgentToken) },
    async token(digest) { const row = db.prepare("SELECT data FROM agent_tokens WHERE digest=?").get(digest) as { data: string } | undefined; return row ? JSON.parse(row.data) as AgentToken : null },
    async saveToken(token) { db.prepare("INSERT INTO agent_tokens(id,account_id,digest,data) VALUES(?,?,?,?)").run(token.id, token.accountId, token.digest, JSON.stringify(token)) },
    async revokeToken(id, now) { db.prepare("UPDATE agent_tokens SET data=json_set(data,'$.revokedAt',?) WHERE id=?").run(now, id) },
  }
}
