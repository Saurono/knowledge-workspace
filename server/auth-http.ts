import type { IncomingMessage, ServerResponse } from "node:http"
import { randomUUID, timingSafeEqual } from "node:crypto"
import { createAuthenticationService, createIdentityCatalogService, createAgentTokenService, captureAccessContext } from "@/modules/identity/application"
import { AuthError, globalPermissions } from "@/modules/identity/domain"
import type { AccountInput, SessionIdentity } from "@/modules/identity/domain"
import type { SqliteRepository } from "./repository"
import { hashPassword, verifyPassword, secretDigest, opaqueSecret } from "./passwords"
export type JsonBody = () => Promise<Record<string, unknown>>
export type JsonSend = (status: number, data: unknown, cursor?: string | null) => void
export function sessionCookie(request: IncomingMessage) {
  const cookies = request.headers.cookie?.split(";").map(value => value.trim()).filter(value => value.startsWith("kw_session=")) ?? []
  return cookies.length === 1 ? cookies[0].slice("kw_session=".length) : ""
}
export function createAccountAuthentication(repository: SqliteRepository, bootstrapKey: string, secureCookies = false, now = () => new Date().toISOString()) {
  const auth = createAuthenticationService(repository.authentication, { id: randomUUID, now, secret: opaqueSecret, digest: secretDigest, hash: hashPassword, verify: verifyPassword })
  const tokens = createAgentTokenService(repository.tokens, { id: randomUUID, now, secret: opaqueSecret, digest: secretDigest })
  const catalog = createIdentityCatalogService(repository.identities, { id: randomUUID, now, projectExists: async id => !!(await repository.project(id)) })
  const cookie = (response: ServerResponse, raw: string, maxAge: number) => response.setHeader("Set-Cookie", `kw_session=${raw}; HttpOnly; SameSite=Strict; Path=/api/v1; Max-Age=${maxAge}${secureCookies ? "; Secure" : ""}`)
  const authenticate = (request: IncomingMessage): Promise<SessionIdentity> => {
    const authorization = request.headers.authorization
    if (authorization !== undefined) {
      if (!/^Bearer kwt_[A-Za-z0-9_-]{43}$/.test(authorization)) return Promise.reject(new AuthError("unauthenticated", "Valid Agent Token required"))
      return tokens.authenticate(authorization.slice(7))
    }
    return auth.authenticate(sessionCookie(request))
  }
  const requireAdmin = async (request: IncomingMessage) => { const identity = await authenticate(request); if (!globalPermissions(identity.account).includes("accounts.manage")) throw new AuthError("forbidden", "Account administration requires an administrator"); return identity }
  return {
    auth, catalog, tokens, authenticate,
    async access(principal: SessionIdentity["principal"], projectId: string) { return captureAccessContext(await catalog.read(), principal, projectId, { id: randomUUID, now }) },
    async handle(request: IncomingMessage, response: ServerResponse, pathname: string, json: JsonBody, send: JsonSend) {
      const method = request.method
      if (pathname === "/api/v1/auth/status" && method === "GET") { send(200, { initialized: await auth.initialized() }); return true }
      if (pathname === "/api/v1/auth/bootstrap" && method === "POST") {
        const supplied = String(request.headers["x-kw-setup-key"] ?? "")
        if (!bootstrapKey || !timingSafeEqual(Buffer.from(secretDigest(supplied)), Buffer.from(secretDigest(bootstrapKey)))) throw new AuthError("forbidden", "Valid initialization key required")
        const body = await json(), result = await auth.bootstrap({ handle: body.handle as string, displayName: body.displayName as string, password: body.password as string })
        send(201, { account: result.account }); return true
      }
      if (pathname === "/api/v1/auth/login" && method === "POST") {
        const body = await json(), result = await auth.login(body.handle, body.password, request.socket.remoteAddress ?? "unknown")
        cookie(response, result.secret, 12 * 60 * 60); send(200, { account: result.account, expiresAt: result.expiresAt }); return true
      }
      if (pathname === "/api/v1/auth/logout" && method === "POST") { await auth.logout(sessionCookie(request)); cookie(response, "", 0); send(200, null); return true }
      if (pathname === "/api/v1/auth/me" && method === "GET") { send(200, await authenticate(request)); return true }
      if (pathname === "/api/v1/auth/password" && method === "POST") {
        const identity = await authenticate(request), body = await json()
        await auth.changePassword(identity.account, body.oldPassword, body.newPassword); cookie(response, "", 0); send(200, null); return true
      }
      if (pathname === "/api/v1/admin/accounts" && method === "GET") { await requireAdmin(request); send(200, await catalog.read()); return true }
      if (pathname === "/api/v1/admin/accounts" && method === "POST") {
        await requireAdmin(request); const body = await json()
        const result = await auth.createAccount(body.revision as number, body as unknown as AccountInput)
        send(201, result.snapshot); return true
      }
      const status = pathname.match(/^\/api\/v1\/admin\/accounts\/([^/]+)\/status$/)
      if (status && method === "PUT") {
        await requireAdmin(request); const body = await json()
        if (body.status !== "active" && body.status !== "disabled") throw new AuthError("invalid_argument", "Invalid account status")
        send(200, await catalog.setAccountStatus(body.revision as number, status[1], body.status)); return true
      }
      if (pathname === "/api/v1/auth/tokens" && method === "GET") { const identity = await authenticate(request); send(200, await tokens.list(identity.principal)); return true }
      if (pathname === "/api/v1/auth/tokens" && method === "POST") { const identity = await authenticate(request); send(201, await tokens.create(identity.principal, await json() as never)); return true }
      const revoke = pathname.match(/^\/api\/v1\/auth\/tokens\/([^/]+)$/)
      if (revoke && method === "DELETE") { const identity = await authenticate(request); await tokens.revoke(identity.principal, revoke[1]); send(200, null); return true }
      return false
    },
  }
}
export type AccountAuthentication = ReturnType<typeof createAccountAuthentication>
