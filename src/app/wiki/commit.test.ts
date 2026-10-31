import { beforeEach, describe, expect, it, vi } from "vitest"
import { createDeferred, flushMicrotasks } from "@/test-helpers/deferred"
const files = vi.hoisted(() => new Map<string, string>())
const io = vi.hoisted(() => ({ write: vi.fn(), atomic: vi.fn(), read: vi.fn(), exists: vi.fn() }))
vi.mock("@/commands/fs", () => ({
  readFile: io.read,
  writeFile: io.write,
  writeFileAtomic: io.atomic,
  fileExists: io.exists,
}))
import { withWikiProjectCommit, type ProjectWikiCommit } from "./commit"
import { wikiPages } from "./pages"
beforeEach(() => {
  files.clear()
  vi.resetAllMocks()
  io.read.mockImplementation(async (path: string) => {
    if (!files.has(path)) throw new Error("ENOENT")
    return files.get(path)
  })
  io.exists.mockImplementation(async (path: string) => files.has(path))
  for (const write of [io.write, io.atomic])
    write.mockImplementation(async (path: string, content: string) => {
      files.set(path, content)
    })
})
describe("native Wiki commit adapter", () => {
  it("performs multiple reads/writes without reacquiring its non-reentrant lock", async () => {
    files.set("/p/wiki/a.md", "old")
    await withWikiProjectCommit("/p", async (commit) => {
      await commit.write("/p/wiki/a.md", (await commit.read("/p/wiki/a.md")) + " new")
      await commit.write("/p/wiki/b.md", "second")
    })
    expect(files.get("/p/wiki/a.md")).toBe("old new")
    expect(files.get("/p/wiki/b.md")).toBe("second")
  })
  it("serializes with the existing editor repository", async () => {
    const gate = createDeferred<void>()
    const first = withWikiProjectCommit("/p", async (commit) => {
      await gate.promise
      await commit.write("/p/wiki/a.md", "generated")
    })
    const editor = wikiPages.save({ projectPath: "/p", path: "wiki/a.md", content: "edited" })
    await flushMicrotasks()
    expect(io.atomic).not.toHaveBeenCalled()
    gate.resolve()
    await Promise.all([first, editor])
    expect(files.get("/p/wiki/a.md")).toBe("edited")
  })
  it("does not lose two concurrent index updates", async () => {
    files.set("/p/wiki/index.md", "I")
    const gate = createDeferred<void>()
    const first = withWikiProjectCommit("/p", async (commit) => {
      const content = await commit.read("/p/wiki/index.md")
      await gate.promise
      await commit.write("/p/wiki/index.md", content + " A")
    })
    const second = withWikiProjectCommit("/p", async (commit) => {
      const content = await commit.read("/p/wiki/index.md")
      await commit.write("/p/wiki/index.md", content + " B")
    })
    await flushMicrotasks()
    expect(io.read).toHaveBeenCalledTimes(1)
    gate.resolve()
    await Promise.all([first, second])
    expect(files.get("/p/wiki/index.md")).toBe("I A B")
  })
  it("preserves completed writes and releases the scope after a later failure", async () => {
    await expect(
      withWikiProjectCommit("/p", async (commit) => {
        await commit.write("/p/wiki/a.md", "keep")
        throw new Error("later failure")
      }),
    ).rejects.toThrow("later failure")
    await withWikiProjectCommit("/p", async (commit) => {
      await commit.write("/p/wiki/b.md", "retry")
    })
    expect(files.get("/p/wiki/a.md")).toBe("keep")
    expect(files.get("/p/wiki/b.md")).toBe("retry")
  })
  it("blocks foreign paths, sidecars and an escaped writer", async () => {
    let captured!: ProjectWikiCommit
    await withWikiProjectCommit("/p", async (commit) => {
      captured = commit
      await expect(commit.write("/other/wiki/a.md", "x")).rejects.toThrow("outside")
      await expect(commit.write("/p/.llm-wiki/cache.json", "x")).rejects.toThrow("inside wiki")
    })
    await expect(captured.write("/p/wiki/a.md", "late")).rejects.toThrow("closed")
    expect(io.write).not.toHaveBeenCalled()
  })
})
