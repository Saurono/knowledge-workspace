import { createMemoryRecord, removeMemoryRecord, validateMemories, type MemoryRecord } from "../domain/model"
import type { MemorySource } from "../domain/model"
import { transitionMemory, expireDue } from "../domain/lifecycle"
import { MemoryWriteError } from "./errors"
export interface MemoryWriteOptions { expectedVersion: number | null; idempotencyKey?: string }
export interface MemoryWriteResult { record: MemoryRecord; applied: boolean; replayed: boolean }
type Entry = { fingerprint: string; result: MemoryWriteResult }
export interface MemoryIdempotencyStore {
  get(projectPath: string, key: string): Promise<Entry | null>
  put(projectPath: string, key: string, entry: Entry): Promise<void>
}
export function createMemoryIdempotencyStore(): MemoryIdempotencyStore {
  const entries = new Map<string, Entry>()
  return {
    get: async (path, key) => structuredClone(entries.get(JSON.stringify([path, key])) ?? null),
    put: async (path, key, entry) => { entries.set(JSON.stringify([path, key]), structuredClone(entry)) },
  }
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`
  return JSON.stringify(value) ?? "null"
}
export interface MemoryRepository {
  read(projectPath: string): Promise<MemoryRecord[]>
  update(
    projectPath: string,
    change: (memories: MemoryRecord[]) => MemoryRecord[],
  ): Promise<MemoryRecord[]>
}
export function createMemoryService(repository: MemoryRepository, idempotencyOrNow: MemoryIdempotencyStore | (() => string) = createMemoryIdempotencyStore()) {
  const now = typeof idempotencyOrNow === "function" ? idempotencyOrNow : () => new Date().toISOString()
  const idempotency = typeof idempotencyOrNow === "function" ? createMemoryIdempotencyStore() : idempotencyOrNow
  let pending = Promise.resolve()
  const changeStatus = (projectPath: string, id: string, to: "active" | "archived", source: MemorySource) =>
    repository.update(projectPath, memories => {
      const record = memories.find(item => item.id === id)
      if (!record) throw new Error("Memory not found")
      return validateMemories(memories.map(item => item !== record || (to === "archived" && item.status === "archived")
        ? item : transitionMemory(item, to, now, memories, { reason: JSON.stringify(source) })))
    })
  const service = {
    resolve: (projectPath: string, aId: string, bId: string, decision: "a-canonical" | "both-intentional" | "merged", source: MemorySource, note?: string) =>
      repository.update(projectPath, memories => {
        const [a, b] = [aId, bId].sort().map(id => memories.find(item => item.id === id))
        if (!a || !b || a === b || a.status !== "active" || b.status !== "active") throw new Error("Resolution requires two active memories")
        if (a.resolutions?.some(r => r.ofConflictWith === b.id && r.decision === decision)) return memories
        return validateMemories(memories.map(item => item !== a ? item : { ...item, resolutions: [...(item.resolutions ?? []),
          { ofConflictWith: b.id, decision, by: source.actorId ?? "", at: now(), ...(note === undefined ? {} : { note }) }] }))
      }),
    promote: (projectPath: string, id: string, source: MemorySource) => changeStatus(projectPath, id, "active", source),
    archive: (projectPath: string, id: string, source: MemorySource) => changeStatus(projectPath, id, "archived", source),
    expireDue: (projectPath: string, at: string) => repository.update(projectPath, memories => validateMemories(expireDue(memories, at))),
    supersede: (projectPath: string, oldId: string, newId: string, source: MemorySource) =>
      repository.update(projectPath, memories => {
        const old = memories.find(item => item.id === oldId), next = memories.find(item => item.id === newId)
        if (!old) throw new Error("Memory not found")
        if (old.status === "superseded" || old.status === "archived") return validateMemories(memories)
        if (!next || next.status !== "active" || old.status !== "active" || oldId === newId)
          throw new Error("Supersession requires two active memories")
        const at = now()
        const replaced = transitionMemory(old, "superseded", () => at, memories, { supersededById: newId, reason: JSON.stringify(source) })
        const replacement = { ...next, supersedesId: oldId, transitions: [...next.transitions,
          { at, from: next.status, to: next.status, source: next.source, reason: JSON.stringify(source) }] }
        return validateMemories(memories.map(item => item === old ? replaced : item === next ? replacement : item))
      }),
    list: (projectPath: string) => repository.read(projectPath),
    save: (projectPath: string, record: MemoryRecord) =>
      repository.update(projectPath, (memories) => {
        if (!record.id.trim() || !record.title.trim() || !record.content.trim())
          throw new Error("Memory title and content are required")
        const previous = memories.find((memory) => memory.id === record.id)
        const saved = createMemoryRecord({ ...record,
          title: record.title.trim(), createdAt: previous?.createdAt ?? record.createdAt,
          domainIds: [...new Set(record.domainIds)], relatedIds: [...new Set(record.relatedIds)].filter((id) => id !== record.id),
        })
        saved.relations = [...record.relations.filter(relation => relation.type !== "related"), ...saved.relations]
        const base = previous ?? record
        const last = record.revisions[record.revisions.length - 1]
        validateMemories([base === record ? { ...record, title: last?.title, content: last?.content } : base])
        const contentChanged = saved.title !== base.title || saved.content !== base.content || saved.title !== record.title ||
          saved.title !== last?.title || saved.content !== last?.content
        const fields = (item: MemoryRecord) => [item.title, item.content, item.category, item.domainIds, item.relatedIds, item.access, item.importance, item.credibility, item.validity, item.status, item.relations]
        const changed = stable(fields(saved)) !== stable(fields(base))
        saved.version = base.version
        saved.revisions = [...base.revisions]
        if (changed) {
          saved.version += 1
          saved.updatedAt = now()
        } else {
          saved.updatedAt = base.updatedAt
        }
        if (changed) saved.revisions.push({ version: saved.version, title: saved.title, content: saved.content, at: saved.updatedAt, source: saved.source, ...(contentChanged ? {} : { changeNote: "metadata" }) })
        return validateMemories([...memories.filter((memory) => memory.id !== record.id), saved])
      }),
    remove: (projectPath: string, id: string) =>
      repository.update(projectPath, (memories) => validateMemories(removeMemoryRecord(memories, id))),
  }
  return { ...service, write(projectPath: string, input: MemoryRecord, options: MemoryWriteOptions): Promise<MemoryWriteResult> {
    const run = async () => {
      const bytes = new TextEncoder().encode(stable([input, options.expectedVersion]))
      const fingerprint = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("")
      const key = options.idempotencyKey
      const prior = key === undefined ? null : await idempotency.get(projectPath, key)
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new MemoryWriteError("idempotency_conflict", "Idempotency key conflict", undefined, prior.result)
        return { ...structuredClone(prior.result), applied: false, replayed: true }
      }
      const checked: MemoryRepository = { read: repository.read, update: (path, change) => repository.update(path, memories => {
        const current = memories.find(item => item.id === input.id)
        if (!current && options.expectedVersion !== null) throw new MemoryWriteError("invalid_argument", "Creation requires null version")
        if (current && (typeof options.expectedVersion !== "number" || options.expectedVersion !== current.version))
          throw new MemoryWriteError("version_conflict", "Memory version conflict", current.version)
        return change(memories)
      }) }
      const records = await createMemoryService(checked).save(projectPath, input)
      const result = { record: records.find(item => item.id === input.id)!, applied: true, replayed: false }
      if (key !== undefined) await idempotency.put(projectPath, key, { fingerprint, result: structuredClone(result) })
      return result
    }
    const result = pending.then(run)
    pending = result.then(() => {}, () => {})
    return result
  } }
}
export type MemoryService = ReturnType<typeof createMemoryService>
