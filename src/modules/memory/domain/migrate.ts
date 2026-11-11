import { createMemoryRecord, validateMemories, type MemoryRecord } from "./model"
import { normalizeMemoryCategory } from "./category"

export function migrateMemoryV1(value: unknown): MemoryRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid memory records")
  const record = value as MemoryRecord
  if (typeof record.category !== "string") throw new Error("Invalid memory records")
  const category = normalizeMemoryCategory(record.category)
  const normalize = (memory: MemoryRecord): MemoryRecord => category === record.category ? memory : {
    ...memory, category, transitions: [...memory.transitions, {
      at: memory.updatedAt, from: memory.status, to: memory.status,
      reason: `category-normalized:${record.category}`, source: memory.source,
    }],
  }
  const fields = ["version", "revisions", "source", "importance", "credibility", "validity", "relations"]
  if (fields.some(field => Object.prototype.hasOwnProperty.call(record, field))) {
    const validated = validateMemories([{ ...record, category }])[0]
    return validateMemories([normalize(category === record.category ? record : validated)])[0]
  }
  if (!Array.isArray(record.relatedIds)) throw new Error("Invalid memory records")
  return validateMemories([normalize(createMemoryRecord({ ...record, source: { kind: "legacy" }, status: "active", transitions: [] }))])[0]
}
export function migrateMemoriesV1(value: unknown): MemoryRecord[] {
  if (!Array.isArray(value)) throw new Error("Invalid memory records")
  return validateMemories(value.map(migrateMemoryV1))
}
