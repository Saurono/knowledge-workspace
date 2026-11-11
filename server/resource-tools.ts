import { ServiceError } from "@/modules/service-api/domain"
import type { SubmitProposalInput } from "@/modules/service-api/domain"
import { requireContextPermission } from "@/modules/identity/domain"
import type { AccessContext, ProjectPermission } from "@/modules/identity/domain"
import { createSharedService, domainFilterFromInput } from "@/modules/service-api/application"
import type { SharedRepository, SharedWorkspace } from "@/modules/service-api/application"
export interface ExecutionAccess { readonly context: AccessContext; check(permission: ProjectPermission): Promise<AccessContext>; readonly resources: SharedRepository }
export interface ExecutionGateway { execute(kind: "tasks" | "cli", action: string, input: Record<string, unknown>, access: ExecutionAccess): Promise<unknown> }
/** Allowlisted resource tools shared by remote CLI and MCP; never interprets a shell command. */
export async function resourceTool(service: ReturnType<typeof createSharedService>, project: string, tool: unknown, input: Record<string, unknown>, access: Pick<ExecutionAccess, "context">) {
  if (tool === "wiki.list") return service.list(project, "wiki", input.limit as string, input.cursor as string, domainFilterFromInput(input.domainFilter))
  if (tool === "wiki.read") return service.readWiki(project, String(input.path ?? ""))
  if (tool === "wiki.write") {
    requireContextPermission(access.context, "wiki.write")
    if (input.expectedRevision !== null && (!Number.isSafeInteger(input.expectedRevision) || Number(input.expectedRevision) < 1)) throw new ServiceError("precondition_required", "Supply expectedRevision or null for creation")
    if (Object.keys(input).some(key => !["tool", "path", "content", "expectedRevision"].includes(key))) throw new ServiceError("invalid_argument", "Unexpected field")
    const context = access.context
    return service.saveWiki(project, String(input.path ?? ""), { content: input.content }, input.expectedRevision as number | null, { kind: context.actorKind, id: context.actorId, entrypoint: context.entrypoint })
  }
  if (tool === "documents.list") return service.list(project, "document", input.limit as string, input.cursor as string, domainFilterFromInput(input.domainFilter))
  if (tool === "memory.list") return (await service.readWorkspace(project)).data as SharedWorkspace
  if (tool === "memory.summaries") { requireContextPermission(access.context, "memory.read"); return service.readMemorySummaries(project, input.limit as string, input.cursor as string) }
  if (tool === "memory.graph") { requireContextPermission(access.context, "memory.read"); return service.readMemoryGraph(project, input.limit as string) }
  if (tool === "proposal.submit") {
    requireContextPermission(access.context, "wiki.write")
    if (Object.keys(input).some(key => !["tool", "target", "idempotencyKey", "evidence"].includes(key))) throw new ServiceError("invalid_argument", "Unexpected field")
    return service.submitProposal(project, { target: input.target, idempotencyKey: input.idempotencyKey, evidence: input.evidence } as SubmitProposalInput, actorFromContext(access.context))
  }
  if (tool === "proposal.list") {
    requireContextPermission(access.context, "wiki.read")
    return service.proposals(project)
  }
  throw new ServiceError("unsupported", "Resource tool is not supported")
}
function actorFromContext(context: AccessContext) {
  return { kind: context.actorKind === "admin" ? "user" as const : context.actorKind, id: context.actorId, entrypoint: context.entrypoint }
}
export async function keywordSearch(service: ReturnType<typeof createSharedService>, project: string, input: Record<string, unknown>) {
  if (typeof input.query !== "string" || !input.query.trim() || input.query.length > 2000) throw new ServiceError("invalid_argument", "A search query of 1–2000 characters is required")
  const topK = input.topK === undefined ? 20 : Number(input.topK)
  if (!Number.isInteger(topK) || topK < 1 || topK > 100) throw new ServiceError("invalid_argument", "topK must be 1–100")
  let domainFilter: string[] | undefined
  const filter = domainFilterFromInput(input.domainFilter)
  if (filter) {
    domainFilter = []
    let cursor: string | null = null
    for (;;) {
    const page = await service.list(project, "wiki", "200", cursor, filter)
    domainFilter.push(...page.items.map(item => item.key))
    if (!page.nextCursor) break
    cursor = page.nextCursor
    }
    if (!domainFilter.length) return { mode: "keyword", results: [], tokenHits: 0, vectorHits: 0 }
  }
  const found = await service.searchWiki(project, { query: input.query, limit: topK, domainFilter })
  return { mode: "keyword", results: found.map(row => ({ ...row, projectId: project, images: [] })), tokenHits: found.length, vectorHits: 0 }
}
export function executionPermission(kind: "tasks" | "cli", context: AccessContext) { requireContextPermission(context, kind === "tasks" ? "tasks.manage" : "agent.run") }
