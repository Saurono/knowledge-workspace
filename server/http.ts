import { auditAction } from "./audit"
import { removeDocumentCascade } from "./document-lifecycle"
import { scanOrphanUploads, removeOrphanUploads, createProjectDocumentSourceLister } from "./orphan-uploads"
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
import { projectPhaseReceipt } from "@/modules/obsidian/application"
import { domainFilterFromQuery, recallForContext, createExportBundle, validateExportBundle, planImport, validateSharedWorkspace } from "@/modules/service-api/application"
import type { SharedWorkspace } from "@/modules/service-api/application"
import type { SubmitProposalInput } from "@/modules/service-api/domain"
export interface ServiceOptions { repository: SqliteRepository; authentication: AccountAuthentication; executions?: ExecutionGateway; maxJsonBytes?: number; uploads?: UploadStorage; uploadRegistry?: UploadRegistry; maxUploadBytes?: number; webRoot?: string; dataRoot?: string }
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
      if (part === "orphans" && (method === "GET" || method === "DELETE")) {
        requireContextPermission(context, "documents.write")
        if (method === "DELETE" && url.searchParams.get("confirm") !== "1") throw new ServiceError("invalid_argument", "Deleting orphan uploads requires confirm=1")
        if (!options.dataRoot) throw new ServiceError("unsupported", "Orphan upload maintenance requires a data root")
        const scan = await scanOrphanUploads({ root: options.dataRoot, listDocumentSourceIds: createProjectDocumentSourceLister(options.repository) })
        const orphans = scan.orphans.filter(orphan => orphan.projectId === id)
        if (method === "GET") return send(200, { orphans, totalBytes: orphans.reduce((total, orphan) => total + orphan.bytes, 0), scannedUploads: scan.scannedUploads })
        const result = await removeOrphanUploads({ root: options.dataRoot, orphans })
        return send(200, { requested: orphans.length, removed: result.removed, failed: result.failed.map(({ projectId, sourceId }) => ({ projectId, sourceId, reason: "Failed to remove orphan upload" })) })
      }
      const actor = { kind: context.actorKind === "admin" ? "user" as const : context.actorKind, id: context.actorId, entrypoint: context.entrypoint }
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
      const receiptRoute = part?.match(/^documents\/([^/]+)\/receipt$/)
      if (receiptRoute && method === "GET") {
        let documentId: string
        try { documentId = decodeURIComponent(receiptRoute[1]) } catch { throw new ServiceError("invalid_argument", "Invalid document identifier") }
        const record = await guarded.get(id, "document", documentId)
        if (!record) throw new ServiceError("not_found", "Document not found")
        const data = record.data as Record<string, unknown>
        const checkpoint = (await checkpoints.read(id, documentId))?.checkpoint
        const sourceId = data.sourceId, revision = data.sourceRevision ?? data.sha256
        if (!checkpoint || typeof sourceId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(sourceId) || typeof revision !== "string" || !/^[a-f0-9]{64}$/.test(revision))
          throw new ServiceError("invalid_argument", "Document receipt metadata is unavailable or damaged")
        const projected = projectPhaseReceipt({
          id: "", sourceId, sourceRevision: revision, runId: `resource-${documentId}`,
          revisionKind: "raw-bytes-sha256",
          checkpoint, times: { receivedAt: checkpoint.stages.receive.finishedAt, sourceIngestedAt: null, revisionIngestedAt: null },
          outputVersions: [], indexCommitRefs: [],
        })
        response.setHeader("ETag", etag(record.revision))
        return send(200, projected)
      }
      if (part === "memories" && method === "GET") { requireContextPermission(context, "memory.read"); return send(200, (await service.readWorkspace(id)).data) }
      if (part === "memories" && method === "POST") {
        requireContextPermission(context, "memory.write")
        const body = await json()
        if (typeof body.memoryId !== "string" || !body.memoryId || !Object.prototype.hasOwnProperty.call(body, "expectedVersion")) throw new ServiceError("invalid_argument", "Invalid memory write")
        return send(200, await service.writeMemory(id, body.memoryId, body.input as Record<string, unknown>, { expectedVersion: body.expectedVersion as number | null, idempotencyKey: body.idempotencyKey as string | undefined }, actor))
      }
      if (part === "memories/expire" && method === "POST") { requireContextPermission(context, "memory.write"); return send(200, await service.expireMemories(id, options.authentication.now())) }
      if (part === "memories/summaries" && method === "GET") { requireContextPermission(context, "memory.read"); return send(200, await service.readMemorySummaries(id, url.searchParams.get("limit"), url.searchParams.get("cursor"))) }
      if (part === "memories/graph" && method === "GET") { requireContextPermission(context, "memory.read"); return send(200, await service.readMemoryGraph(id, url.searchParams.get("limit"))) }
      if (part === "memories/search" && method === "POST") {
        requireContextPermission(context, "memory.read")
        const body = await json(), limit = body.limit ?? 20
        if (typeof body.query !== "string" || !body.query.trim() || body.query.length > 2000 || !Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 100) throw new ServiceError("invalid_argument", "Invalid memory search")
        const workspace = (await service.readWorkspace(id)).data as SharedWorkspace
        const visible = new Set(workspace.memories.filter(memory => memory.status === "active" && (!memory.validity?.until || Date.parse(memory.validity.until) > Date.parse(options.authentication.now()))).map(memory => memory.id))
        const results = (await options.repository.searchMemories({ projectId: id, query: body.query, limit: limit as number })).filter(row => visible.has(row.memoryId))
        return send(200, { results, returned: results.length })
      }
      if (part === "memories/recall" && method === "POST") {
        requireContextPermission(context, "memory.read")
        const body = await json(), limit = body.limit ?? 5, maxChars = body.maxChars ?? 4000
        if (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 50 || !Number.isInteger(maxChars) || Number(maxChars) < 100 || Number(maxChars) > 20000 || (body.taskId !== undefined && typeof body.taskId !== "string")) throw new ServiceError("invalid_argument", "Invalid recall parameters")
        const result = recallForContext((await service.readWorkspace(id)).data as SharedWorkspace, context, await options.repository.memoryGrants.list(id), { limit: limit as number, maxChars: maxChars as number, taskId: body.taskId as string | undefined, now: options.authentication.now() })
        return send(200, { ...result, recall: { ...result.recall, hits: result.recall.hits.map(({ memory, score, reason }) => ({ memoryId: memory.id, version: memory.version, score, reason })) } })
      }
      const memoryRoute = part?.match(/^memories\/([^/]+)(?:\/(promote|archive|supersede|resolve))?$/)
      if (memoryRoute && method === "GET" && !memoryRoute[2]) {
        requireContextPermission(context, "memory.read")
        const workspace = await service.readWorkspace(id), memory = (workspace.data as SharedWorkspace).memories.find(item => item.id === decodeURIComponent(memoryRoute[1]))
        if (!memory) throw new ServiceError("not_found", "Memory not found")
        return send(200, { memory, revision: workspace.revision })
      }
      if (memoryRoute?.[2] && method === "POST") {
        requireContextPermission(context, "memory.write")
        const memoryId = decodeURIComponent(memoryRoute[1])
        if (memoryRoute[2] === "promote") return send(200, await service.promoteMemory(id, memoryId, actor))
        if (memoryRoute[2] === "archive") return send(200, await service.archiveMemory(id, memoryId, actor))
        const body = await json()
        if (memoryRoute[2] === "supersede") {
          if (typeof body.newId !== "string" || !body.newId) throw new ServiceError("invalid_argument", "Invalid replacement memory")
          return send(200, await service.supersedeMemory(id, memoryId, body.newId, actor))
        }
        if (typeof body.withId !== "string" || !body.withId || !["a-canonical", "both-intentional", "merged"].includes(body.decision as string) || (body.note !== undefined && typeof body.note !== "string")) throw new ServiceError("invalid_argument", "Invalid conflict resolution")
        return send(200, await service.resolveConflict(id, memoryId, body.withId, body.decision as "a-canonical" | "both-intentional" | "merged", actor, body.note as string | undefined))
      }
      if ((part === "retrieval" || part === "search") && method === "POST") { requireContextPermission(context, "wiki.read"); return send(200, await keywordSearch(service, id, await json())) }
      let executionInput: Record<string, unknown> | undefined
      if ((part === "mcp" || part === "cli") && method === "POST") {
        const body = await json()
        if (body.tool === "search") { requireContextPermission(context, "wiki.read"); return send(200, await keywordSearch(service, id, body)) }
        if (body.tool === "memory.list") requireContextPermission(context, "memory.read")
        if (typeof body.tool === "string") return send(200, await resourceTool(service, id, body.tool, body, { context }))
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
      if (part === "proposals" && method === "GET") { requireContextPermission(context, "wiki.read"); return send(200, await service.proposals(id)) }
      if (part === "proposals" && method === "POST") {
        requireContextPermission(context, "wiki.write")
        const result = await service.submitProposal(id, await json() as unknown as SubmitProposalInput, actor)
        return send(result.created ? 201 : 200, result)
      }
      if (part === "proposals/approve-batch" && method === "POST") {
        requireContextPermission(context, "wiki.write")
        const body = await json()
        if ((body.ids !== undefined && (!Array.isArray(body.ids) || body.ids.some((value: unknown) => typeof value !== "string" || !value.trim()))) || (body.kind !== undefined && body.kind !== "wiki" && body.kind !== "memory") || (body.dryRun !== undefined && typeof body.dryRun !== "boolean")) throw new ServiceError("invalid_argument", "Invalid batch approval")
        return send(200, await service.approveProposals(id, body as { ids?: string[]; kind?: "wiki" | "memory"; dryRun?: boolean }, { ...actor, via: "manual" }))
      }
      const proposalRoute = part?.match(/^proposals\/([^/]+)\/(approve|reject)$/)
      if (proposalRoute && method === "POST") {
        requireContextPermission(context, "wiki.write")
        const proposalId = decodeURIComponent(proposalRoute[1]), decisionActor = { ...actor, via: "manual" as const }
        if (proposalRoute[2] === "approve") return send(200, await service.approveProposal(id, proposalId, decisionActor))
        const body = await json()
        if (typeof body.reason !== "string" || !body.reason.trim()) throw new ServiceError("invalid_argument", "A rejection reason is required")
        return send(200, await service.rejectProposal(id, proposalId, decisionActor, body.reason))
      }
      if (part === "export" && method === "GET") {
        requireContextPermission(context, "project.read")
        const wiki: Array<{ path: string; content: string }> = [], documents: Array<{ sourceId: string; name: string; size: number; mediaType?: string; byteRevision?: string }> = []
        for (const kind of ["wiki", "document"] as const) {
          if (!context.permissions.includes(kind === "wiki" ? "wiki.read" : "documents.read")) continue
          let cursor: string | null = null
          do {
            const page = await service.list(id, kind, "200", cursor)
            for (const record of page.items) {
              const data = record.data as Record<string, unknown>
              if (kind === "wiki") wiki.push({ path: record.key, content: data.content as string })
              else documents.push({ sourceId: data.sourceId as string, name: data.name as string, size: data.size as number, ...(typeof data.mediaType === "string" ? { mediaType: data.mediaType } : {}), ...(typeof data.byteRevision === "string" ? { byteRevision: data.byteRevision } : {}) })
            }
            cursor = page.nextCursor
          } while (cursor)
        }
        const bundle = createExportBundle({ projectName: (await service.project(id)).name, exportedAt: options.authentication.now(), workspace: (await service.readWorkspace(id)).data as SharedWorkspace, wiki, documents })
        response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" }); response.end(JSON.stringify(bundle)); return
      }
      if (part === "import" && method === "POST") {
        requireContextPermission(context, "project.read")
        const dryRun = url.searchParams.get("dryRun") === "1"
        if (!dryRun && !context.permissions.includes("memory.write") && !context.permissions.includes("domains.manage")) throw new ServiceError("forbidden", "Workspace write permission required")
        const applied = { memories: 0, domains: 0, wikiCreated: 0, wikiUpdated: 0 }
        try {
          const input = await json()
          let bundle: ReturnType<typeof validateExportBundle>
          try { bundle = validateExportBundle(input) }
          catch (error) {
            if (error instanceof Error && error.message === "Workspace contains unknown references") {
              const workspace = input.workspace as SharedWorkspace
              const domains = new Set(workspace.domains.map(item => item.id)), memories = new Set(workspace.memories.map(item => item.id))
              const missing = workspace.memories.flatMap(item => [...item.domainIds.filter(id => !domains.has(id)), ...item.relatedIds.filter(id => !memories.has(id))])
              throw new ServiceError("invalid_argument", `Workspace contains unknown references: ${missing.join(", ")}`)
            }
            throw new ServiceError("invalid_argument", error instanceof Error ? error.message : "Invalid export bundle")
          }
          const wikiPaths: string[] = [], documentSourceIds: string[] = []
          for (const kind of ["wiki", "document"] as const) {
            let cursor: string | null = null
            for (let pageNumber = 0; pageNumber < 50; pageNumber++) {
              const page = await service.list(id, kind, "200", cursor)
              for (const record of page.items) {
                if (kind === "wiki") wikiPaths.push(record.key)
                else documentSourceIds.push((record.data as { sourceId: string }).sourceId)
              }
              cursor = page.nextCursor
              if (!cursor) break
              if (pageNumber === 49) throw new ServiceError("too_large", "Import state exceeds 50 pages")
            }
          }
          const plan = planImport(bundle, { wikiPaths, documentSourceIds })
          if (dryRun) return send(200, { dryRun: true, plan })
          const current = await service.readWorkspace(id), workspace = current.data as SharedWorkspace
          const merged = { ...workspace,
            domains: [...new Map([...workspace.domains, ...bundle.workspace.domains].map(item => [item.id, item])).values()],
            memories: [...new Map([...workspace.memories, ...bundle.workspace.memories].map(item => [item.id, item])).values()],
          }
          const domainIds = new Set(merged.domains.map(item => item.id)), memoryIds = new Set(merged.memories.map(item => item.id))
          for (const memory of merged.memories) {
            for (const reference of memory.domainIds) if (!domainIds.has(reference)) throw new ServiceError("invalid_argument", `Unknown domain id: ${reference}`)
            for (const reference of memory.relatedIds) if (!memoryIds.has(reference)) throw new ServiceError("invalid_argument", `Unknown memory id: ${reference}`)
          }
          await service.saveWorkspace(id, validateSharedWorkspace(merged), current.revision)
          applied.memories = bundle.workspace.memories.length; applied.domains = bundle.workspace.domains.length
          const actor = { kind: context.actorKind, id: context.actorId, entrypoint: context.entrypoint }
          const contents = new Map(bundle.wiki.map(item => [item.path, item.content]))
          for (const path of plan.wiki.create) { await service.saveWiki(id, path, { content: contents.get(path)! }, null, actor); applied.wikiCreated++ }
          for (const path of plan.wiki.update) {
            const current = await service.readWiki(id, path)
            await service.saveWiki(id, path, { content: contents.get(path)! }, current.revision, actor); applied.wikiUpdated++
          }
          return send(200, { dryRun: false, applied, documents: { imported: 0, skippedReason: "document bytes are not part of the export bundle" }, plan })
        } catch (error) {
          const failure = error instanceof ServiceError ? error : error instanceof AuthError ? new ServiceError(error.code, error.message) : error instanceof IdentityError ? new ServiceError(error.code === "last_admin" ? "conflict" : error.code, error.message) : new ServiceError("internal", "Service request failed")
          throw new ServiceError(failure.code, failure.message, { ...failure.details, applied })
        }
      }
      if (!part && method === "GET") return send(200, await service.project(id))
      if ((part === "wiki" || part === "documents") && method === "GET") {
        const page = await service.list(id, part === "wiki" ? "wiki" : "document", url.searchParams.get("limit"), url.searchParams.get("cursor"), domainFilterFromQuery(url.searchParams))
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
      const documentDelete = part?.match(/^documents\/([^/]+)$/)
      if (documentDelete && method === "DELETE") {
        requireContextPermission(context, "documents.write")
        const expected = version()
        if (expected === null) throw new ServiceError("invalid_argument", "Deletion requires an existing revision")
        if (!options.uploads) throw new ServiceError("unsupported", "Document deletion requires uploads configuration")
        const key = decodeURIComponent(documentDelete[1])
        const result = await removeDocumentCascade({ repository: options.repository, uploads: options.uploads, projectId: id, key, expectedRevision: expected, now: options.authentication.now() })
        return send(200, result)
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
        if (method === "PUT") { const expected = version(), body = await json(); const value = await service.saveWiki(id, path, body, expected, { kind: context.actorKind, id: context.actorId, entrypoint: context.entrypoint }); response.setHeader("ETag", etag(value.revision)); return send(200, value) }
        if (method === "DELETE") { await service.removeWiki(id, path, version()); return send(200, null) }
      }
      if (part === "workspace") {
        if (method === "PUT" && !context.permissions.includes("memory.write") && !context.permissions.includes("domains.manage")) throw new ServiceError("forbidden", "Workspace write permission required")
        if (method === "GET") {
          const memories = url.searchParams.get("memories")
          if (url.searchParams.getAll("memories").length > 1 || (memories !== null && memories !== "none")) throw new ServiceError("invalid_argument", "Invalid memories projection")
          const value = await service.readWorkspace(id); response.setHeader("ETag", etag(value.revision)); return send(200, memories === "none" ? { ...value, data: { ...value.data as SharedWorkspace, memories: [] } } : value)
        }
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
