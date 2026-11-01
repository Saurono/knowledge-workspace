import { serveWeb } from "./static"
import { streamProjectEvents } from "./events"
import { createServer } from "node:http"
import type { IncomingMessage, ServerResponse } from "node:http"
import { randomUUID, timingSafeEqual, createHash } from "node:crypto"
import { createSharedService, createDocumentReceiver, type UploadStorage } from "@/modules/service-api/application"
import { ServiceError, ERROR_STATUS, parsePrecondition, etag, API_VERSION } from "@/modules/service-api/domain"
import type { SharedRepository } from "@/modules/service-api/application"
import { AuthError, IdentityError, evaluateProjectPermission } from "@/modules/identity/domain"
import type { ProjectPermission, SessionIdentity } from "@/modules/identity/domain"
import type { AccountAuthentication } from "./auth-http"
export interface ServiceOptions { repository: SharedRepository; token: string; authentication?: AccountAuthentication; maxJsonBytes?: number; uploads?: UploadStorage; maxUploadBytes?: number; webRoot?: string }
export function readBody(request: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let size = 0, failed = false
    const chunks: Buffer[] = []
    request.on("data", (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) { if (!failed) reject(new ServiceError("too_large", "Request body exceeds the configured limit")); failed = true; return }
      if (!failed) chunks.push(chunk)
    })
    request.on("end", () => { if (!failed) resolve(Buffer.concat(chunks)) })
    request.on("error", reject)
    request.on("aborted", () => reject(new ServiceError("invalid_argument", "Request interrupted")))
  })
}
export function createServiceHttp(options: ServiceOptions) {
  if (!options.token) throw new Error("Service access key is required")
  const secret = createHash("sha256").update(options.token).digest()
  const service = createSharedService(options.repository, { id: randomUUID, now: () => new Date().toISOString() })
  const authenticate = (request: IncomingMessage) => {
    const value = request.headers.authorization
    if (!value?.startsWith("Bearer ") || !timingSafeEqual(secret, createHash("sha256").update(value.slice(7)).digest())) throw new ServiceError("unauthenticated", "A valid service access key is required")
  }
  const receiver = options.uploads ? createDocumentReceiver(options.repository, options.uploads, { id: randomUUID, now: () => new Date().toISOString(), hash: bytes => createHash("sha256").update(bytes).digest("hex") }) : null
  const streams = new Set<() => void>()
  const handler = async (request: IncomingMessage, response: ServerResponse) => {
    const requestId = randomUUID()
    response.setHeader("X-Request-Id", requestId); response.setHeader("Cache-Control", "no-store"); response.setHeader("X-Content-Type-Options", "nosniff")
    const send = (status: number, data: unknown, nextCursor?: string | null) => {
      response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" })
      response.end(JSON.stringify({ data, meta: { requestId, ...(nextCursor !== undefined ? { page: { nextCursor } } : {}) } }))
    }
    const json = async () => {
      if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) throw new ServiceError("invalid_argument", "Expected application/json")
      try {
        const value = JSON.parse((await readBody(request, options.maxJsonBytes ?? 1024 * 1024)).toString("utf8"))
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error()
        return value
      }
      catch (error) { if (error instanceof ServiceError) throw error; throw new ServiceError("invalid_argument", "Invalid JSON body") }
    }
    const version = () => parsePrecondition({ match: request.headers["if-match"] as string | undefined, noneMatch: request.headers["if-none-match"] as string | undefined })
    try {
      const url = new URL(request.url ?? "/", "http://service"), method = request.method ?? "GET"
      if (method === "GET" && url.pathname === "/api/v1/health") return send(200, { apiVersion: API_VERSION, authentication: options.authentication ? "accounts" : "service-key", accountLogin: !!options.authentication, capabilities: { uploads: !!receiver, events: true, localBridge: false } })
      if (!url.pathname.startsWith("/api/") && method === "GET" && options.webRoot && await serveWeb(options.webRoot, url.pathname, response)) return
      if (!url.pathname.startsWith("/api/v1/")) throw new ServiceError("not_found", "Route not found")
      const origin = request.headers.origin
      if (origin && origin !== `http://${request.headers.host}` && origin !== `https://${request.headers.host}`) throw new ServiceError("forbidden", "Cross-origin access is not enabled")
      if (!["GET", "HEAD"].includes(method) && request.headers.cookie && request.headers["x-kw-csrf"] !== "1") throw new ServiceError("forbidden", "A same-origin mutation header is required")
      if (options.authentication && await options.authentication.handle(request, response, url.pathname, json, send)) return
      const identity: SessionIdentity | undefined = options.authentication ? await options.authentication.authenticate(request) : undefined
      if (!options.authentication) authenticate(request)
      if (url.pathname === "/api/v1/projects") {
        if (method === "GET" && identity?.principal.scope) return send(200, [await service.project(identity.principal.scope.projectId)], null)
        if (method === "POST" && identity?.principal.scope) throw new ServiceError("forbidden", "Agent Tokens cannot create projects")
        if (method === "GET") { const page = await service.projects(url.searchParams.get("limit"), url.searchParams.get("cursor")); return send(200, page.items, page.nextCursor) }
        if (method === "POST") return send(201, await service.createProject((await json()).name))
      }
      const route = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)(?:\/(.*))?$/)
      if (!route) throw new ServiceError("not_found", "Route not found")
      let id: string
      try { id = decodeURIComponent(route[1]) } catch { throw new ServiceError("invalid_argument", "Invalid project identifier") }
      const part = route[2]
      if (identity?.principal.scope && options.authentication) {
        const scope = identity.principal.scope
        const permissions: ProjectPermission[] = !part ? ["project.read"] : part.startsWith("wiki") ? [method === "GET" ? "wiki.read" : "wiki.write"] : part.startsWith("documents") ? [method === "GET" ? "documents.read" : "documents.write"] : part === "workspace" ? method === "GET" ? ["memory.read"] : ["memory.write", "domains.manage"] : part.startsWith("events") ? ["wiki.read", "documents.read", "memory.read"] : ["project.read"]
        const catalog = (await options.authentication.catalog.read()).catalog
        if (scope.projectId !== id || permissions.some(permission => !scope.permissions.includes(permission) || !evaluateProjectPermission(catalog, { accountId: identity.account.id, projectId: id, permission, workRoleId: scope.workRoleId ?? undefined }).allowed)) throw new ServiceError("forbidden", "Operation exceeds Agent Token scope")
      }
      if (!part && method === "GET") return send(200, await service.project(id))
      if ((part === "wiki" || part === "documents") && method === "GET") {
        const page = await service.list(id, part === "wiki" ? "wiki" : "document", url.searchParams.get("limit"), url.searchParams.get("cursor"))
        return send(200, page.items, page.nextCursor)
      }
      if (part === "documents" && method === "POST") {
        await service.project(id)
        if (!receiver) throw new ServiceError("unsupported", "Uploads are not configured")
        let name: string
        try { name = decodeURIComponent(String(request.headers["x-file-name"] ?? "")) } catch { throw new ServiceError("invalid_argument", "Invalid filename encoding") }
        const bytes = await readBody(request, options.maxUploadBytes ?? 16 * 1024 * 1024)
        return send(201, await receiver.receive(id, name, String(request.headers["content-type"] ?? "application/octet-stream").split(";")[0], bytes))
      }
      const document = part?.match(/^documents\/([^/]+)\/content$/)
      if (document && method === "GET") {
        await service.project(id)
        if (!receiver) throw new ServiceError("unsupported", "Uploads are not configured")
        const bytes = await receiver.content(id, decodeURIComponent(document[1]))
        response.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Disposition": "attachment; filename=source.bin" }); response.end(bytes); return
      }
      if (part === "events/stream" && method === "GET") {
        const after = Number(url.searchParams.get("after") ?? request.headers["last-event-id"] ?? 0)
        await service.events(id, after, 1)
        let close: () => void = () => {}
        close = streamProjectEvents(response, after, cursor => service.events(id, cursor, 200), () => streams.delete(close))
        streams.add(close); return
      }
      if (part === "wiki/page") {
        const path = url.searchParams.get("path") ?? ""
        if (method === "GET") { const value = await service.readWiki(id, path); response.setHeader("ETag", etag(value.revision)); return send(200, value) }
        if (method === "PUT") { const expected = version(), body = await json(); const value = await service.saveWiki(id, path, body?.content, expected); response.setHeader("ETag", etag(value.revision)); return send(200, value) }
        if (method === "DELETE") { await service.removeWiki(id, path, version()); return send(200, null) }
      }
      if (part === "workspace") {
        if (method === "GET") { const value = await service.readWorkspace(id); response.setHeader("ETag", etag(value.revision)); return send(200, value) }
        if (method === "PUT") { const expected = version(), value = await service.saveWorkspace(id, await json(), expected); response.setHeader("ETag", etag(value.revision)); return send(200, value) }
      }
      if (part === "events" && method === "GET") return send(200, await service.events(id, Number(url.searchParams.get("after") ?? 0), Number(url.searchParams.get("limit") ?? 100)))
      throw new ServiceError("not_found", "Route not found")
    } catch (error) {
      const failure = error instanceof ServiceError ? error : error instanceof AuthError ? new ServiceError(error.code, error.message) : error instanceof IdentityError ? new ServiceError(error.code === "last_admin" ? "conflict" : error.code, error.message) : new ServiceError("internal", "Service request failed")
      response.writeHead(ERROR_STATUS[failure.code], { "Content-Type": "application/json; charset=utf-8" })
      response.end(JSON.stringify({ error: { code: failure.code, message: failure.message, requestId, ...(failure.details ? { details: failure.details } : {}) } }))
    }
  }
  return { closeStreams: () => { for (const close of [...streams]) close() }, server: createServer((request, response) => { void handler(request, response) }), service, authenticate }
}
