/** @deprecated Version-one compatibility API. Feature code uses module APIs. */
export { loadWorkspaceData, updateWorkspaceData } from "@/app/workspace/json-repository"
export { emptyWorkspaceData, validateWorkspaceData, removeDomain, removeMemory } from "@/app/workspace/snapshot"
export type { WorkspaceData, MemoryRecord, DomainTag } from "@/app/workspace/snapshot"
