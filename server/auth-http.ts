import type { IncomingMessage, ServerResponse } from "node:http"
import { randomUUID, timingSafeEqual } from "node:crypto"
import { createAuthenticationService, createIdentityCatalogService, createAgentTokenService, createContextService } from "@/modules/identity/application"
import { AuthError, globalPermissions, requireContextPermission, identityId } from "@/modules/identity/domain"
import type { AccountInput, SessionIdentity, MemoryGrant, AccessContext } from "@/modules/identity/domain"
import type { SharedWorkspace } from "@/modules/service-api/application"
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
  const contexts = createContextService(repository.contexts, { id: randomUUID, now })
  const catalog = createIdentityCatalogService(repository.identities, { id: randomUUID, now, projectExists: async id => !!(await repository.project(id)) })
  const projectDirectory = (state: Awaited<ReturnType<typeof catalog.read>>, projectId: string) => ({ revision: state.revision, members: state.catalog.memberships.filter(member => member.projectId === projectId), roles: state.catalog.workRoles.filter(role => role.projectId === projectId), accounts: state.catalog.accounts.map(({ id, handle, displayName, kind, status }) => ({ id, handle, displayName, kind, status })) })
  const cookie = (response: ServerResponse, raw: string, maxAge: number) => response.setHeader("Set-Cookie", `kw_session=${raw}; HttpOnly; SameSite=Strict; Path=/api/v1; Max-Age=${maxAge}${secureCookies ? "; Secure" : ""}`)
  const authenticate = (request: IncomingMessage): Promise<SessionIdentity> => {
    const authorization = request.headers.authorization
    if (authorization !== undefined) {
      if (!/^Bearer kwt_[A-Za-z0-9_-]{43}$/.test(authorization)) return Promise.reject(new AuthError("unauthenticated", "Valid Agent Token required"))
      return tokens.authenticate(authorization.slice(7))
    }
    return auth.authenticate(sessionCookie(request))
  }
  const requireAdmin = async (request: IncomingMessage, observe?: (identity: SessionIdentity) => void) => { const identity = await authenticate(request); observe?.(identity); if (!globalPermissions(identity.account).includes("accounts.manage")) throw new AuthError("forbidden", "Account administration requires an administrator"); return identity }
  return {
    auth, catalog, tokens, contexts, authenticate, now,
    async validatePrincipal(principal: SessionIdentity["principal"]) {
      const account = (await catalog.read()).catalog.accounts.find(account => account.id === principal.accountId && account.status === "active")
      if (!account) throw new AuthError("unauthenticated", "Account unavailable")
      if (principal.channel === "session") {
        const session = await repository.authentication.sessionById(principal.credentialId)
        if (!session || session.accountId !== principal.accountId || session.revokedAt || Date.parse(session.expiresAt) <= Date.parse(now()) || Date.parse(session.lastSeenAt) + 30 * 60_000 <= Date.parse(now())) throw new AuthError("unauthenticated", "Session expired")
      } else {
        const token = (await repository.tokens.tokens()).find(token => token.id === principal.credentialId && token.accountId === principal.accountId)
        if (!token || token.revokedAt || Date.parse(token.expiresAt) <= Date.parse(now())) throw new AuthError("unauthenticated", "Agent Token expired or revoked")
      }
    },
    async access(principal: SessionIdentity["principal"], projectId: string) { return contexts.resolve(principal, projectId) },
    async handle(request: IncomingMessage, response: ServerResponse, pathname: string, json: JsonBody, send: JsonSend, observe?: (identity: SessionIdentity, context?: AccessContext) => void) {
      const verified = async () => { const identity = await authenticate(request); observe?.(identity); return identity }
      const method = request.method
      if (pathname === "/api/v1/auth/status" && method === "GET") { send(200, { initialized: await auth.initialized() }); return true }
      if (pathname === "/api/v1/auth/bootstrap" && method === "POST") {
        const supplied = String(request.headers["x-kw-setup-key"] ?? "")
        if (!bootstrapKey || !timingSafeEqual(Buffer.from(secretDigest(supplied)), Buffer.from(secretDigest(bootstrapKey)))) throw new AuthError("forbidden", "Valid initialization key required")
        const body = await json(), result = await auth.bootstrap({ handle: body.handle as string, displayName: body.displayName as string, password: body.password as string })
        observe?.({ account: result.account, principal: { accountId: result.account.id, credentialId: "", channel: "session" }, expiresAt: now() }); send(201, { account: result.account }); return true
      }
      if (pathname === "/api/v1/auth/login" && method === "POST") {
        const body = await json(), result = await auth.login(body.handle, body.password, request.socket.remoteAddress ?? "unknown")
        observe?.(await auth.authenticate(result.secret)); cookie(response, result.secret, 12 * 60 * 60); send(200, { account: result.account, expiresAt: result.expiresAt }); return true
      }
      if (pathname === "/api/v1/auth/logout" && method === "POST") { try { await verified() } catch { /* Logout is idempotent after expiry. */ } await auth.logout(sessionCookie(request)); cookie(response, "", 0); send(200, null); return true }
      if (pathname === "/api/v1/auth/me" && method === "GET") { send(200, await verified()); return true }
      if (pathname === "/api/v1/auth/password" && method === "POST") {
        const identity = await verified(), body = await json()
        await auth.changePassword(identity.account, body.oldPassword, body.newPassword); cookie(response, "", 0); send(200, null); return true
      }
      if (pathname === "/api/v1/admin/accounts" && method === "GET") { await requireAdmin(request, observe); send(200, await catalog.read()); return true }
      if (pathname === "/api/v1/admin/accounts" && method === "POST") {
        await requireAdmin(request, observe); const body = await json()
        const result = await auth.createAccount(body.revision as number, body as unknown as AccountInput)
        send(201, result.snapshot); return true
      }
      const status = pathname.match(/^\/api\/v1\/admin\/accounts\/([^/]+)\/status$/)
      if (status && method === "PUT") {
        await requireAdmin(request, observe); const body = await json()
        if (body.status !== "active" && body.status !== "disabled") throw new AuthError("invalid_argument", "Invalid account status")
        send(200, await catalog.setAccountStatus(body.revision as number, status[1], body.status)); return true
      }
      if (pathname === "/api/v1/auth/tokens" && method === "GET") { const identity = await verified(); send(200, await tokens.list(identity.principal)); return true }
      if (pathname === "/api/v1/auth/tokens" && method === "POST") { const identity = await verified(); const result = await tokens.create(identity.principal, await json() as never); observe?.(identity, await contexts.resolve(identity.principal, result.token.projectId)); send(201, result); return true }
      const revoke = pathname.match(/^\/api\/v1\/auth\/tokens\/([^/]+)$/)
      if (revoke && method === "DELETE") { const identity = await verified(); await tokens.revoke(identity.principal, revoke[1]); send(200, null); return true }
      const projectRoute = pathname.match(/^\/api\/v1\/projects\/([^/]+)\/(contexts|delegations|members|roles)(?:\/([^/]+))?$/)
      if (projectRoute) {
        const identity = await verified(), [, projectId, part, targetId] = projectRoute
        if (part === "contexts" && method === "POST" && !targetId) { const selected = await contexts.switch(identity.principal, projectId, await json()); observe?.(identity, selected); send(201, selected); return true }
        if (part === "delegations") {
          if (method === "GET" && !targetId) { send(200, await contexts.list(identity.principal, projectId)); return true }
          if (method === "POST" && !targetId) { send(201, await contexts.grant(identity.principal, { ...await json(), projectId } as never)); return true }
          if (method === "DELETE" && targetId) { await contexts.revoke(identity.principal, projectId, targetId); send(200, null); return true }
        }
        if ((part === "members" || part === "roles") && !targetId) {
          const access = await contexts.resolve(identity.principal, projectId, request.headers["x-kw-context"] as string | undefined)
          observe?.(identity, access)
          requireContextPermission(access, part === "members" ? "members.manage" : "roles.manage")
          if (method === "GET") {
            const state = await catalog.read()
            send(200, projectDirectory(state, projectId)); return true
          }
          if (method === "PUT") {
            const body = await json()
            const updated = part === "members" ? await catalog.saveMembership(body.revision as number, { ...body, projectId } as never) : await catalog.saveWorkRole(body.revision as number, { ...body, projectId } as never)
            send(200, projectDirectory(updated, projectId)); return true
          }
        }
      }
      const memoryGrantRoute = pathname.match(/^\/api\/v1\/projects\/([^/]+)\/memories\/([^/]+)\/grants(?:\/([^/]+))?$/)
      if (memoryGrantRoute) {
        const [, projectId, memoryId, grantId] = memoryGrantRoute, identity = await verified()
        const access = await contexts.resolve(identity.principal, projectId, request.headers["x-kw-context"] as string | undefined)
        requireContextPermission(access, "memory.write")
        const workspace = await repository.get(projectId, "workspace", "default"), memory = (workspace?.data as SharedWorkspace | undefined)?.memories.find(memory => memory.id === memoryId)
        if (!memory?.access || memory.access.ownerId !== access.actorId || access.actorId !== access.effectiveAccountId) throw new AuthError("forbidden", "Only the actual memory owner may manage private grants")
        const grants = await repository.memoryGrants.list(projectId)
        if (method === "GET" && !grantId) { send(200, grants.filter(grant => grant.memoryId === memoryId)); return true }
        if (method === "POST" && !grantId) {
          const body = await json(), accountId = identityId(body.accountId), end = Date.parse(body.expiresAt as string)
          if (!Number.isFinite(end) || end <= Date.parse(now()) || end > Date.parse(now()) + 90 * 24 * 60 * 60_000 || !Array.isArray(body.actions) || !body.actions.length || body.actions.some(action => action !== "read" && action !== "write")) throw new AuthError("invalid_argument", "Choose read/write actions and an expiry within 90 days")
          const state = await catalog.read()
          if (!state.catalog.accounts.some(account => account.id === accountId && account.status === "active") || !state.catalog.memberships.some(member => member.projectId === projectId && member.accountId === accountId && member.status === "active")) throw new AuthError("forbidden", "Grant recipient must be an active project member")
          const grant: MemoryGrant = { id: randomUUID(), projectId, memoryId, ownerId: access.actorId, accountId, actions: [...new Set(body.actions)] as ("read" | "write")[], expiresAt: new Date(end).toISOString(), revokedAt: null }
          await repository.memoryGrants.save(grant); send(201, grant); return true
        }
        if (method === "DELETE" && grantId && grants.some(grant => grant.id === grantId && grant.memoryId === memoryId)) { await repository.memoryGrants.revoke(grantId, now()); send(200, null); return true }
      }
      const optionsRoute = pathname.match(/^\/api\/v1\/projects\/([^/]+)\/access\/options$/)
      if (optionsRoute && method === "GET") {
        const identity = await verified(), projectId = optionsRoute[1], state = await catalog.read(), own = await contexts.capture(identity.principal, projectId)
        const member = state.catalog.memberships.find(member => member.accountId === identity.account.id && member.projectId === projectId && member.status === "active")!
        const options: { id: string; label: string; selection: import("@/modules/identity/domain").ContextSelection; context: AccessContext }[] = [{ id: "self", label: `${identity.account.displayName} · 成员默认权限`, selection: {}, context: own }]
        for (const role of state.catalog.workRoles.filter(role => role.projectId === projectId && role.status === "active" && member.workRoleIds.includes(role.id))) {
          try { const context = await contexts.capture(identity.principal, projectId, { workRoleId: role.id }); options.push({ id: role.id, label: `${identity.account.displayName} · ${role.name}`, selection: { workRoleId: role.id }, context }) } catch { /* Outside the live Token/member scope. */ }
        }
        for (const grant of await contexts.list(identity.principal, projectId)) if (grant.granteeId === identity.account.id && !grant.revokedAt && Date.parse(grant.expiresAt) > Date.parse(now())) {
          try { const selection = { effectiveAccountId: grant.grantorId, workRoleId: grant.workRoleId, delegationId: grant.id }, context = await contexts.capture(identity.principal, projectId, selection); options.push({ id: grant.id, label: `${state.catalog.accounts.find(account => account.id === grant.grantorId)?.displayName ?? grant.grantorId} · 获授权身份`, selection, context }) } catch { /* Revoked or out of scope. */ }
        }
        send(200, options); return true
      }
      const auditRoute = pathname.match(/^\/api\/v1\/projects\/([^/]+)\/audit$/)
      if (auditRoute && method === "GET") {
        const identity = await verified(), context = await contexts.resolve(identity.principal, auditRoute[1], request.headers["x-kw-context"] as string | undefined), query = new URL(request.url!, "http://service").searchParams
        observe?.(identity, context); requireContextPermission(context, "project.read")
        const requestedActor = query.get("actor"), canManage = context.permissions.includes("project.settings.manage")
        if (!canManage && requestedActor && requestedActor !== identity.account.id) throw new AuthError("forbidden", "Audit entries are limited to the actual operator")
        send(200, await repository.audit.list(context.projectId, canManage ? requestedActor ?? undefined : identity.account.id, query.get("before"), query.get("limit"), query.get("result"))); return true
      }
      if (pathname === "/api/v1/auth/audit" && method === "GET") {
        const identity = await verified(), query = new URL(request.url!, "http://service").searchParams
        send(200, await repository.audit.list(null, identity.account.id, query.get("before"), query.get("limit"), query.get("result"))); return true
      }
      if (pathname === "/api/v1/admin/audit" && method === "GET") {
        await requireAdmin(request, observe); const query = new URL(request.url!, "http://service").searchParams
        send(200, await repository.audit.list(null, query.get("actor") ?? undefined, query.get("before"), query.get("limit"), query.get("result"))); return true
      }
      return false
    },
  }
}
export type AccountAuthentication = ReturnType<typeof createAccountAuthentication>
