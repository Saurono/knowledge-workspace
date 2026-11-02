import { auditAction } from "./audit"
import { serveWeb } from "./static"
import { streamProjectEvents } from "./events"
import { createServer } from "node:http"
import type { IncomingMessage, ServerResponse } from "node:http"
import { randomUUID, createHash } from "node:crypto"
import { createSharedService, createDocumentReceiver, createAuthorizedRepository, createAuthorizedUploadRegistry, type UploadStorage, type UploadRegistry } from "@/modules/service-api/application"
import { ServiceError, ERROR_STATUS, parsePrecondition, etag, API_VERSION } from "@/modules/service-api/domain"
import type { SqliteRepository } from "./repository"
import { resourceTool, keywordSearch, executionPermission } from "./resource-tools"
import type { ExecutionGateway } from "./resource-tools"
import { AuthError, IdentityError, globalPermissions, requireContextPermission } from "@/modules/identity/domain"
import type { ProjectPermission, SessionIdentity, AccessContext } from "@/modules/identity/domain"
import type { AccountAuthentication } from "./auth-http"
import { createDocumentCheckpointRepository } from "./ingestion-checkpoints"
import { summarizeIngestion } from "@/modules/ingestion/domain"
export interface ServiceOptions { repository: SqliteRepository; authentication: AccountAuthentication; executions?: ExecutionGateway; maxJsonBytes?: number; uploads?: UploadStorage; uploadRegistry?: UploadRegistry; maxUploadBytes?: number; webRoot?: string }
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
  if (!options.authentication) throw new Error("Account authentication is required")
  const uploadsEnabled = !!options.uploads
  const streams = new Set<() => void>()
  const handler = async (request: IncomingMessage, response: ServerResponse) => {
    const requestId = randomUUID()
    let auditIdentity: SessionIdentity | undefined, auditContext: AccessContext | undefined, auditSequence: number | undefined, auditProject: string | null = null
    const observe = (identity: SessionIdentity, context?: AccessContext) => { auditIdentity = identity; if (context) { auditContext = context; auditProject = context.projectId } }
    let recorded = false
    const record = () => {
      if (recorded || auditSequence === undefined) return
      recorded = true
      try { options.repository.audit.finish(auditSequence, { actorId: auditIdentity?.account.id ?? null, effectiveAccountId: auditContext?.effectiveAccountId ?? auditIdentity?.account.id ?? null, projectId: auditProject, workRoleId: auditContext?.workRoleId ?? null, contextId: auditContext?.id ?? null, credentialId: auditIdentity?.principal.credentialId || null, status: response.writableFinished ? response.statusCode : null, result: !response.writableFinished ? "failed" : [401, 403].includes(response.statusCode) ? "denied" : response.statusCode < 400 ? "allowed" : "failed" }) }
      catch { console.error("Audit completion failed; request start retained") }
    }
    response.once("finish", record); response.once("close", record)
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
      if (method === "GET" && url.pathname === "/api/v1/health") return send(200, { apiVersion: API_VERSION, authentication: "accounts", accountLogin: true, capabilities: { uploads: uploadsEnabled, events: true, localBridge: false } })
      if (!url.pathname.startsWith("/api/") && method === "GET" && options.webRoot && await serveWeb(options.webRoot, url.pathname, response)) return
      if (!url.pathname.startsWith("/api/v1/")) throw new ServiceError("not_found", "Route not found")
      auditSequence = options.repository.audit.start({ requestId, recordedAt: options.authentication.now(), action: auditAction(method, url.pathname), result: "pending", status: null, actorId: null, effectiveAccountId: null, projectId: null, workRoleId: null, contextId: null, credentialId: null })
      const projectHint = url.pathname.match(/^\/api\/v1\/projects\/([A-Za-z0-9_-]{1,128})(?:\/|$)/)?.[1]
      if (projectHint && await options.repository.project(projectHint)) auditProject = projectHint
      try { if (request.headers.cookie || request.headers.authorization) observe(await options.authentication.authenticate(request)) } catch { /* Record invalid attempts without trusting an identity. */ }
      const origin = request.headers.origin
      if (origin && origin !== `http://${request.headers.host}` && origin !== `https://${request.headers.host}`) throw new ServiceError("forbidden", "Cross-origin access is not enabled")
      if (!["GET", "HEAD"].includes(method) && request.headers.cookie && request.headers["x-kw-csrf"] !== "1") throw new ServiceError("forbidden", "A same-origin mutation header is required")
      if (await options.authentication.handle(request, response, url.pathname, json, send, observe)) return
      const identity = await options.authentication.authenticate(request), principal = identity.principal
      observe(identity)
      const selectedContext = url.pathname === "/api/v1/projects" ? undefined : request.headers["x-kw-context"] as string | undefined
      const access = async (project: string) => { await options.authentication.validatePrincipal(principal); const context = await options.authentication.contexts.resolve(principal, project, selectedContext); if (url.pathname !== "/api/v1/projects") observe(identity, context); return context }
      const guarded = createAuthorizedRepository(options.repository, access, id => options.repository.memoryGrants.list(id), options.authentication.now)
      const service = createSharedService(guarded, { id: randomUUID, now: options.authentication.now })
      const uploadRegistry = createAuthorizedUploadRegistry(options.uploadRegistry ?? options.repository, access)
      const receiver = options.uploads ? createDocumentReceiver(guarded, options.uploads, { id: randomUUID, now: options.authentication.now, hash: bytes => createHash("sha256").update(bytes).digest("hex") }, uploadRegistry) : null
      const checkpoints = createDocumentCheckpointRepository(guarded, options.authentication.now)
      if (url.pathname === "/api/v1/projects") {
        if (method === "GET") { const page = await service.projects(url.searchParams.get("limit"), url.searchParams.get("cursor")); return send(200, page.items, page.nextCursor) }
        if (method === "POST") {
          if (!globalPermissions(identity.account).includes("projects.create")) throw new ServiceError("forbidden", "Project creation is not authorized")
          const ownerService = createSharedService({ ...guarded, createProject: (project, initial) => options.repository.createProject(project, initial, identity.account.id) }, { id: randomUUID, now: options.authentication.now })
          const project = await ownerService.createProject((await json()).name); auditProject = project.id; return send(201, project)
        }
      }
      const route = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)(?:\/(.*))?$/)
      if (!route) throw new ServiceError("not_found", "Route not found")
      let id: string
      try { id = decodeURIComponent(route[1]) } catch { throw new ServiceError("invalid_argument", "Invalid project identifier") }
      const part = route[2]
      const context = await access(id)
      if (!part) requireContextPermission(context, "project.read")
      if (part?.startsWith("wiki")) requireContextPermission(context, method === "GET" ? "wiki.read" : "wiki.write")
      if (part?.startsWith("documents")) requireContextPermission(context, method === "GET" ? "documents.read" : "documents.write")
      const ingestion = part?.match(/^documents\/([^/]+)\/ingestion$/)
      if (ingestion && method === "GET") {
        let documentId: string
        try { documentId = decodeURIComponent(ingestion[1]) } catch { throw new ServiceError("invalid_argument", "Invalid document identifier") }
        const value = await checkpoints.read(id, documentId)
        if (!value) throw new ServiceError("not_found", "Document not found")
        response.setHeader("ETag", etag(value.revision))
        return send(200, { ...value, summary: summarizeIngestion(value.checkpoint) })
      }
      if (part === "memories" && method === "GET") { requireContextPermission(context, "memory.read"); return send(200, (await service.readWorkspace(id)).data) }
      if ((part === "retrieval" || part === "search") && method === "POST") { requireContextPermission(context, "wiki.read"); return send(200, await keywordSearch(guarded, id, await json())) }
      let executionInput: Record<string, unknown> | undefined
      if ((part === "mcp" || part === "cli") && method === "POST") {
        const body = await json()
        if (body.tool === "search") { requireContextPermission(context, "wiki.read"); return send(200, await keywordSearch(guarded, id, body)) }
        if (body.tool === "memory.list") requireContextPermission(context, "memory.read")
        if (typeof body.tool === "string") return send(200, await resourceTool(service, id, body.tool, body))
        if (part === "mcp") throw new ServiceError("invalid_argument", "Choose a supported resource tool")
        executionInput = body
      }
      if ((part === "tasks" || part?.startsWith("tasks/") || part === "cli") && ["GET", "POST"].includes(method)) {
        const kind = part === "cli" ? "cli" : "tasks"
        executionPermission(kind, context)
        if (!options.executions) throw new ServiceError("unsupported", "A shared execution backend is not configured")
        // Persist a context even when the caller used the default identity; later switches cannot change this execution.
        const input = executionInput ?? (method === "GET" ? {} : await json())
        const captured = selectedContext ? context : await options.authentication.contexts.switch(principal, id, {})
        executionPermission(kind, captured)
        const check = async (permission: ProjectPermission) => { await options.authentication.validatePrincipal(principal); const current = await options.authentication.contexts.resolve(principal, id, captured.id); requireContextPermission(current, permission); return current }
        const resources = createAuthorizedRepository(options.repository, async () => { await options.authentication.validatePrincipal(principal); return options.authentication.contexts.resolve(principal, id, captured.id) }, project => options.repository.memoryGrants.list(project), options.authentication.now)
        await check(kind === "tasks" ? "tasks.manage" : "agent.run")
        const result = await options.executions.execute(kind, part!, input, { context: captured, check, resources })
        await check(kind === "tasks" ? "tasks.manage" : "agent.run")
        return send(200, result)
      }
      if (part === "access" && method === "GET") return send(200, context)
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
        const idempotencyKey = request.headers["idempotency-key"]
        const sourceIdHeader = request.headers["x-source-id"]
        const createSource = request.headers["x-create-source"] === "1"
        if ((idempotencyKey !== undefined && typeof idempotencyKey !== "string") || (sourceIdHeader !== undefined && typeof sourceIdHeader !== "string") || (sourceIdHeader !== undefined && typeof idempotencyKey !== "string") || (createSource && typeof idempotencyKey !== "string"))
          throw new ServiceError("invalid_argument", "Invalid upload idempotency or source identity headers")
        return send(201, await receiver.receive(id, name, String(request.headers["content-type"] ?? "application/octet-stream").split(";")[0], bytes, {
          ...(typeof idempotencyKey === "string" ? { idempotencyKey } : {}),
          ...(typeof sourceIdHeader === "string" ? { sourceId: sourceIdHeader } : {}),
          createSource,
        }))
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
        if (method === "PUT" && !context.permissions.includes("memory.write") && !context.permissions.includes("domains.manage")) throw new ServiceError("forbidden", "Workspace write permission required")
        if (method === "GET") { const value = await service.readWorkspace(id); response.setHeader("ETag", etag(value.revision)); return send(200, value) }
        if (method === "PUT") { const expected = version(), value = await service.saveWorkspace(id, await json(), expected); response.setHeader("ETag", etag(value.revision)); return send(200, value) }
      }
      if (part === "events" && method === "GET") return send(200, await service.events(id, Number(url.searchParams.get("after") ?? 0), Number(url.searchParams.get("limit") ?? 100)))
      throw new ServiceError("not_found", "Route not found")
    } catch (error) {
      if (response.headersSent) { response.end(); return }
      const failure = error instanceof ServiceError ? error : error instanceof AuthError ? new ServiceError(error.code, error.message) : error instanceof IdentityError ? new ServiceError(error.code === "last_admin" ? "conflict" : error.code, error.message) : new ServiceError("internal", "Service request failed")
      response.writeHead(ERROR_STATUS[failure.code], { "Content-Type": "application/json; charset=utf-8" })
      response.end(JSON.stringify({ error: { code: failure.code, message: failure.message, requestId, ...(failure.details ? { details: failure.details } : {}) } }))
    }
  }
  return { closeStreams: () => { for (const close of [...streams]) close() }, server: createServer((request, response) => { void handler(request, response) }) }
}
