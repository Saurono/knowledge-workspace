import { describe, expect, it } from "vitest"
import { createMemoryService, type MemoryRepository, type MemoryRecord } from "../application"
const record = (id: string): MemoryRecord => ({
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
