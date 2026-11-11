import { describe, expect, it } from "vitest"
import { createMemoryService, type MemoryRepository, type MemoryRecord } from "../application"
import { createMemoryRecord, validateMemories } from "../domain/model"
const record = (id: string): MemoryRecord => createMemoryRecord({
  id,
  title: id,
  content: "Content",
  category: "",
  domainIds: [],
  relatedIds: [],
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
})
function repository(initial: MemoryRecord[]): MemoryRepository {
  let records = initial
  return {
    read: async () => structuredClone(records),
    update: async (_path, change) => {
      records = change(structuredClone(records))
      return structuredClone(records)
    },
  }
}
describe("memory application service", () => {
  it("versions metadata with matching revisions and preserves no-op timestamps", async () => {
    const base = record("a"), at = "2026-11-11T00:00:00Z"
    const service = createMemoryService(repository([base, record("b")]), () => at)
    await service.save("p", { ...base, relatedIds: ["b"] })
    const related = (await service.list("p")).find(item => item.id === "a")!
    expect(related.version).toBe(base.version + 1)
    expect(related.updatedAt).toBe(at)
    expect(related.revisions).toHaveLength(base.revisions.length + 1)
    expect(related.revisions[related.revisions.length - 1]).toMatchObject({ version: related.version, title: base.title, content: base.content, at, changeNote: "metadata" })
    expect(Date.parse(related.updatedAt)).toBeGreaterThan(Date.parse(base.updatedAt))
    expect(validateMemories([related])).toEqual([related])
    await service.save("p", related)
    expect((await service.list("p")).find(item => item.id === "a")).toEqual(related)
    await service.save("p", { ...related, importance: 0.9 })
    const important = (await service.list("p")).find(item => item.id === "a")!
    expect(important.version).toBe(related.version + 1)
    expect(important.revisions).toHaveLength(related.revisions.length + 1)
    expect(important.revisions[important.revisions.length - 1]).toMatchObject({ version: important.version, title: base.title, content: base.content, changeNote: "metadata" })
    await service.save("p", { ...important, title: "new title" })
    const titled = (await service.list("p")).find(item => item.id === "a")!
    expect(titled.version).toBe(important.version + 1)
    expect(titled.revisions).toHaveLength(important.revisions.length + 1)
  })
  it("resolves on the smaller id, preserves evidence, replays and rejects inactive or missing records", async () => {
    const service = createMemoryService(repository([record("b"), record("a")]))
    const source = { kind: "user" as const, actorId: "owner" }
    const first = await service.resolve("/project", "b", "a", "merged", source, "checked")
    expect(first.find(m => m.id === "a")?.resolutions).toEqual([{ ofConflictWith: "b", decision: "merged", by: "owner", at: expect.any(String), note: "checked" }])
    expect(first.find(m => m.id === "b")?.resolutions).toBeUndefined()
    expect(first.every(m => m.status === "active" && m.relations.length === 0)).toBe(true)
    expect(await service.resolve("/project", "a", "b", "merged", source)).toEqual(first)
    await expect(service.resolve("/project", "a", "missing", "merged", source)).rejects.toThrow()
    await service.archive("/project", "b", source)
    await expect(service.resolve("/project", "a", "b", "merged", source)).rejects.toThrow()
  })
  it("promotes, supersedes atomically and archives with idempotent audit", async () => {
    const at = "2026-11-10T00:00:00Z", source = { kind: "system" as const, actorId: "governor" }
    const service = createMemoryService(repository([{ ...record("a"), status: "candidate" }, record("b")]), () => at)
    await service.promote("/project", "a", source)
    const promoted = (await service.list("/project"))[0]
    expect(promoted.transitions[promoted.transitions.length - 1]).toMatchObject({ from: "candidate", to: "active", at, source: promoted.source })
    const replaced = await service.supersede("/project", "a", "b", source)
    expect(replaced[0]).toMatchObject({ status: "superseded", supersededById: "b" })
    expect(replaced[1]).toMatchObject({ status: "active", supersedesId: "a" })
    expect(replaced[0].transitions[replaced[0].transitions.length - 1]).toMatchObject({ from: "active", to: "superseded", at, source: replaced[0].source })
    expect(replaced[1].transitions[replaced[1].transitions.length - 1]).toMatchObject({ from: "active", to: "active", at, source: replaced[1].source })
    expect(await service.supersede("/project", "a", "b", source)).toEqual(replaced)
    const archived = await service.archive("/project", "a", source)
    expect(archived[0].transitions[archived[0].transitions.length - 1]).toMatchObject({ from: "superseded", to: "archived", at, source: archived[0].source })
    expect(await service.archive("/project", "a", source)).toEqual(archived)
    expect(await service.supersede("/project", "a", "b", source)).toEqual(archived)
    expect(archived.map(item => item.version)).toEqual([1, 1])
  })
  it("rejects missing/inactive replacement and invalid transitions without partial writes", async () => {
    const initial = [record("a"), { ...record("b"), status: "candidate" as const }]
    const service = createMemoryService(repository(initial))
    for (const id of ["missing", "b", "a"]) await expect(service.supersede("/project", "a", id, { kind: "user" })).rejects.toThrow()
    await expect(service.supersede("/project", "b", "a", { kind: "user" })).rejects.toThrow()
    await expect(service.promote("/project", "a", { kind: "user" })).rejects.toThrow()
    await expect(service.archive("/project", "missing", { kind: "user" })).rejects.toThrow()
    expect(await service.list("/project")).toEqual(initial)
  })
  it("expires inclusively through validated repository writes", async () => {
    const at = "2026-11-10T00:00:00Z"
    const service = createMemoryService(repository([{ ...record("a"), validity: { until: at } }, record("b")]))
    const result = await service.expireDue("/project", at)
    expect(result.map(item => item.status)).toEqual(["expired", "active"])
    expect(result[0].transitions[result[0].transitions.length - 1]?.at).toBe(at)
    expect(await service.expireDue("/project", at)).toEqual(result)
  })
  it("preserves first creation time and normalizes relation updates", async () => {
    const service = createMemoryService(repository([record("a"), record("b")]))
    await service.save("/project", {
      ...record("a"),
      title: " Updated ",
      createdAt: "2026-10-31T00:00:00Z",
      relatedIds: ["a", "b", "b"],
      domainIds: ["d", "d"],
    })
    const saved = (await service.list("/project")).find((m) => m.id === "a")!
    expect(saved.createdAt).toBe("2026-10-01T00:00:00Z")
    expect(saved.title).toBe("Updated")
    expect(saved.version).toBe(2)
    expect(saved.revisions).toHaveLength(2)
    expect(saved.revisions[1]).toMatchObject({ version: 2, title: "Updated", at: saved.updatedAt })
    expect(validateMemories([saved])).toEqual([saved])
    expect(saved.relatedIds).toEqual(["b"])
    expect(saved.domainIds).toEqual(["d"])
  })
  it("removes references to deleted memory while preserving other content", async () => {
    const service = createMemoryService(
      repository([{ ...record("a"), relatedIds: ["b"] }, record("b")]),
    )
    await service.remove("/project", "b")
    expect(await service.list("/project")).toEqual([{ ...record("a"), relatedIds: [] }])
  })
  it("rejects invalid content before changing repository state", async () => {
    const service = createMemoryService(repository([record("a")]))
    await expect(service.save("/project", { ...record("a"), content: " " })).rejects.toThrow()
    expect((await service.list("/project"))[0].content).toBe("Content")
  })
})
