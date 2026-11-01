import { createServer } from "node:http"
import type { IncomingMessage, ServerResponse } from "node:http"
import { randomUUID, timingSafeEqual, createHash } from "node:crypto"
import { createSharedService } from "@/modules/service-api/application"
import { ServiceError, ERROR_STATUS, parsePrecondition, etag, API_VERSION } from "@/modules/service-api/domain"
import type { SharedRepository } from "@/modules/service-api/application"
export interface ServiceOptions { repository: SharedRepository; token: string; maxJsonBytes?: number }
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
      if (method === "GET" && url.pathname === "/api/v1/health") return send(200, { apiVersion: API_VERSION, authentication: "service-key", accountLogin: false })
      if (!url.pathname.startsWith("/api/v1/")) throw new ServiceError("not_found", "Route not found")
      authenticate(request)
      const origin = request.headers.origin
      if (origin && origin !== `http://${request.headers.host}` && origin !== `https://${request.headers.host}`) throw new ServiceError("forbidden", "Cross-origin access is not enabled")
      if (url.pathname === "/api/v1/projects") {
        if (method === "GET") { const page = await service.projects(url.searchParams.get("limit"), url.searchParams.get("cursor")); return send(200, page.items, page.nextCursor) }
        if (method === "POST") return send(201, await service.createProject((await json()).name))
      }
      const route = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)(?:\/(.*))?$/)
      if (!route) throw new ServiceError("not_found", "Route not found")
      let id: string
      try { id = decodeURIComponent(route[1]) } catch { throw new ServiceError("invalid_argument", "Invalid project identifier") }
      const part = route[2]
      if (!part && method === "GET") return send(200, await service.project(id))
      if ((part === "wiki" || part === "documents") && method === "GET") {
        const page = await service.list(id, part === "wiki" ? "wiki" : "document", url.searchParams.get("limit"), url.searchParams.get("cursor"))
        return send(200, page.items, page.nextCursor)
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
      const failure = error instanceof ServiceError ? error : new ServiceError("internal", "Service request failed")
      response.writeHead(ERROR_STATUS[failure.code], { "Content-Type": "application/json; charset=utf-8" })
      response.end(JSON.stringify({ error: { code: failure.code, message: failure.message, requestId, ...(failure.details ? { details: failure.details } : {}) } }))
    }
  }
  return { server: createServer((request, response) => { void handler(request, response) }), service, authenticate }
}
