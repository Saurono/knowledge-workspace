import { beforeEach, describe, expect, it, vi } from "vitest"
const files = vi.hoisted(() => new Map<string, string>())
const writes = vi.hoisted(() =>
  vi.fn(async (path: string, contents: string) => {
    files.set(path, contents)
  }),
)
vi.mock("@/commands/fs", () => ({
  fileExists: vi.fn(async (path: string) => files.has(path)),
  readFile: vi.fn(async (path: string) => {
    if (!files.has(path)) throw new Error("Missing file")
    return files.get(path)!
  }),
  createDirectory: vi.fn(async () => {}),
  writeFileAtomic: writes,
}))
import {
  configureObsidianVault,
  deliverObsidianReceipt,
  loadIngestRecords,
  recordSuccessfulIngest,
  registerImportedSource,
} from "./ingest-receipts"

const input = {
  projectPath: "/project",
  taskId: "task-1",
  sourcePath: "/project/raw/sources/note.md",
  revision: "revision-1",
  writtenPaths: ["wiki/concepts/example.md"],
  createdPages: { "wiki/concepts/example.md": "2026-10-31T01:00:00Z" },
  cacheHit: false,
}
beforeEach(() => {
  files.clear()
  writes.mockClear()
})
describe("Obsidian ingest receipts", () => {
  it("writes only independent receipts, preserves originals, and delivers idempotently", async () => {
    files.set("/vault/.obsidian", "directory")
    files.set("/vault/notes/note.md", "---\ntags: [mine]\n---\nOriginal text")
    await configureObsidianVault("/project", "/vault")
    await registerImportedSource("/project", input.sourcePath, "/vault/notes/note.md")
    const id = await recordSuccessfulIngest(input)
    await deliverObsidianReceipt("/project", id)
    await deliverObsidianReceipt("/project", id)
    const delivered = writes.mock.calls.filter(([path]) => path.startsWith("/vault/"))
    expect(delivered).toHaveLength(1)
    expect(delivered[0][0]).toMatch(/^\/vault\/kb-ingest-records\/.*\.json$/)
    const payload = JSON.parse(delivered[0][1])
    expect(payload.wikiResults[0].wikiCreatedAt).toBe("2026-10-31T01:00:00Z")
    expect(files.get("/vault/notes/note.md")).toBe("---\ntags: [mine]\n---\nOriginal text")
  })
  it("retains first ingest and creation times across source versions and shared pages", async () => {
    await recordSuccessfulIngest(input)
    const first = await loadIngestRecords("/project")
    await recordSuccessfulIngest({ ...input, revision: "revision-2", createdPages: {} })
    await recordSuccessfulIngest({
      ...input,
      sourcePath: "/project/raw/sources/other.md",
      createdPages: {},
    })
    const next = await loadIngestRecords("/project")
    expect(next.sources[input.sourcePath].ingestedAt).toBe(
      first.sources[input.sourcePath].ingestedAt,
    )
    expect(next.pages["wiki/concepts/example.md"].createdAt).toBe("2026-10-31T01:00:00Z")
    expect(next.pages["wiki/concepts/example.md"].sources).toHaveLength(2)
  })
  it("does not invent creation or first-ingest times for a legacy cache hit", async () => {
    const id = await recordSuccessfulIngest({ ...input, createdPages: {}, cacheHit: true })
    const records = await loadIngestRecords("/project")
    expect(records.sources[input.sourcePath].ingestedAt).toBeNull()
    expect(records.receipts[id].revisionIngestedAt).toBeNull()
    expect(records.pages["wiki/concepts/example.md"].createdAt).toBeNull()
  })
  it("keeps failed delivery pending without rerunning ingestion", async () => {
    files.set("/vault/.obsidian", "directory")
    await configureObsidianVault("/project", "/vault")
    await registerImportedSource("/project", input.sourcePath, "/vault/notes/note.md")
    const id = await recordSuccessfulIngest(input)
    files.delete("/vault/.obsidian")
    await deliverObsidianReceipt("/project", id)
    expect((await loadIngestRecords("/project")).receipts[id].delivery).toBe("pending")
    files.set("/vault/.obsidian", "directory")
    await deliverObsidianReceipt("/project", id)
    expect((await loadIngestRecords("/project")).receipts[id].delivery).toBe("delivered")
  })
  it("does not deliver one Vault's note paths to another connection", async () => {
    files.set("/vault/.obsidian", "directory")
    files.set("/other/.obsidian", "directory")
    await configureObsidianVault("/project", "/vault")
    await registerImportedSource("/project", input.sourcePath, "/vault/note.md")
    const id = await recordSuccessfulIngest(input)
    await configureObsidianVault("/project", "/other")
    await deliverObsidianReceipt("/project", id)
    expect(writes.mock.calls.some(([path]) => path.startsWith("/other/"))).toBe(false)
  })
})
