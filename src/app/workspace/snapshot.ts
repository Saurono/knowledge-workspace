import {
  validateMemories,
  removeMemoryRecord,
  detachMemoryDomain,
  type MemoryRecord,
} from "@/modules/memory/domain"
import { validateDomainState, removeDomainTag, type DomainTag } from "@/modules/domains/domain"
export type { MemoryRecord, DomainTag }
/** Version-one on-disk compatibility envelope, not a shared business model. */
export interface WorkspaceData {
  version: 1
  domains: DomainTag[]
  resourceDomains: Record<string, string[]>
  memories: MemoryRecord[]
}
export const emptyWorkspaceData = (): WorkspaceData => ({
  version: 1,
  domains: [],
  resourceDomains: {},
  memories: [],
})
export function validateWorkspaceData(value: unknown): WorkspaceData {
  if (!value || typeof value !== "object" || (value as WorkspaceData).version !== 1)
    throw new Error("Unsupported workspace data; the original file was preserved")
  const data = value as WorkspaceData
  validateDomainState(data)
  validateMemories(data.memories)
  return data
}
/** Cross-module coordination is owned here, not by either domain module. */
export function removeDomain(data: WorkspaceData, id: string): WorkspaceData {
  return { ...data, ...removeDomainTag(data, id), memories: detachMemoryDomain(data.memories, id) }
}
export function removeMemory(data: WorkspaceData, id: string): WorkspaceData {
  return { ...data, memories: removeMemoryRecord(data.memories, id) }
}
