import {
  createMemoryService,
  type MemoryRepository,
  type MemoryRecord,
} from "@/modules/memory/application"
import {
  createDomainService,
  type DomainRepository,
  type DomainTag,
} from "@/modules/domains/application"
import { loadWorkspaceData, updateWorkspaceData } from "./json-repository"
import { removeDomain, type WorkspaceData } from "./snapshot"
export const memoryRepository: MemoryRepository = {
  read: async (path) => (await loadWorkspaceData(path)).memories,
  update: async (path, change) =>
    (await updateWorkspaceData(path, (data) => ({ ...data, memories: change(data.memories) })))
      .memories,
}
export const domainRepository: DomainRepository = {
  read: async (path) => {
    const { domains, resourceDomains } = await loadWorkspaceData(path)
    return { domains, resourceDomains }
  },
  update: async (path, change) => {
    const data = await updateWorkspaceData(path, (current) => ({
      ...current,
      ...change({ domains: current.domains, resourceDomains: current.resourceDomains }),
    }))
    return { domains: data.domains, resourceDomains: data.resourceDomains }
  },
}
const memories = createMemoryService(memoryRepository)
const domains = createDomainService(domainRepository)
export type WorkspaceCommand =
  | { type: "memory.save"; record: MemoryRecord }
  | { type: "memory.remove"; id: string }
  | { type: "domain.add"; tag: DomainTag }
  | { type: "domain.toggle"; resourcePath: string; domainId: string }
  | { type: "domain.remove"; id: string }
export async function executeWorkspaceCommand(
  path: string,
  command: WorkspaceCommand,
): Promise<WorkspaceData> {
  switch (command.type) {
    case "memory.save":
      await memories.save(path, command.record)
      break
    case "memory.remove":
      await memories.remove(path, command.id)
      break
    case "domain.add":
      await domains.add(path, command.tag)
      break
    case "domain.toggle":
      await domains.toggle(path, command.resourcePath, command.domainId)
      break
    case "domain.remove":
      return updateWorkspaceData(path, (data) => removeDomain(data, command.id))
  }
  return loadWorkspaceData(path)
}
