import type { MemoryRecord } from "../domain/model"
import { normalizeMemoryCategory } from "@/modules/memory/domain"
import { activeMemories } from "../domain/lifecycle"
import { MemoryWriteError } from "./errors"

export interface RecallOptions { limit: number; now: string; maxChars?: number; taskId?: string }
export interface RecallHit { memory: MemoryRecord; score: number; reason: string }
export interface RecallResult {
  hits: RecallHit[]
  scope: { authorize: "injected"; limit: number; considered: number; excluded: Array<{ id: string; reason: "not-active" | "expired" | "unauthorized" | "over-limit" }> }
}
export interface Injection { text: string; citations: Array<{ memoryId: string; version: number }>; truncated: boolean }
const invalid = (message: string): never => { throw new MemoryWriteError("invalid_argument", message) }
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
export function createRecallService(deps: { authorize: (memory: MemoryRecord) => boolean }) {
  return { recall(list: MemoryRecord[], options: RecallOptions): RecallResult {
    if (!Number.isInteger(options.limit) || options.limit < 0 || !Number.isFinite(Date.parse(options.now))) invalid("Invalid recall options")
    const excluded: RecallResult["scope"]["excluded"] = []
    const active = new Set(activeMemories(list))
    const eligible = list.filter(memory => {
      const reason = !active.has(memory) ? "not-active" : memory.validity.until && Date.parse(memory.validity.until) <= Date.parse(options.now) ? "expired" : !deps.authorize(memory) ? "unauthorized" : undefined
      if (reason) excluded.push({ id: memory.id, reason })
      return !reason
    }).sort((a, b) => (b.importance ?? -1) - (a.importance ?? -1) || (b.credibility ?? -1) - (a.credibility ?? -1) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || compare(a.id, b.id))
    for (const memory of eligible.slice(options.limit)) excluded.push({ id: memory.id, reason: "over-limit" })
    return { hits: eligible.slice(0, options.limit).map(memory => ({ memory, score: memory.importance ?? 0, reason: `importance ${memory.importance ?? "unknown"}, credibility ${memory.credibility ?? "unknown"}, active and authorized` })), scope: { authorize: "injected", limit: options.limit, considered: list.length, excluded } }
  } }
}
export function buildInjection(result: RecallResult, { maxChars }: { maxChars: number }): Injection {
  if (!Number.isInteger(maxChars) || maxChars < 0) invalid("Invalid character budget")
  const injection: Injection = { text: "", citations: [], truncated: false }
  for (const { memory } of result.hits) {
    const entry = `[${memory.id}@${memory.version}] ${memory.title}\n${memory.content}`
    const text = injection.text + (injection.citations.length ? "\n\n" : "") + entry
    if (text.length > maxChars) { injection.truncated = true; continue }
    injection.text = text
    injection.citations.push({ memoryId: memory.id, version: memory.version })
  }
  return injection
}
export interface MemoryWriteProposal {
  kind: "create" | "update"
  memoryId?: string
  payload: { title: string; content: string; category?: string; domainIds: string[]; importance?: number | null }
  evidence: Array<{ source: string; ref: string }>
  requestedBy: { kind: "user" | "agent" | "system"; id: string }
}
export function proposeWrite(input: MemoryWriteProposal): MemoryWriteProposal {
  const nonempty = (value: unknown): value is string => typeof value === "string" && !!value.trim()
  if (!input || !["create", "update"].includes(input.kind) || !input.payload ||
    ![input.payload.title, input.payload.content, input.requestedBy?.id].every(nonempty) ||
    !["user", "agent", "system"].includes(input.requestedBy?.kind) ||
    !Array.isArray(input.payload.domainIds) || !input.payload.domainIds.every(nonempty) ||
    !Array.isArray(input.evidence) || !input.evidence.length || !input.evidence.every(e => e && nonempty(e.source) && nonempty(e.ref)) ||
    (input.kind === "update" && !nonempty(input.memoryId)) || (input.memoryId !== undefined && !nonempty(input.memoryId))) invalid("Proposal requires nonempty fields and evidence")
  const importance = input.payload.importance
  if (importance !== undefined && importance !== null && (typeof importance !== "number" || !Number.isFinite(importance) || importance < 0 || importance > 1)) invalid("Importance must be between zero and one")
  return { kind: input.kind, ...(input.memoryId === undefined ? {} : { memoryId: input.memoryId.trim() }), payload: { ...input.payload, title: input.payload.title.trim(), content: input.payload.content.trim(), category: normalizeMemoryCategory(input.payload.category ?? ""), domainIds: input.payload.domainIds.map(id => id.trim()) }, evidence: input.evidence.map(e => ({ source: e.source.trim(), ref: e.ref.trim() })), requestedBy: { kind: input.requestedBy.kind, id: input.requestedBy.id.trim() } }
}
