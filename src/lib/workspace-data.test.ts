import { beforeEach, describe, expect, it, vi } from "vitest"
const files = vi.hoisted(() => new Map<string, string>())
vi.mock("@/commands/fs", () => ({
  fileExists: vi.fn(async (path: string) => files.has(path)),
  readFile: vi.fn(async (path: string) => files.get(path)),
  createDirectory: vi.fn(async () => {}),
  writeFileAtomic: vi.fn(async (path: string, content: string) => {
    files.set(path, content)
  }),
}))
import {
  emptyWorkspaceData,
  loadWorkspaceData,
  removeDomain,
  removeMemory,
  updateWorkspaceData,
  type MemoryRecord,
} from "./workspace-data"
import { createMemoryRecord } from "@/modules/memory/domain"
beforeEach(() => files.clear())
describe("project workspace persistence", () => {
  it("serializes simultaneous updates and isolates projects", async () => {
    await Promise.all([
      updateWorkspaceData("/one", (data) => ({
        ...data,
        domains: [...data.domains, { id: "a", name: "A" }],
      })),
      updateWorkspaceData("/one", (data) => ({
        ...data,
        domains: [...data.domains, { id: "b", name: "B" }],
      })),
    ])
    expect((await loadWorkspaceData("/one")).domains).toHaveLength(2)
    expect((await loadWorkspaceData("/two")).domains).toHaveLength(0)
  })
  it("preserves a corrupt file and refuses to overwrite it", async () => {
    files.set("/one/.llm-wiki/workspace.json", "broken")
    await expect(updateWorkspaceData("/one", () => emptyWorkspaceData())).rejects.toThrow()
    expect(files.get("/one/.llm-wiki/workspace.json")).toBe("broken")
  })
  it("cleans domain and memory relationships without deleting other content", () => {
    const memory: MemoryRecord = createMemoryRecord({
      id: "a",
      title: "A",
      content: "Keep",
      category: "",
      domainIds: ["domain"],
      relatedIds: ["b"],
      createdAt: "2026-10-31T00:00:00Z",
      updatedAt: "2026-10-31T00:00:00Z",
    })
    const data = {
      ...emptyWorkspaceData(),
      domains: [{ id: "domain", name: "Domain" }],
      resourceDomains: { "wiki/a.md": ["domain"] },
      memories: [memory, { ...memory, id: "b", relatedIds: ["a"] }],
    }
    const cleaned = removeDomain(data, "domain")
    expect(cleaned.memories[0].content).toBe("Keep")
    expect(cleaned.memories[0].domainIds).toEqual([])
    expect(cleaned.resourceDomains["wiki/a.md"]).toEqual([])
    expect(removeMemory(data, "b").memories[0].relatedIds).toEqual([])
  })
})
