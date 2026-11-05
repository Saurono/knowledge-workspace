import { beforeEach, describe, expect, it, vi } from "vitest"
const state = vi.hoisted(() => ({
  files: new Map<string, string>(),
  write: vi.fn(),
  merge: vi.fn(),
}))
vi.mock("@/commands/fs", () => ({
  listDirectory: async () =>
    [...state.files.keys()]
      .filter((path) => path.includes("/wiki/") && path.endsWith(".md"))
      .map((path) => ({ name: path.split("/").pop(), path, is_dir: false })),
  readFile: async (path: string) => {
    if (!state.files.has(path)) throw new Error("ENOENT")
    return state.files.get(path)
  },
  writeFile: state.write,
  createDirectory: async () => {},
  writeFileAtomic: async (path: string, content: string) => { state.files.set(path, content) },
  fileExists: async (path: string) => state.files.has(path),
  deleteFile: async (path: string) => {
    state.files.delete(path)
  },
}))
vi.mock("./dedup", async () => ({
  ...(await vi.importActual<typeof import("./dedup")>("./dedup")),
  mergeDuplicateGroup: state.merge,
}))
import { executeMerge } from "./dedup-runner"
import type { LlmConfig } from "@/stores/wiki-store"
import type { DuplicateGroup, MergeResult } from "./dedup"
const result: MergeResult = {
  canonicalPath: "wiki/entities/a.md",
  canonicalContent: "merged",
  rewrites: [],
  pagesToDelete: ["wiki/entities/b.md"],
  backup: [
    { path: "wiki/entities/a.md", content: "a" },
    { path: "wiki/entities/b.md", content: "b" },
  ],
}
const group = { slugs: ["a", "b"], canonical: "a", reason: "same" } as unknown as DuplicateGroup
beforeEach(() => {
  state.files.clear()
  vi.resetAllMocks()
  state.files.set("/p/wiki/entities/a.md", "a")
  state.files.set("/p/wiki/entities/b.md", "b")
  state.files.set("/p/wiki/index.md", "# Index\n- [[a]]\n- [[b]]\n")
  state.merge.mockResolvedValue(result)
  state.write.mockImplementation(async (path: string, content: string) => {
    state.files.set(path, content)
  })
})
describe("dedup generated commit", () => {
  it("rejects a stale model snapshot before any backup or destructive writes", async () => {
    state.merge.mockImplementation(async () => {
      state.files.set("/p/wiki/entities/a.md", "human edit")
      return result
    })
    await expect(executeMerge("/p", group, "a", {} as LlmConfig)).rejects.toThrow(
      "changed during merge",
    )
    expect(state.write).not.toHaveBeenCalled()
    expect(state.files.get("/p/wiki/entities/a.md")).toBe("human edit")
    expect(state.files.has("/p/wiki/entities/b.md")).toBe(true)
  })
  it("preserves navigation added during model preparation", async () => {
    state.merge.mockImplementation(async (request) => {
      expect(request.otherWikiPages.some((page: { path: string }) => page.path === "wiki/index.md")).toBe(false)
      state.files.set("/p/wiki/index.md", "# Index\n- [[a]]\n- [[b]]\n- [[new]]\n")
      return result
    })
    await executeMerge("/p", group, "a", {} as LlmConfig)
    expect(state.files.get("/p/wiki/index.md")).toContain("[[new]]")
    expect(state.files.get("/p/wiki/index.md")).not.toContain("[[b]]")
    expect(state.files.get("/p/wiki/index.md")?.match(/\[\[a\]\]/g)).toHaveLength(1)
    expect(state.files.get("/p/wiki/entities/a.md")).toBe("merged")
  })
  it("does not start a prepared merge after cancellation", async () => {
    const owner = new AbortController()
    state.merge.mockImplementation(async () => {
      owner.abort()
      return result
    })
    await expect(
      executeMerge("/p", group, "a", {} as LlmConfig, { signal: owner.signal }),
    ).rejects.toMatchObject({ name: "AbortError" })
    expect(state.write).not.toHaveBeenCalled()
    expect(state.files.has("/p/wiki/entities/b.md")).toBe(true)
  })
})
