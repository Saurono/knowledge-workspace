import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
const state = vi.hoisted(() => ({
  files: new Map<string, string>(),
  io: { createDirectory: vi.fn(), fileExists: vi.fn(), readFile: vi.fn(), writeFile: vi.fn(), writeFileAtomic: vi.fn(), listFileHistory: vi.fn(), restoreFileHistory: vi.fn() },
}))
vi.mock("@/commands/fs", () => ({ ...state.io }))
import { withWikiProjectCommit } from "./commit"
import { writeWikiEditorPage } from "./pages"
import { restoreProjectFileHistory } from "./history"
const recordsPath = "/p/.llm-wiki/ingest-records.json"
const readRecords = () => JSON.parse(state.files.get(recordsPath) ?? "{}") as {
  pages?: Record<string, { createdAt: string | null; sources: string[] }>
}
describe("Wiki provenance public write entrypoints", () => {
  beforeEach(() => {
    state.files.clear()
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-11-05T01:00:00.000Z"))
    vi.resetAllMocks()
    state.io.createDirectory.mockResolvedValue(undefined)
    state.io.fileExists.mockImplementation(async (path: string) => state.files.has(path))
    state.io.readFile.mockImplementation(async (path: string) => {
      const content = state.files.get(path)
      if (content === undefined) throw new Error("ENOENT")
      return content
    })
    for (const write of [state.io.writeFile, state.io.writeFileAtomic])
      write.mockImplementation(async (path: string, content: string) => { state.files.set(path, content) })
    state.io.listFileHistory.mockResolvedValue([])
    state.io.restoreFileHistory.mockImplementation(async (_projectPath: string, path: string) => {
      state.files.set(path, "# historical body")
      return "# historical body"
    })
  })
  afterEach(() => { vi.useRealTimers() })
  it("records generation and preserves first time through editor and deleted-page restore", async () => {
    const createdAt = "2026-11-05T01:00:00.000Z"
    await withWikiProjectCommit("/p", async (commit) => {
      await commit.write("/p/wiki/new.md", "---\ntitle: New\n---\n\nGenerated body")
    })
    expect(readRecords().pages?.["wiki/new.md"]?.createdAt).toBe(createdAt)
    vi.setSystemTime(new Date("2026-11-05T02:00:00.000Z"))
    await writeWikiEditorPage("/p", "/p/wiki/new.md", "# Edited body")
    expect(readRecords().pages?.["wiki/new.md"]?.createdAt).toBe(createdAt)
    state.files.delete("/p/wiki/new.md")
    vi.setSystemTime(new Date("2026-11-05T03:00:00.000Z"))
    await restoreProjectFileHistory("/p", "/p/wiki/new.md", "history-id")
    expect(state.files.get("/p/wiki/new.md")).toBe("# historical body")
    expect(readRecords().pages?.["wiki/new.md"]?.createdAt).toBe(createdAt)
  })
  it("keeps legacy editor and unrecorded historical restoration times unknown", async () => {
    state.files.set("/p/wiki/legacy.md", "# Legacy body")
    await writeWikiEditorPage("/p", "/p/wiki/legacy.md", "# Edited legacy body")
    expect(readRecords().pages?.["wiki/legacy.md"]?.createdAt).toBeNull()
    await restoreProjectFileHistory("/p", "/p/wiki/deleted-old.md", "old-history-id")
    expect(state.files.get("/p/wiki/deleted-old.md")).toBe("# historical body")
    expect(readRecords().pages?.["wiki/deleted-old.md"]?.createdAt).toBeNull()
  })
  it("rejects metadata failure while retaining the successfully written page", async () => {
    state.io.writeFileAtomic.mockImplementation(async (path: string, content: string) => {
      if (path === recordsPath) throw new Error("metadata write failed")
      state.files.set(path, content)
    })
    await expect(writeWikiEditorPage("/p", "/p/wiki/metadata-failure.md", "# Kept body"))
      .rejects.toThrow("metadata write failed")
    expect(state.files.get("/p/wiki/metadata-failure.md")).toBe("# Kept body")
  })
})
