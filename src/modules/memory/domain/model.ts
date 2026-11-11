import { validMemoryAccess } from "./access"
import type { MemoryAccess } from "./access"
import { isMemoryCategory, normalizeMemoryCategory } from "./category"
import type { MemoryCategory } from "./category"
export interface MemorySource { kind: "user" | "agent" | "import" | "system" | "legacy"; actorId?: string; ref?: string }
export type MemoryStatus = "candidate" | "active" | "superseded" | "expired" | "archived"
export interface MemoryTransition { at: string; from: MemoryStatus | null; to: MemoryStatus; reason?: string; source: MemorySource }
export interface MemoryRevision { version: number; title: string; content: string; at: string; source: MemorySource; changeNote?: string }
export interface MemoryValidity { from?: string; until?: string }
export interface MemoryRelation { type: "related" | "supersedes" | "contradicts" | "derived-from"; targetId: string }
export interface MemoryRecord {
  resolutions?: Array<{ ofConflictWith: string; decision: "a-canonical" | "both-intentional" | "merged"; by: string; at: string; note?: string }>
  contentHash?: string
  status: MemoryStatus
  supersedesId?: string
  supersededById?: string
  transitions: MemoryTransition[]
  version: number
  revisions: MemoryRevision[]
  revisionCompaction?: { upToVersion: number; keptFrom: number; digest: string }
  source: MemorySource
  importance: number | null
  credibility: number | null
  validity: MemoryValidity
  relations: MemoryRelation[]
  id: string
  access?: MemoryAccess
  title: string
  content: string
  category: MemoryCategory
  domainIds: string[]
  relatedIds: string[]
  createdAt: string
  updatedAt: string
}
export function createMemoryRecord(input: Omit<MemoryRecord, "category" | "version" | "revisions" | "relations" | "source" | "importance" | "credibility" | "validity" | "status" | "transitions"> & {
  category: string
  status?: MemoryStatus; transitions?: MemoryTransition[]
  source?: MemorySource; importance?: number | null; credibility?: number | null; validity?: MemoryValidity
}): MemoryRecord {
  const source = input.source ?? { kind: "user" }
  return { ...input, category: normalizeMemoryCategory(input.category), source, version: 1, status: input.status ?? "active", transitions: input.transitions ?? [],
    revisions: [{ version: 1, title: input.title, content: input.content, at: input.updatedAt, source }],
    importance: input.importance ?? null, credibility: input.credibility ?? null,
    validity: input.validity ?? {}, relations: input.relatedIds.map(targetId => ({ type: "related", targetId })) }
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value)
const sourceValid = (value: unknown): value is MemorySource => object(value) &&
  ["user", "agent", "import", "system", "legacy"].includes(value.kind as string) &&
  [value.actorId, value.ref].every(item => item === undefined || typeof item === "string")
const dateValid = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value))
const scoreValid = (value: unknown) => value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1)
const sameSource = (a: MemorySource, b: MemorySource) => a.kind === b.kind && a.actorId === b.actorId && a.ref === b.ref
function normalizedValid(memory: MemoryRecord): boolean {
  if (memory.resolutions !== undefined && (!Array.isArray(memory.resolutions) || !memory.resolutions.every(r => object(r) &&
    ["a-canonical", "both-intentional", "merged"].includes(r.decision as string) &&
    [r.ofConflictWith, r.by, r.at].every(v => typeof v === "string" && v.trim().length > 0) &&
    (r.note === undefined || typeof r.note === "string")))) return false
  const statusValid = (value: unknown) => ["candidate", "active", "superseded", "expired", "archived"].includes(value as string)
  if (!statusValid(memory.status) ||
    ![memory.supersedesId, memory.supersededById].every(id => id === undefined || (typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id))) ||
    !Array.isArray(memory.transitions) || !memory.transitions.every(t => object(t) && dateValid(t.at) &&
      (t.from === null || statusValid(t.from)) && statusValid(t.to) && sourceValid(t.source) &&
      (t.reason === undefined || typeof t.reason === "string"))) return false
  if (!Number.isInteger(memory.version) || memory.version < 1 || !sourceValid(memory.source) ||
    !scoreValid(memory.importance) || !scoreValid(memory.credibility) || !object(memory.validity) ||
    ![memory.validity.from, memory.validity.until].every(value => value === undefined || dateValid(value)) ||
    (dateValid(memory.validity.from) && dateValid(memory.validity.until) && Date.parse(memory.validity.from) > Date.parse(memory.validity.until)) ||
    !Array.isArray(memory.relations) || !memory.relations.every(relation => object(relation) &&
      ["related", "supersedes", "contradicts", "derived-from"].includes(relation.type as string) &&
      typeof relation.targetId === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(relation.targetId)) ||
    !Array.isArray(memory.revisions) || !memory.revisions.length ||
    !memory.revisions.every((revision, index) => object(revision) && Number.isInteger(revision.version) && revision.version >= 1 &&
      (index === 0 || revision.version > memory.revisions[index - 1].version) &&
      typeof revision.title === "string" && typeof revision.content === "string" && typeof revision.at === "string" && sourceValid(revision.source) &&
      (revision.changeNote === undefined || typeof revision.changeNote === "string"))) return false
  const last = memory.revisions[memory.revisions.length - 1]
  if (memory.revisionCompaction !== undefined &&
    (!object(memory.revisionCompaction) || memory.revisions[0].version !== memory.revisionCompaction.keptFrom)) return false
  return last.version === memory.version && last.title === memory.title && last.content === memory.content &&
    last.at === memory.updatedAt && sameSource(last.source, memory.source)
}
const stringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string")
export function validateMemories(value: unknown): MemoryRecord[] {
  if (
    !Array.isArray(value) ||
    !value.every(
      (memory) =>
        memory &&
        [
          memory.id,
          memory.title,
          memory.content,
          memory.createdAt,
          memory.updatedAt,
        ].every((item) => typeof item === "string") &&
        isMemoryCategory(memory.category) &&
        (memory.access === undefined || validMemoryAccess(memory.access)) &&
        (memory.contentHash === undefined || (typeof memory.contentHash === "string" && /^[0-9a-f]{64}$/.test(memory.contentHash))) &&
        stringList(memory.domainIds) &&
        stringList(memory.relatedIds) && normalizedValid(memory),
    ) ||
    new Set(value.map((memory) => memory.id)).size !== value.length
  )
    throw new Error("Invalid memory records")
  return value
}
export function removeMemoryRecord(memories: readonly MemoryRecord[], id: string): MemoryRecord[] {
  return memories
    .filter((memory) => memory.id !== id)
    .map((memory) => ({
      ...memory,
      relatedIds: memory.relatedIds.filter((related) => related !== id),
      relations: memory.relations.filter((relation) => relation.targetId !== id),
    }))
}
export function detachMemoryDomain(
  memories: readonly MemoryRecord[],
  domainId: string,
): MemoryRecord[] {
  return memories.map((memory) => ({
    ...memory,
    domainIds: memory.domainIds.filter((id) => id !== domainId),
  }))
}
