import type { MemoryRecord, MemoryStatus } from "./model"

export function transitionMemory(record: MemoryRecord, to: MemoryStatus, now: () => string,
  list: readonly MemoryRecord[] = [], options: { supersededById?: string; reason?: string } = {}): MemoryRecord {
  const from = record.status
  const at = now()
  if (!Number.isFinite(Date.parse(at))) throw new Error("Invalid lifecycle time")
  const allowed = (from === "candidate" && to === "active") ||
    (from !== "archived" && to === "archived") ||
    (from === "active" && to === "superseded") ||
    ((from === "active" || from === "candidate") && to === "expired")
  if (!allowed) throw new Error(`Invalid memory transition: ${from} -> ${to}`)
  if (to === "superseded" && (!options.supersededById || options.supersededById === record.id ||
    !list.some(item => item.id === options.supersededById))) throw new Error("Superseding memory must exist")
  if (to === "expired" && (!record.validity.until || !(Date.parse(record.validity.until) <= Date.parse(at))))
    throw new Error("Memory is not due for expiry")
  return { ...record, status: to,
    ...(to === "superseded" ? { supersededById: options.supersededById } : {}),
    transitions: [...record.transitions, { at, from, to, source: record.source, ...(options.reason === undefined ? {} : { reason: options.reason }) }] }
}

export function expireDue(list: readonly MemoryRecord[], now: string): MemoryRecord[] {
  if (!Number.isFinite(Date.parse(now))) throw new Error("Invalid lifecycle time")
  return list.map(record => (record.status === "active" || record.status === "candidate") &&
    record.validity.until && Date.parse(record.validity.until) <= Date.parse(now)
    ? transitionMemory(record, "expired", () => now) : record)
}

export function activeMemories(list: readonly MemoryRecord[]): MemoryRecord[] {
  return list.filter(record => record.status === "active")
}

export function detectConflicts(list: readonly MemoryRecord[]): Array<{ a: string; b: string; relation: "contradicts"; since: string }> {
  const active = activeMemories(list), ids = new Set(active.map(record => record.id)), seen = new Set<string>()
  const conflicts: Array<{ a: string; b: string; relation: "contradicts"; since: string }> = []
  for (const record of active) for (const relation of record.relations) {
    if (relation.type !== "contradicts" || !ids.has(relation.targetId) || relation.targetId === record.id) continue
    const [a, b] = [record.id, relation.targetId].sort(), key = JSON.stringify([a, b])
    const other = active.find(item => item.id === relation.targetId)!
    if (record.resolutions?.some(r => r.ofConflictWith === other.id) || other.resolutions?.some(r => r.ofConflictWith === record.id)) continue
    const since = Date.parse(record.updatedAt) >= Date.parse(other.updatedAt) ? record.updatedAt : other.updatedAt
    if (!seen.has(key)) { seen.add(key); conflicts.push({ a, b, relation: "contradicts", since }) }
  }
  return conflicts
}
