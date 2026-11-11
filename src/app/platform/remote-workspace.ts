import { createMemoryService } from "@/modules/memory/application"
import { createDomainService } from "@/modules/domains/application"
import { removeDomain } from "@/app/workspace/snapshot"
import type { createSharedClient, SharedWorkspace } from "@/modules/service-api/application"
import type { ResourceRecord } from "@/modules/service-api/domain"
export function createRemoteWorkspace(api: ReturnType<typeof createSharedClient>, projectId: string) {
  let snapshot: ResourceRecord<SharedWorkspace> | null = null, queue: Promise<unknown> = Promise.resolve()
  const read = () => { if (!snapshot) throw new Error("Load the workspace before editing"); return snapshot }
  const update = (change: (workspace: SharedWorkspace) => SharedWorkspace) => {
    const work = queue.then(async () => {
      const base = read()
      const saved = (await api.saveWorkspace(projectId, change(base.data), base.revision)).data
      snapshot = saved; return saved.data
    })
    queue = work.catch(() => {}); return work
  }
  const memories = createMemoryService({ read: async () => read().data.memories, update: async (_project, change) => (await update(current => ({ ...current, memories: change(current.memories) }))).memories })
  const atomicMemory = (request: () => Promise<{ data: { memory: unknown; revision: number } }>) => {
    const work = queue.then(async () => {
      const base = read()
      const { memory, revision } = (await request()).data
      const saved = memory as SharedWorkspace["memories"][number]
      const records = base.data.memories.some(item => item.id === saved.id)
        ? base.data.memories.map(item => item.id === saved.id ? saved : item)
        : [...base.data.memories, saved]
      snapshot = { ...base, revision, data: { ...base.data, memories: records } }
      return records
    })
    queue = work.catch(() => {}); return work
  }
  const domains = createDomainService({ read: async () => read().data, update: async (_project, change) => {
    const result = await update(current => ({ ...current, ...change(current) })); return result
  } })
  return {
    async load(options?: { memories?: "none" }) { await queue; snapshot = (await api.workspace(projectId, options)).data; return snapshot },
    snapshot: read,
    /** 列表页用：只拿摘要，不读整份 workspace。 */
    listMemorySummaries: (options?: { limit?: number; cursor?: string | null }) =>
      api.memorySummaries(projectId, options).then(response => response.data),
    /** 摘要模式下取当前项目的冲突对；只读，不写。 */
    listMemoryConflicts: (options?: { limit?: number }) =>
      api.memoryConflicts(projectId, options).then(response => response.data.items),
    /** 选中某条后再拉整条记录；失败时抛出（不吞、不返回 null）。 */
    loadMemory: async (memoryId: string) => {
      const cached = snapshot?.data.memories.find(item => item.id === memoryId)
      if (cached) return cached
      const { memory, revision } = (await api.memory(projectId, memoryId)).data
      const saved = memory as SharedWorkspace["memories"][number]
      const base = read()
      const records = base.data.memories.some(item => item.id === saved.id)
        ? base.data.memories.map(item => item.id === saved.id ? saved : item)
        : [...base.data.memories, saved]
      snapshot = { ...base, revision, data: { ...base.data, memories: records } }
      return saved
    },
    saveMemory: (record: Parameters<typeof memories.save>[1]) => atomicMemory(() => {
      const { title, content, category, domainIds, relatedIds, access, importance, credibility, validity } = record
      return api.writeMemory(projectId, record.id, {
        input: { title, content, category, domainIds, relatedIds, access, importance, credibility, validity },
        expectedVersion: read().data.memories.find(item => item.id === record.id)?.version ?? null,
      })
    }),
    // No delete route exists: removal still saves the entire workspace.
    removeMemory: (id: string) => memories.remove(projectId, id),
    promoteMemory: (id: string) => atomicMemory(() => api.memoryAction(projectId, id, "promote")),
    archiveMemory: (id: string) => atomicMemory(() => api.memoryAction(projectId, id, "archive")),
    supersedeMemory: (oldId: string, newId: string) => atomicMemory(() => api.supersedeMemory(projectId, oldId, newId)),
    resolveMemoryConflict: (id: string, withId: string, decision: "a-canonical" | "both-intentional" | "merged", note?: string) =>
      memories.resolve(projectId, id, withId, decision, { kind: "user", actorId: "web-ui" }, note),
    addDomain: (tag: Parameters<typeof domains.add>[1]) => domains.add(projectId, tag),
    toggleDomain: (path: string, id: string) => domains.toggle(projectId, path, id),
    setResourceDomains: (canonicalKey: string, ids: readonly string[], legacyKeys: readonly string[] = []) =>
      domains.setResourceDomains(projectId, canonicalKey, ids, legacyKeys),
    removeDomain: (id: string) => update(current => removeDomain(current, id)),
  }
}
