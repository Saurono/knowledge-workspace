import { describe, expect, it } from "vitest"
import { createMemoryRecord, validateMemories, type MemoryStatus } from "../domain/model"
import { activeMemories, detectConflicts, expireDue, transitionMemory } from "../domain/lifecycle"

const now = "2026-11-10T00:00:00Z"
const record = (status: MemoryStatus = "active", id = "a") => createMemoryRecord({
  id, title: id, content: "Content", category: "", domainIds: [], relatedIds: [],
  createdAt: now, updatedAt: now, status, source: { kind: "import", ref: "test" }, validity: { until: now },
})
describe("memory lifecycle", () => {
  it.each<[MemoryStatus, MemoryStatus]>([
    ["candidate", "active"], ["candidate", "archived"], ["active", "archived"],
    ["expired", "archived"], ["superseded", "archived"], ["active", "superseded"],
    ["active", "expired"], ["candidate", "expired"],
  ])("allows %s -> %s with trace", (from, to) => {
    const input = record(from), before = structuredClone(input)
    const result = transitionMemory(input, to, () => now, [record("active", "b")], { supersededById: "b" })
    expect(result.status).toBe(to)
    expect(result.transitions[result.transitions.length - 1]).toEqual({ from, to, at: now, source: input.source })
    expect(validateMemories([result])).toHaveLength(1)
    expect(input).toEqual(before)
  })
  const statuses: MemoryStatus[] = ["candidate", "active", "superseded", "expired", "archived"]
  const legal = new Set(["candidate:active", "candidate:archived", "active:archived", "expired:archived", "superseded:archived", "active:superseded", "active:expired", "candidate:expired"])
  it.each(statuses.flatMap(from => statuses.filter(to => !legal.has(`${from}:${to}`)).map(to => [from, to])))
    ("rejects %s -> %s", (from, to) => expect(() => transitionMemory(record(from), to, () => now)).toThrow())
  it("requires an existing distinct replacement", () => {
    expect(() => transitionMemory(record(), "superseded", () => now)).toThrow()
    expect(() => transitionMemory(record(), "superseded", () => now, [], { supersededById: "missing" })).toThrow()
    expect(() => transitionMemory(record(), "superseded", () => now, [record()], { supersededById: "a" })).toThrow()
  })
  it.each(["2026-11-09T00:00:00Z", now])("expires until <= now: %s", until => {
    const input = [{ ...record(), validity: { until } }, { ...record("candidate", "b"), validity: { until } }]
    const before = structuredClone(input), result = expireDue(input, now)
    expect(result.map(item => item.status)).toEqual(["expired", "expired"])
    expect(result[0].transitions[result[0].transitions.length - 1]).toEqual({ from: "active", to: "expired", at: now, source: input[0].source })
    expect(input).toEqual(before)
    expect(expireDue(result, now)).toEqual(result)
  })
  it("leaves missing/future until and terminal statuses unchanged", () => {
    const list = [{ ...record(), validity: {} }, { ...record("candidate", "b"), validity: { until: "2026-11-11" } },
      record("expired", "c"), record("superseded", "d"), record("archived", "e")]
    expect(expireDue(list, now)).toEqual(list)
    for (const item of list.slice(0, 2)) expect(() => transitionMemory(item, "expired", () => now)).toThrow()
    expect(() => expireDue(list, "bad")).toThrow()
  })
  it("filters all inactive statuses", () => {
    expect(activeMemories(statuses.map(status => record(status, status))).map(item => item.id)).toEqual(["active"])
  })
  it("reports one conflict for either direction, excludes inactive and never resolves", () => {
    const a = { ...record(), relations: [{ type: "contradicts" as const, targetId: "b" }] }
    const b = { ...record("active", "b"), relations: [{ type: "contradicts" as const, targetId: "a" }] }
    const list = [a, b], before = structuredClone(list)
    expect(detectConflicts(list)).toEqual([{ a: "a", b: "b", relation: "contradicts", since: a.updatedAt }])
    for (const resolved of [a, b]) {
      const resolutions = [{ ofConflictWith: resolved === a ? b.id : a.id, decision: "both-intentional" as const, by: "owner", at: a.updatedAt }]
      expect(detectConflicts(list.map(item => item === resolved ? { ...item, resolutions } : item))).toEqual([])
    }
    expect(detectConflicts([a, { ...b, relations: [] }])).toHaveLength(1)
    for (const status of statuses.filter(status => status !== "active")) expect(detectConflicts([a, { ...b, status }])).toEqual([])
    expect(list).toEqual(before)
  })
  it.each([{ status: "bad" }, { transitions: [{ at: "bad", from: "active", to: "expired", source: { kind: "user" } }] },
    { transitions: null }, { supersedesId: "../bad" }])("strictly validates lifecycle fields %j", patch => {
    expect(() => validateMemories([{ ...record(), ...patch }])).toThrow()
  })
})
