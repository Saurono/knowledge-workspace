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
  const domains = createDomainService({ read: async () => read().data, update: async (_project, change) => {
    const result = await update(current => ({ ...current, ...change(current) })); return result
  } })
  return {
    async load() { await queue; snapshot = (await api.workspace(projectId)).data; return snapshot },
    snapshot: read,
    saveMemory: (record: Parameters<typeof memories.save>[1]) => memories.save(projectId, record),
    removeMemory: (id: string) => memories.remove(projectId, id),
    addDomain: (tag: Parameters<typeof domains.add>[1]) => domains.add(projectId, tag),
    toggleDomain: (path: string, id: string) => domains.toggle(projectId, path, id),
    removeDomain: (id: string) => update(current => removeDomain(current, id)),
  }
}
