import { createDirectory, fileExists, readFile, writeFileAtomic } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import { withProjectLock } from "@/lib/project-mutex"

export interface DomainTag {
  id: string
  name: string
}
export interface MemoryRecord {
  id: string
  title: string
  content: string
  category: string
  domainIds: string[]
  relatedIds: string[]
  createdAt: string
  updatedAt: string
}
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
const dataPath = (projectPath: string) => `${normalizePath(projectPath)}/.llm-wiki/workspace.json`

export function validateWorkspaceData(value: unknown): WorkspaceData {
  if (!value || typeof value !== "object") throw new Error("Invalid workspace data")
  const data = value as WorkspaceData
  if (
    data.version !== 1 ||
    !Array.isArray(data.domains) ||
    !Array.isArray(data.memories) ||
    !data.resourceDomains ||
    typeof data.resourceDomains !== "object" ||
    Array.isArray(data.resourceDomains)
  ) {
    throw new Error("Unsupported workspace data; the original file was preserved")
  }
  const strings = (value: unknown): value is string[] =>
    Array.isArray(value) && value.every((x) => typeof x === "string")
  if (
    !data.domains.every((d) => d && typeof d.id === "string" && typeof d.name === "string") ||
    !Object.values(data.resourceDomains).every(strings) ||
    !data.memories.every(
      (m) =>
        m &&
        [m.id, m.title, m.content, m.category, m.createdAt, m.updatedAt].every(
          (x) => typeof x === "string",
        ) &&
        strings(m.domainIds) &&
        strings(m.relatedIds),
    ) ||
    new Set(data.domains.map((d) => d.id)).size !== data.domains.length ||
    new Set(data.memories.map((m) => m.id)).size !== data.memories.length
  )
    throw new Error("Invalid workspace records")
  return data
}
export async function loadWorkspaceData(projectPath: string): Promise<WorkspaceData> {
  if (!(await fileExists(dataPath(projectPath)))) return emptyWorkspaceData()
  return validateWorkspaceData(JSON.parse(await readFile(dataPath(projectPath))))
}
export async function updateWorkspaceData(
  projectPath: string,
  update: (data: WorkspaceData) => WorkspaceData,
): Promise<WorkspaceData> {
  return withProjectLock(`${normalizePath(projectPath)}\0workspace-data`, async () => {
    const data = validateWorkspaceData(update(await loadWorkspaceData(projectPath)))
    await createDirectory(`${normalizePath(projectPath)}/.llm-wiki`)
    await writeFileAtomic(dataPath(projectPath), JSON.stringify(data, null, 2))
    return data
  })
}
export function removeDomain(data: WorkspaceData, id: string): WorkspaceData {
  return {
    ...data,
    domains: data.domains.filter((d) => d.id !== id),
    resourceDomains: Object.fromEntries(
      Object.entries(data.resourceDomains).map(([path, ids]) => [
        path,
        ids.filter((d) => d !== id),
      ]),
    ),
    memories: data.memories.map((m) => ({ ...m, domainIds: m.domainIds.filter((d) => d !== id) })),
  }
}
export function removeMemory(data: WorkspaceData, id: string): WorkspaceData {
  return {
    ...data,
    memories: data.memories
      .filter((m) => m.id !== id)
      .map((m) => ({ ...m, relatedIds: m.relatedIds.filter((related) => related !== id) })),
  }
}
