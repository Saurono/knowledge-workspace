import { AuthError, PROJECT_PERMISSIONS, identityId, identityName, evaluateProjectPermission, publicAgentToken } from "../domain"
import type { AgentToken, IdentitySnapshot, Principal, ProjectPermission, SessionIdentity, TokenScope } from "../domain"
export interface TokenRepository {
  identities(): Promise<IdentitySnapshot>
  tokens(): Promise<AgentToken[]>
  token(digest: string): Promise<AgentToken | null>
  saveToken(token: AgentToken): Promise<void>
  revokeToken(id: string, now: string): Promise<void>
}
export function createAgentTokenService(repository: TokenRepository, runtime: { id(): string; now(): string; secret(): string; digest(raw: string): string }) {
  const list = async (actor: Principal) => {
    const catalog = (await repository.identities()).catalog, account = catalog.accounts.find(account => account.id === actor.accountId && account.status === "active")
    if (!account) throw new AuthError("unauthenticated", "Account unavailable")
    return (await repository.tokens()).filter(token => account.kind === "admin" || token.issuerId === actor.accountId || token.accountId === actor.accountId)
  }
  return {
    async list(actor: Principal) { return (await list(actor)).map(publicAgentToken) },
    async create(actor: Principal, input: TokenScope & { accountId: string; label: string; expiresAt: string }) {
      if (actor.channel !== "session") throw new AuthError("forbidden", "Token issuance requires an interactive session")
      identityId(input.projectId); identityId(input.accountId)
      const catalog = (await repository.identities()).catalog, account = catalog.accounts.find(account => account.id === input.accountId && account.kind === "agent" && account.status === "active")
      if (!account) throw new AuthError("invalid_argument", "An active Agent account is required")
      const issuer = catalog.accounts.find(account => account.id === actor.accountId && account.status === "active")
      if (!issuer || !evaluateProjectPermission(catalog, { accountId: actor.accountId, projectId: input.projectId, permission: "members.manage" }).allowed) throw new AuthError("forbidden", "Project member administration required")
      if (!Array.isArray(input.permissions) || !input.permissions.length || new Set(input.permissions).size !== input.permissions.length || !input.permissions.includes("project.read") || input.permissions.some(permission => !PROJECT_PERMISSIONS.includes(permission))) throw new AuthError("invalid_argument", "Choose unique project permissions including project.read")
      const now = runtime.now(), end = Date.parse(input.expiresAt)
      if (!Number.isFinite(end) || end <= Date.parse(now) || end > Date.parse(now) + 90 * 24 * 60 * 60_000) throw new AuthError("invalid_argument", "Token expiry must be within the next 90 days")
      const role = input.workRoleId == null ? undefined : identityId(input.workRoleId)
      for (const permission of input.permissions) {
        if (!evaluateProjectPermission(catalog, { accountId: account.id, projectId: input.projectId, permission, workRoleId: role }).allowed || !evaluateProjectPermission(catalog, { accountId: issuer.id, projectId: input.projectId, permission }).allowed) throw new AuthError("forbidden", "Token scope exceeds granted project permissions")
      }
      const raw = `kwt_${runtime.secret()}`, token: AgentToken = { id: runtime.id(), accountId: account.id, issuerId: issuer.id, label: identityName(input.label), projectId: input.projectId, workRoleId: role ?? null, permissions: [...input.permissions] as ProjectPermission[], createdAt: now, expiresAt: new Date(end).toISOString(), revokedAt: null, prefix: raw.slice(0, 12), digest: runtime.digest(raw) }
      await repository.saveToken(token)
      return { token: publicAgentToken(token), secret: raw }
    },
    async authenticate(raw: string): Promise<SessionIdentity> {
      const token = await repository.token(runtime.digest(raw)), now = runtime.now()
      if (!token || token.revokedAt || Date.parse(token.expiresAt) <= Date.parse(now)) throw new AuthError("unauthenticated", "Invalid or expired Agent Token")
      const catalog = (await repository.identities()).catalog, account = catalog.accounts.find(account => account.id === token.accountId && account.kind === "agent" && account.status === "active")
      if (!account || !evaluateProjectPermission(catalog, { accountId: account.id, projectId: token.projectId, permission: "project.read", workRoleId: token.workRoleId ?? undefined }).allowed) throw new AuthError("unauthenticated", "Agent authorization unavailable")
      return { account, principal: { accountId: account.id, credentialId: token.id, channel: "token", scope: { projectId: token.projectId, workRoleId: token.workRoleId, permissions: [...token.permissions] } }, expiresAt: token.expiresAt }
    },
    async revoke(actor: Principal, id: string) {
      if (!(await list(actor)).some(token => token.id === id)) throw new AuthError("not_found", "Token not found")
      await repository.revokeToken(id, runtime.now())
    },
  }
}
