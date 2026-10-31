import { beforeEach, describe, expect, it, vi } from "vitest"
const files = vi.hoisted(() => new Map<string, string>())
const io = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), exists: vi.fn() }))
vi.mock("@/commands/fs", () => ({
  readFile: io.read,
  writeFileAtomic: io.write,
  fileExists: io.exists,
  createDirectory: async () => {},
}))
import { wikiPages, isWikiTextPath, readWikiEditorPage, writeWikiEditorPage } from "./pages"
import { WikiRevisionConflict } from "@/modules/wiki/domain"
beforeEach(() => {
  files.clear()
  vi.resetAllMocks()
  io.read.mockImplementation(async (path: string) => {
    if (!files.has(path)) throw new Error("ENOENT")
    return files.get(path)
  })
  io.write.mockImplementation(async (path: string, value: string) => {
    files.set(path, value)
  })
  io.exists.mockImplementation(async (path: string) => files.has(path))
})
describe("Wiki page repository and revision contracts", () => {
  it("reads exact content with a deterministic revision and retains editor compatibility", async () => {
    files.set("/p/wiki/a.md", "abc")
    const page = await wikiPages.read("/p", "wiki/a.md")
    expect(page).toMatchObject({
      path: "wiki/a.md",
      content: "abc",
      revision: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    })
    expect(await readWikiEditorPage("/p", "/p/wiki/a.md")).toBe("abc")
    await writeWikiEditorPage("/p", "/p/wiki/a.md", "updated")
    expect(files.get("/p/wiki/a.md")).toBe("updated")
  })
  it("permits only one concurrent writer against the same revision", async () => {
    files.set("/p/wiki/a.md", "initial")
    const initial = await wikiPages.read("/p", "wiki/a.md")
    const results = await Promise.allSettled([
      wikiPages.save({
        projectPath: "/p",
        path: "wiki/a.md",
        content: "first",
        expectedRevision: initial.revision,
      }),
      wikiPages.save({
        projectPath: "/p",
        path: "wiki/a.md",
        content: "second",
        expectedRevision: initial.revision,
      }),
    ])
    expect(results[0].status).toBe("fulfilled")
    expect(results[1].status).toBe("rejected")
    expect(results[1]).toMatchObject({ reason: expect.any(WikiRevisionConflict) })
    expect(files.get("/p/wiki/a.md")).toBe("first")
    expect(io.write).toHaveBeenCalledTimes(1)
  })
  it("treats a null expected revision as create-only and never overwrites an existing page", async () => {
    await wikiPages.save({
      projectPath: "/p",
      path: "wiki/new.md",
      content: "new",
      expectedRevision: null,
    })
    await expect(
      wikiPages.save({
        projectPath: "/p",
        path: "wiki/new.md",
        content: "overwrite",
        expectedRevision: null,
      }),
    ).rejects.toBeInstanceOf(WikiRevisionConflict)
    expect(files.get("/p/wiki/new.md")).toBe("new")
  })
  it("does not overwrite unreadable existing content", async () => {
    files.set("/p/wiki/a.md", "keep")
    io.read.mockRejectedValueOnce(new Error("permission denied"))
    await expect(
      wikiPages.save({ projectPath: "/p", path: "wiki/a.md", content: "overwrite" }),
    ).rejects.toThrow("permission denied")
    expect(io.write).not.toHaveBeenCalled()
  })
  it.each(["wiki/../outside.md", "/wiki/a.md", "wiki//a.md", "raw/a.md", "wiki/a.pdf"])(
    "rejects invalid storage path %s before platform I/O",
    async (path) => {
      await expect(wikiPages.save({ projectPath: "/p", path, content: "x" })).rejects.toThrow(
        "inside wiki",
      )
      expect(io.write).not.toHaveBeenCalled()
      expect(io.exists).not.toHaveBeenCalled()
    },
  )
  it("keeps raw sources and other projects outside the editor Wiki adapter", async () => {
    expect(isWikiTextPath("/p", "/p/wiki/a.md")).toBe(true)
    expect(isWikiTextPath("/p", "/p/raw/a.md")).toBe(false)
    expect(isWikiTextPath("/p", "/other/wiki/a.md")).toBe(false)
    await expect(writeWikiEditorPage("/p", "/other/wiki/a.md", "x")).rejects.toThrow("outside")
  })
})

it("serializes concurrent pure repairs and skips unchanged writes", async () => {
  files.set("/p/wiki/a.md", "initial")
  await Promise.all([
    wikiPages.transform("/p", "wiki/a.md", (text) => text + " A"),
    wikiPages.transform("/p", "wiki/a.md", (text) => text + " B"),
  ])
  expect(files.get("/p/wiki/a.md")).toBe("initial A B")
  expect(io.write).toHaveBeenCalledTimes(2)
  expect((await wikiPages.transform("/p", "wiki/a.md", (text) => text)).changed).toBe(false)
  expect(io.write).toHaveBeenCalledTimes(2)
})
it("creates only one placeholder under concurrent repair requests", async () => {
  const { ensureBrokenLinkStub } = await import("@/lib/lint-fixes")
  const results = await Promise.all([
    ensureBrokenLinkStub("/p", "missing"),
    ensureBrokenLinkStub("/p", "missing"),
  ])
  expect(results.filter((result) => result.created)).toHaveLength(1)
  expect(io.write).toHaveBeenCalledTimes(1)
})
