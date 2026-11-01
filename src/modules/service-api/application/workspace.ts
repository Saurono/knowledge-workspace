import { validateMemories } from "@/modules/memory/domain"
import { validateDomainState } from "@/modules/domains/domain"
import type { MemoryRecord } from "@/modules/memory/domain"
import type { DomainTag } from "@/modules/domains/domain"
import { ServiceError } from "../domain"
export interface SharedWorkspace { version: 1; domains: DomainTag[]; resourceDomains: Record<string, string[]>; memories: MemoryRecord[] }
export const emptySharedWorkspace = (): SharedWorkspace => ({ version: 1, domains: [], resourceDomains: {}, memories: [] })
export function validateSharedWorkspace(value: unknown): SharedWorkspace {
  try {
    if (!value || typeof value !== "object" || (value as SharedWorkspace).version !== 1) throw new Error("Unsupported workspace schema")
    const workspace = value as SharedWorkspace
    validateDomainState(workspace); validateMemories(workspace.memories)
    const domains = new Set(workspace.domains.map(domain => domain.id)), memories = new Set(workspace.memories.map(memory => memory.id))
    if (workspace.memories.some(memory => memory.domainIds.some(id => !domains.has(id)) || memory.relatedIds.some(id => !memories.has(id)))
      || Object.values(workspace.resourceDomains).some(ids => ids.some(id => !domains.has(id)))) throw new Error("Workspace contains unknown references")
    return workspace
  } catch (error) { throw new ServiceError("invalid_argument", error instanceof Error ? error.message : "Invalid workspace") }
}
