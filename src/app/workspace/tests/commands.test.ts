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
import { executeWorkspaceCommand } from "../services"
import { loadWorkspaceData, updateWorkspaceData } from "../json-repository"
import type { MemoryRecord } from "../snapshot"
beforeEach(() => files.clear())
describe("version-one workspace module adapters", () => {
  it("coordinates domain deletion across modules in one persisted update", async () => {
    const memory: MemoryRecord = {
      id: "m",
      title: "M",
      content: "Keep",
      category: "",
      domainIds: ["d"],
      relatedIds: [],
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    }
    await executeWorkspaceCommand("/p", { type: "domain.add", tag: { id: "d", name: "Domain" } })
    await executeWorkspaceCommand("/p", { type: "memory.save", record: memory })
    await executeWorkspaceCommand("/p", {
      type: "domain.toggle",
      resourcePath: "wiki/a.md",
      domainId: "d",
    })
    const result = await executeWorkspaceCommand("/p", { type: "domain.remove", id: "d" })
    expect(result.memories[0].content).toBe("Keep")
    expect(result.memories[0].domainIds).toEqual([])
    expect(result.resourceDomains["wiki/a.md"]).toEqual([])
    expect((await loadWorkspaceData("/other")).memories).toEqual([])
  })
  it("retains unknown top-level fields in legacy snapshots during module updates", async () => {
    files.set(
      "/p/.llm-wiki/workspace.json",
      JSON.stringify({
        version: 1,
        domains: [],
        resourceDomains: {},
        memories: [],
        extension: { keep: true },
      }),
    )
    await executeWorkspaceCommand("/p", { type: "domain.add", tag: { id: "d", name: "D" } })
    expect(JSON.parse(files.get("/p/.llm-wiki/workspace.json")!).extension).toEqual({ keep: true })
  })
  it("does not overwrite corrupt legacy files", async () => {
    files.set("/p/.llm-wiki/workspace.json", "invalid")
    await expect(updateWorkspaceData("/p", (data) => data)).rejects.toThrow()
    expect(files.get("/p/.llm-wiki/workspace.json")).toBe("invalid")
  })
})
