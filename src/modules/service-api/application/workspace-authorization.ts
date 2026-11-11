import { ServiceError } from "../domain"
import type { AccessContext, MemoryGrant } from "@/modules/identity/domain"
import type { MemoryRecord } from "@/modules/memory/domain"
import type { SharedWorkspace } from "./workspace"
export interface MemoryAccessView {
  id: string
  status: MemoryRecord["status"]
  source: { kind: string; actorId?: string | null }
  access?: MemoryRecord["access"]
}
export function canAccessMemory(context: AccessContext, memory: MemoryRecord, grants: MemoryGrant[], now: string, action: "read" | "write") {
  return canAccessMemoryView(context, memory, grants, now, action)
}
export function canAccessMemoryView(context: AccessContext, view: MemoryAccessView, grants: MemoryGrant[], now: string, action: "read" | "write"): boolean {
  if (!context.permissions.includes(action === "read" ? "memory.read" : "memory.write")) return false
  if (action === "read" && view.status !== "active") {
    return context.actorId === context.effectiveAccountId && (view.source.actorId === context.actorId || view.access?.ownerId === context.actorId)
  }
  const access = view.access
  if (!access || access.visibility === "project") return true
  if (access.visibility === "role") return !!context.workRoleId && !!access.workRoleIds?.length && access.workRoleIds.includes(context.workRoleId)
  if (context.actorId === context.effectiveAccountId && access.ownerId === context.actorId) return true
  return grants.some(grant => grant.projectId === context.projectId && grant.memoryId === view.id && grant.ownerId === access.ownerId && grant.accountId === context.actorId && grant.actions.includes(action) && !grant.revokedAt && Date.parse(grant.expiresAt) > Date.parse(now))
}
export function visibleWorkspace(workspace: SharedWorkspace, context: AccessContext, grants: MemoryGrant[], now: string): SharedWorkspace {
  // Read-time filtering is not a state transition; expireDue persists expiry.
  const memories = workspace.memories.filter(memory => canAccessMemory(context, memory, grants, now, "read")).filter(memory => !memory.validity?.until || !(Date.parse(memory.validity.until) <= Date.parse(now))), ids = new Set(memories.map(memory => memory.id))
  return { version: 1, domains: workspace.domains, resourceDomains: Object.fromEntries(Object.entries(workspace.resourceDomains).filter(([path]) => path.startsWith("wiki/") ? context.permissions.includes("wiki.read") : path.startsWith("raw/") && context.permissions.includes("documents.read"))), memories: memories.map(memory => ({ ...memory, relatedIds: memory.relatedIds.filter(id => ids.has(id)), relations: memory.relations.filter(relation => ids.has(relation.targetId) || relation.targetId === memory.id) })) }
}
export function mergeAuthorizedWorkspace(current: SharedWorkspace, proposed: SharedWorkspace, context: AccessContext, grants: MemoryGrant[], now: string): SharedWorkspace {
  const visible = visibleWorkspace(current, context, grants, now), shown = new Map(visible.memories.map(memory => [memory.id, memory])), originals = new Map(current.memories.map(memory => [memory.id, memory])), incoming = new Map(proposed.memories.map(memory => [memory.id, memory]))
  const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)
  if ((!same(visible.domains, proposed.domains) || !same(visible.resourceDomains, proposed.resourceDomains)) && !context.permissions.includes("domains.manage")) throw new ServiceError("forbidden", "Domain administration is required")
  for (const [id, memory] of incoming) {
    const previous = originals.get(id), priorVisible = shown.get(id)
    if (previous && !priorVisible) throw new ServiceError("forbidden", "Memory is outside the visible scope")
    if (priorVisible && same(priorVisible, memory)) continue
    if (!context.permissions.includes("memory.write") || (previous && !canAccessMemory(context, previous, grants, now, "write"))) throw new ServiceError("forbidden", "Memory write is outside the effective scope")
    if (memory.relatedIds.some(id => originals.has(id) && !shown.has(id))) throw new ServiceError("forbidden", "Memory links must remain within the visible scope")
    if (!same(previous?.access, memory.access)) {
      if (previous?.access && (context.actorId !== context.effectiveAccountId || previous.access.ownerId !== context.actorId)) throw new ServiceError("forbidden", "Only the memory owner may change visibility")
      if (memory.access && (memory.access.ownerId !== context.actorId || context.actorId !== context.effectiveAccountId)) throw new ServiceError("forbidden", "Memory ownership cannot be impersonated")
    }
    if (memory.access?.visibility === "role" && memory.access.workRoleIds?.some(id => id !== context.workRoleId)) throw new ServiceError("forbidden", "Role memory must use the selected authorized work role")
  }
  for (const [id] of shown) if (!incoming.has(id) && !canAccessMemory(context, originals.get(id)!, grants, now, "write")) throw new ServiceError("forbidden", "Memory deletion is outside the effective scope")
  const hidden = current.memories.filter(memory => !shown.has(memory.id)), domains = new Set(proposed.domains.map(domain => domain.id))
  const updated = proposed.memories.map(memory => {
    const prior = originals.get(memory.id)
    const hiddenLinks = prior?.relatedIds.filter(id => !shown.has(id) && originals.has(id)) ?? []
    return { ...memory, relatedIds: [...new Set([...memory.relatedIds, ...hiddenLinks])] }
  })
  const all = [...hidden, ...updated], ids = new Set(all.map(memory => memory.id))
  const canSeePath = (path: string) => path.startsWith("wiki/") ? context.permissions.includes("wiki.read") : path.startsWith("raw/") && context.permissions.includes("documents.read")
  if (Object.keys(proposed.resourceDomains).some(path => !canSeePath(path))) throw new ServiceError("forbidden", "Domain links are outside the visible resource scope")
  const resourceDomains = { ...Object.fromEntries(Object.entries(current.resourceDomains).filter(([path]) => !canSeePath(path))), ...proposed.resourceDomains }
  return { version: 1, domains: proposed.domains, resourceDomains: Object.fromEntries(Object.entries(resourceDomains).map(([path, ids]) => [path, ids.filter(id => domains.has(id))])), memories: all.map(memory => ({ ...memory, domainIds: memory.domainIds.filter(id => domains.has(id)), relatedIds: memory.relatedIds.filter(id => ids.has(id)) })) }
}
