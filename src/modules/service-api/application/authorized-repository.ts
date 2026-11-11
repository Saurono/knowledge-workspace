import { AuthError, requireContextPermission } from "@/modules/identity/domain"
import type { AccessContext, MemoryGrant, ProjectPermission } from "@/modules/identity/domain"
import type { SharedRepository } from "./ports"
import { validateSharedWorkspace } from "./workspace"
import type { SharedWorkspace } from "./workspace"
import { canAccessMemoryView, mergeAuthorizedWorkspace, visibleWorkspace, type MemoryAccessView } from "./workspace-authorization"
import type { MemorySummary, ProjectEvent } from "../domain"
import { canonicalDomainResourceKey } from "@/modules/domains/domain"
import { ServiceError } from "../domain"
/** All downstream adapters (uploads, retrieval, executors) receive this guarded port. */
export function createAuthorizedRepository(repository: SharedRepository, access: (project: string) => Promise<AccessContext>, grants: (project: string) => Promise<MemoryGrant[]>, now: () => string): SharedRepository {
  const scoped = async (project: string) => { const context = await access(project); if (context.projectId !== project) throw new AuthError("forbidden", "Execution cannot access another project"); return context }
  const check = async (project: string, permission: ProjectPermission) => { const context = await scoped(project); requireContextPermission(context, permission); return context }
  const eventVisible = (context: AccessContext, event: ProjectEvent) => event.resource.kind === "wiki" ? context.permissions.includes("wiki.read") : event.resource.kind === "document" ? context.permissions.includes("documents.read") : event.resource.kind === "workspace" ? context.permissions.includes("memory.read") || context.permissions.includes("domains.manage") : context.permissions.includes("project.read")
  const validateDomainTargets = async (project: string, current: SharedWorkspace, proposed: SharedWorkspace) => {
    for (const [key, ids] of Object.entries(proposed.resourceDomains)) {
      const hadPrior = Object.prototype.hasOwnProperty.call(current.resourceDomains, key)
      const priorIds = current.resourceDomains[key]
      if (hadPrior && JSON.stringify(priorIds) === JSON.stringify(ids)) continue
      // Clearing a previously stored assignment must remain possible when its
      // resource has since been deleted. Creating even an explicit [] entry is
      // a new reference and therefore requires a real target.
      if (hadPrior && ids.length === 0) continue
      if (key.startsWith("wiki/")) {
        let canonical: string
        try { canonical = canonicalDomainResourceKey("wiki", key) }
        catch { throw new ServiceError("invalid_argument", "Invalid Wiki domain resource key") }
        if (canonical !== key) throw new ServiceError("invalid_argument", "Invalid Wiki domain resource key")
        if (!(await repository.get(project, "wiki", key))) throw new ServiceError("not_found", "Wiki domain resource not found")
        continue
      }
      if (key.startsWith("raw/documents/")) {
        let sourceId: string
        try { sourceId = key.slice("raw/documents/".length); canonicalDomainResourceKey("document", sourceId) }
        catch { throw new ServiceError("invalid_argument", "Invalid document domain resource key") }
        let after = "", exists = false
        for (;;) {
          const batch = await repository.list(project, "document", after, 200)
          if (!batch.length) break
          for (const record of batch) {
            const data = record.data as { sourceId?: unknown }
            if (data && data.sourceId === sourceId) { exists = true; break }
          }
          if (exists || batch.length < 200) break
          after = batch[batch.length - 1].key
        }
        if (!exists) throw new ServiceError("not_found", "Document source domain resource not found")
        continue
      }
      throw new ServiceError("invalid_argument", "New domain assignments require a canonical Wiki or document key")
    }
  }
  return {
    async memoryGraph(project, options) {
      const context = await check(project, "memory.read")
      const granted = await grants(project), at = now()
      const visible = (await repository.memoryGraph(project, options)).filter(node =>
        canAccessMemoryView(context, { ...node, source: node.source ?? { kind: "legacy" } } as MemoryAccessView, granted, at, "read") &&
        !(node.validityUntil && Date.parse(node.validityUntil) <= Date.parse(at)))
      const ids = new Set(visible.map(node => node.id))
      return visible.map(({ access: _a, source: _s, validityUntil: _v, ...node }) => ({ ...node, relations: node.relations.filter(relation => ids.has(relation.targetId)) }))
    },
    async memorySummaries(project, options) {
      const context = await check(project, "memory.read")
      const granted = await grants(project)
      const items: MemorySummary[] = []
      let cursor = options.after ?? null
      for (let page = 0; page < 20; page++) {
        const result = await repository.memorySummaries(project, { limit: Math.min(200, Math.max(options.limit, 1)), after: cursor })
        for (const row of result.items) {
          if (!canAccessMemoryView(context, { ...row, source: row.source ?? { kind: "legacy" } } as MemoryAccessView, granted, now(), "read")) continue
          if (row.validityUntil && Date.parse(row.validityUntil) <= Date.parse(now())) continue
          const { access: _a, source: _s, validityUntil: _v, ...rest } = row
          items.push(rest as MemorySummary)
          if (items.length === options.limit) return { items, nextCursor: { updatedAt: row.updatedAt, id: row.id } }
        }
        if (!result.nextCursor) return { items, nextCursor: null }
        cursor = result.nextCursor
      }
      return { items, nextCursor: cursor }
    },
    async saveMemoryAtomic(project, next, expected) { await check(project, "memory.write"); return repository.saveMemoryAtomic(project, next, expected, now()) },
    async archiveMemoryRevisions(project, memoryId, revisions) { await check(project, "memory.write"); return repository.archiveMemoryRevisions(project, memoryId, revisions) },
    async memoryWriteReplay(project, key) { await check(project, "memory.write"); return repository.memoryWriteReplay(project, key) },
    async saveMemoryWriteReplay(project, key, entry) { await check(project, "memory.write"); return repository.saveMemoryWriteReplay(project, key, entry) },
    async governanceSaveWorkspace(project, data, expected) { await check(project, "memory.write"); const saved = await repository.save(project, "workspace", "default", data, expected, now()); return { data: saved.data as SharedWorkspace, revision: saved.revision } },
    async governanceWorkspace(project) { await check(project, "memory.write"); return repository.governanceWorkspace(project) },
    async proposals(project) { await check(project, "wiki.read"); return repository.proposals(project) },
    async proposal(project, id) { await check(project, "wiki.read"); return repository.proposal(project, id) },
    async saveProposal(proposal) { const context = await check(proposal.projectId, "wiki.write"); if (context.projectId !== proposal.projectId) throw new AuthError("forbidden", "Proposal project mismatch"); return repository.saveProposal(proposal) },
    searchWiki: async (input) => { await check(input.projectId, "wiki.read"); return repository.searchWiki(input) },
    async createProject() { throw new AuthError("forbidden", "Project creation requires a global account operation") },
    async project(id) { await scoped(id); return repository.project(id) },
    async projects(after, limit) {
      const found = []; let cursor = after
      while (found.length < limit) {
        const values = await repository.projects(cursor, 200)
        for (const value of values) {
          cursor = value.id
          try { await check(value.id, "project.read"); found.push(value); if (found.length === limit) break } catch (error) { if (!(error instanceof AuthError) || error.code !== "forbidden") throw error }
        }
        if (values.length < 200 || found.length === limit) break
      }
      return found
    },
    async get(project, kind, key) {
      const context = await check(project, kind === "wiki" ? "wiki.read" : kind === "document" ? "documents.read" : "project.read"), value = await repository.get(project, kind, key)
      return value && kind === "workspace" ? { ...value, data: visibleWorkspace(value.data as SharedWorkspace, context, await grants(project), now()) } : value
    },
    async list(project, kind, after, limit) { await check(project, kind === "wiki" ? "wiki.read" : kind === "document" ? "documents.read" : "project.read"); if (kind === "workspace") throw new AuthError("forbidden", "Use the filtered workspace endpoint"); return repository.list(project, kind, after, limit) },
    async save(project, kind, key, data, expected, timestamp) {
      const context = await scoped(project)
      if (kind === "workspace") {
        if (!context.permissions.includes("memory.write") && !context.permissions.includes("domains.manage")) throw new AuthError("forbidden", "Workspace write permission required")
        const current = await repository.get(project, kind, key)
        if (!current) throw new AuthError("not_found", "Workspace not found")
        const priorWorkspace = current.data as SharedWorkspace
        const merged = mergeAuthorizedWorkspace(priorWorkspace, validateSharedWorkspace(data), context, await grants(project), now())
        await validateDomainTargets(project, priorWorkspace, merged)
        data = validateSharedWorkspace(merged)
        const saved = await repository.save(project, kind, key, data, expected, timestamp)
        return { ...saved, data: visibleWorkspace(saved.data as SharedWorkspace, context, await grants(project), now()) }
      }
      requireContextPermission(context, kind === "wiki" ? "wiki.write" : "documents.write")
      return repository.save(project, kind, key, data, expected, timestamp)
    },
    async remove(project, kind, key, expected, timestamp) { if (kind === "workspace") throw new AuthError("forbidden", "Workspace deletion is not allowed"); await check(project, kind === "wiki" ? "wiki.write" : "documents.write"); return repository.remove(project, kind, key, expected, timestamp) },
    async events(project, after, limit) {
      const context = await check(project, "project.read"), found: ProjectEvent[] = []; let cursor = after
      while (found.length < limit) {
        const values = await repository.events(project, cursor, 200)
        for (const value of values) { cursor = value.sequence; if (eventVisible(context, value)) found.push(value); if (found.length === limit) break }
        if (values.length < 200 || found.length === limit) break
      }
      return found
    },
  }
}
