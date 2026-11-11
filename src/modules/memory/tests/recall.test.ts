import { expect, it } from "vitest"
import { createMemoryRecord, type MemoryRecord } from "../domain/model"
import { buildInjection, createRecallService, proposeWrite, type MemoryWriteProposal } from "../application/recall"
const now = "2026-11-10T00:00:00Z"
const memory = (id: string, patch: Partial<MemoryRecord> = {}) => ({ ...createMemoryRecord({ id, title: id, content: "body", category: "general", domainIds: [], relatedIds: [], createdAt: now, updatedAt: now }), ...patch })
const recall = createRecallService({ authorize: m => m.id !== "denied" }).recall
it("filters status, expiry, authorization and records limit", () => {
  const result = recall([memory("candidate", { status: "candidate" }), memory("archived", { status: "archived" }), memory("expired", { validity: { until: now } }), memory("denied"), memory("a"), memory("b")], { now, limit: 1 })
  expect(result.hits.map(h => h.memory.id)).toEqual(["a"])
  expect(result.scope).toEqual({ authorize: "injected", limit: 1, considered: 6, excluded: [{ id: "candidate", reason: "not-active" }, { id: "archived", reason: "not-active" }, { id: "expired", reason: "expired" }, { id: "denied", reason: "unauthorized" }, { id: "b", reason: "over-limit" }] })
  expect(result.hits[0].reason.length).toBeGreaterThan(0)
})
it("sorts importance then credibility then timestamp then id with null last", () => {
  const result = recall([memory("null"), memory("low", { importance: 0 }), memory("cred-null", { importance: 1 }), memory("old", { importance: 1, credibility: 0, updatedAt: "2025-01-01T00:00:00Z" }), memory("b", { importance: 1, credibility: 0 }), memory("a", { importance: 1, credibility: 0 }), memory("high", { importance: 1, credibility: 1 })], { now, limit: 10 })
  expect(result.hits.map(h => h.memory.id)).toEqual(["high", "a", "b", "old", "cred-null", "low", "null"])
})
it("injects only whole entries within exact budget deterministically", () => {
  const result = recall([memory("a"), memory("b")], { now, limit: 2 })
  const full = buildInjection(result, { maxChars: 1000 })
  expect(buildInjection(result, { maxChars: full.text.length })).toEqual(full)
  expect(buildInjection(result, { maxChars: full.text.length - 1 }).citations).toEqual([{ memoryId: "a", version: 1 }])
  expect(buildInjection(result, { maxChars: 1 })).toEqual({ text: "", citations: [], truncated: true })
  expect(JSON.stringify(buildInjection(result, { maxChars: 1000 }))).toBe(JSON.stringify(full))
})
const proposal = (): MemoryWriteProposal => ({ kind: "create", payload: { title: " title ", content: "body", category: "general", domainIds: ["domain"], importance: null }, evidence: [{ source: "source", ref: "ref" }], requestedBy: { kind: "agent", id: "agent" } })
it("rejects missing evidence, missing update id and invalid importance", () => {
  for (const input of [{ ...proposal(), evidence: [] }, { ...proposal(), kind: "update" as const }, ...[-1, 2, NaN].map(importance => ({ ...proposal(), payload: { ...proposal().payload, importance } }))]) expect(() => proposeWrite(input)).toThrowError(expect.objectContaining({ code: "invalid_argument" }))
})
it("normalizes and deeply copies proposals without mutation", () => {
  const input = proposal(), before = structuredClone(input), output = proposeWrite(input)
  expect(input).toEqual(before)
  expect(output.payload.title).toBe("title")
  expect(output).not.toBe(input)
  expect(output.payload).not.toBe(input.payload)
  expect(output.payload.domainIds).not.toBe(input.payload.domainIds)
  expect(output.evidence[0]).not.toBe(input.evidence[0])
  expect(output.requestedBy).not.toBe(input.requestedBy)
})
