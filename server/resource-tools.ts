import { ServiceError } from "@/modules/service-api/domain"
import { requireContextPermission } from "@/modules/identity/domain"
import type { AccessContext, ProjectPermission } from "@/modules/identity/domain"
import { createSharedService, domainFilterFromInput } from "@/modules/service-api/application"
import type { SharedRepository, SharedWorkspace } from "@/modules/service-api/application"
import { tokenizeQuery } from "@/modules/retrieval/domain"
export interface ExecutionAccess { readonly context: AccessContext; check(permission: ProjectPermission): Promise<AccessContext>; readonly resources: SharedRepository }
export interface ExecutionGateway { execute(kind: "tasks" | "cli", action: string, input: Record<string, unknown>, access: ExecutionAccess): Promise<unknown> }
/** Allowlisted resource tools shared by remote CLI and MCP; never interprets a shell command. */
export async function resourceTool(service: ReturnType<typeof createSharedService>, project: string, tool: unknown, input: Record<string, unknown>) {
  if (tool === "wiki.list") return service.list(project, "wiki", input.limit as string, input.cursor as string, domainFilterFromInput(input.domainFilter))
  if (tool === "wiki.read") return service.readWiki(project, String(input.path ?? ""))
  if (tool === "wiki.write") {
    if (input.expectedRevision !== null && (!Number.isSafeInteger(input.expectedRevision) || Number(input.expectedRevision) < 1)) throw new ServiceError("precondition_required", "Supply expectedRevision or null for creation")
    return service.saveWiki(project, String(input.path ?? ""), input.content, input.expectedRevision as number | null)
  }
  if (tool === "documents.list") return service.list(project, "document", input.limit as string, input.cursor as string, domainFilterFromInput(input.domainFilter))
  if (tool === "memory.list") return (await service.readWorkspace(project)).data as SharedWorkspace
  throw new ServiceError("unsupported", "Resource tool is not supported")
}
export async function keywordSearch(service: ReturnType<typeof createSharedService>, project: string, input: Record<string, unknown>) {
  if (typeof input.query !== "string" || !input.query.trim() || input.query.length > 2000) throw new ServiceError("invalid_argument", "A search query of 1–2000 characters is required")
  const topK = input.topK === undefined ? 20 : Number(input.topK)
  if (!Number.isInteger(topK) || topK < 1 || topK > 100) throw new ServiceError("invalid_argument", "topK must be 1–100")
  const tokens = tokenizeQuery(input.query), found = []
  const filter = domainFilterFromInput(input.domainFilter)
  let cursor: string | null = null
  for (;;) {
    const page = await service.list(project, "wiki", "200", cursor, filter)
    const pages = page.items
    for (const page of pages) {
      const data = page.data as { content: string }, lower = data.content.toLowerCase(), score = tokens.filter(token => lower.includes(token)).length
      if (score) found.push({ path: page.key, title: page.key, snippet: data.content.slice(0, 300), score, ...(input.includeContent === true ? { content: data.content } : {}) })
    }
    if (!page.nextCursor) break
    cursor = page.nextCursor
  }
  return { mode: "keyword", results: found.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, topK) }
}
export function executionPermission(kind: "tasks" | "cli", context: AccessContext) { requireContextPermission(context, kind === "tasks" ? "tasks.manage" : "agent.run") }
