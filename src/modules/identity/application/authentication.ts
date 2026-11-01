import { AuthError, accountHandle, identityName, requirePassword } from "../domain"
import type { Account, AccountInput, IdentitySnapshot, LoginSession, RegistrationResult, SessionIdentity } from "../domain"
export interface AuthenticationRepository {
  initialized(): Promise<boolean>
  register(account: Account, passwordHash: string | null, expectedRevision: number | null): Promise<RegistrationResult>
  password(handle: string): Promise<{ account: Account; hash: string } | null>
  session(digest: string): Promise<LoginSession | null>
  saveSession(session: LoginSession): Promise<void>
  touchSession(id: string, now: string): Promise<void>
  revokeSession(id: string, now: string): Promise<void>
  changePassword(accountId: string, hash: string, now: string): Promise<void>
  failedLogin(key: string, now: string): Promise<number>
  loginFailures(key: string, since: string): Promise<number>
  clearFailures(key: string): Promise<void>
  identities(): Promise<IdentitySnapshot>
}
export interface AuthenticationRuntime { id(): string; now(): string; secret(): string; digest(value: string): string; hash(password: string): Promise<string>; verify(password: string, hash: string | null): Promise<boolean> }
export function createAuthenticationService(repository: AuthenticationRepository, runtime: AuthenticationRuntime) {
  const makeAccount = (input: AccountInput): Account => {
    if (!["user", "agent", "admin"].includes(input.kind)) throw new AuthError("invalid_argument", "Invalid account kind")
    const now = runtime.now()
    return { id: runtime.id(), handle: accountHandle(input.handle), displayName: identityName(input.displayName), kind: input.kind, status: "active", createdAt: now, updatedAt: now }
  }
  const login = async (handle: unknown, password: unknown, attemptKey: string) => {
    const normalized = typeof handle === "string" ? handle.normalize("NFKC").trim().toLowerCase().slice(0, 64) : ""
    const key = runtime.digest(attemptKey + "\0" + normalized), now = runtime.now()
    if (await repository.loginFailures(key, new Date(Date.parse(now) - 15 * 60_000).toISOString()) >= 5) throw new AuthError("too_many_requests", "Too many login attempts; retry later")
    // Count before the expensive verifier so parallel attempts cannot bypass the limit.
    if (await repository.failedLogin(key, now) > 5) throw new AuthError("too_many_requests", "Too many login attempts; retry later")
    const credential = await repository.password(normalized)
    const valid = await runtime.verify(typeof password === "string" && password.length <= 256 ? password : "", credential?.hash ?? null)
    if (!valid || !credential || credential.account.status !== "active" || credential.account.kind === "agent") throw new AuthError("unauthenticated", "Invalid account or password")
    await repository.clearFailures(key)
    const raw = runtime.secret(), session: LoginSession = { id: runtime.id(), accountId: credential.account.id, digest: runtime.digest(raw), createdAt: now, expiresAt: new Date(Date.parse(now) + 12 * 60 * 60_000).toISOString(), lastSeenAt: now, revokedAt: null }
    await repository.saveSession(session)
    return { secret: raw, account: credential.account, expiresAt: session.expiresAt }
  }
  const authenticate = async (raw: string): Promise<SessionIdentity> => {
    const session = await repository.session(runtime.digest(raw)), now = runtime.now()
    if (!session || session.revokedAt || Date.parse(session.expiresAt) <= Date.parse(now) || Date.parse(session.lastSeenAt) + 30 * 60_000 <= Date.parse(now)) throw new AuthError("unauthenticated", "Session expired; sign in again")
    const account = (await repository.identities()).catalog.accounts.find(account => account.id === session.accountId)
    if (!account || account.status !== "active" || account.kind === "agent") throw new AuthError("unauthenticated", "Account unavailable")
    await repository.touchSession(session.id, now)
    return { account, principal: { accountId: account.id, channel: "session", credentialId: session.id }, expiresAt: session.expiresAt }
  }
  return {
    initialized: () => repository.initialized(), login, authenticate,
    async bootstrap(input: Omit<AccountInput, "kind">) {
      const account = makeAccount({ ...input, kind: "admin" }), hash = await runtime.hash(requirePassword(input.password))
      return repository.register(account, hash, null)
    },
    async createAccount(revision: number, input: AccountInput) {
      const account = makeAccount(input)
      return repository.register(account, account.kind === "agent" ? null : await runtime.hash(requirePassword(input.password)), revision)
    },
    async logout(raw: string) { const session = await repository.session(runtime.digest(raw)); if (session) await repository.revokeSession(session.id, runtime.now()) },
    async changePassword(account: Account, oldPassword: unknown, newPassword: unknown) {
      const credential = await repository.password(account.handle)
      if (!credential || !(await runtime.verify(typeof oldPassword === "string" ? oldPassword : "", credential.hash))) throw new AuthError("unauthenticated", "Invalid account or password")
      await repository.changePassword(account.id, await runtime.hash(requirePassword(newPassword)), runtime.now())
    },
  }
}
