import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
const files = vi.hoisted(() => new Map<string, string>())
const io = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }))
vi.mock("@/commands/fs", () => ({
  readFile: io.read,
  writeFile: io.write,
  fileExists: async (path: string) => files.has(path),
}))
import { saveGeneratedQuery, saveGeneratedReviewPages } from "./generated-pages"
beforeEach(() => {
  files.clear()
  vi.resetAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-11-01T01:02:03Z"))
  io.read.mockImplementation(async (path: string) => {
    if (!files.has(path)) throw new Error("ENOENT")
    return files.get(path)
  })
  io.write.mockImplementation(async (path: string, content: string) => {
    files.set(path, content)
  })
})
afterEach(() => vi.useRealTimers())
describe("generated page publication", () => {
  it("allocates different names for concurrent same-second saves and preserves both index/log entries", async () => {
    const pages = await Promise.all([
      saveGeneratedQuery("/p", "# Topic\n\nFirst"),
      saveGeneratedQuery("/p", "# Topic\n\nSecond"),
    ])
    expect(new Set(pages.map((page) => page.filePath)).size).toBe(2)
    expect(pages[1].fileName).toMatch(/-2\.md$/)
    for (const page of pages) {
      expect(files.get(page.filePath)).toBe(page.pageContent)
      expect(files.get("/p/wiki/index.md")).toContain(page.fileName.replace(/\.md$/, ""))
      expect(files.get("/p/wiki/log.md")).toContain(page.fileName)
    }
  })
  it("preserves literal display titles, strips model-private blocks and reuses CRLF sections", async () => {
    files.set("/p/wiki/index.md", "# Wiki Index\r\n\r\n## Queries\r\n- existing\r\n")
    const page = await saveGeneratedQuery(
      "/p",
      "<think>private</think>\n<!-- save-worthy: yes -->\n# Price $& guide\nBody",
    )
    expect(page.pageContent).not.toContain("private")
    expect(page.pageContent).not.toContain("save-worthy")
    const index = files.get("/p/wiki/index.md")!
    expect(index).toContain("|Price $& guide]]")
    expect(index.match(/## Queries/g)).toHaveLength(1)
    expect(index).toContain("- existing")
  })
  it("retains review stable-name preference and falls back safely when it exists", async () => {
    const drafts = [{ title: "Alpha", pageType: "concept" as const, dir: "concepts" }]
    const [first] = await saveGeneratedReviewPages("/p", drafts, "First")
    const [second] = await saveGeneratedReviewPages("/p", drafts, "Second")
    const [third] = await saveGeneratedReviewPages("/p", drafts, "Third")
    expect(first.fileName).toBe("alpha.md")
    expect(second.fileName).toMatch(/^alpha-2026-11-01-010203\.md$/)
    expect(third.fileName).toMatch(/-2\.md$/)
    expect(files.get(first.filePath)).toContain("First")
  })
  it("reserves distinct names for repeated titles within one review batch", async () => {
    const draft = { title: "Alpha", pageType: "concept" as const, dir: "concepts" }
    const pages = await saveGeneratedReviewPages("/p", [draft, draft], "Body")
    expect(pages.map((page) => page.fileName)).toEqual(["alpha.md", "alpha-2026-11-01-010203.md"])
    expect(files.get("/p/wiki/log.md")).toContain("Created 2 pages")
  })
  it("does not replace unreadable existing navigation with a fabricated fallback", async () => {
    files.set("/p/wiki/index.md", "keep")
    io.read.mockRejectedValueOnce(new Error("permission denied"))
    await expect(saveGeneratedQuery("/p", "# Topic")).rejects.toThrow("permission denied")
    expect(io.write).not.toHaveBeenCalled()
    expect(files.get("/p/wiki/index.md")).toBe("keep")
  })
  it("retains a completed page when a later index write fails", async () => {
    io.write.mockImplementation(async (path: string, content: string) => {
      if (path.endsWith("/index.md")) throw new Error("disk full")
      files.set(path, content)
    })
    await expect(saveGeneratedQuery("/p", "# Topic\nBody")).rejects.toThrow("disk full")
    const pages = [...files.keys()].filter((path) => path.includes("/queries/"))
    expect(pages).toHaveLength(1)
    expect(files.get(pages[0])).toContain("Body")
  })
})
