import { beforeEach, describe, expect, it, vi } from "vitest"
const state = vi.hoisted(() => ({ files: new Map<string, string>(), write: vi.fn() }))
vi.mock("@/commands/fs", () => ({
  fileExists: async (path: string) => state.files.has(path),
  readFile: async (path: string) => {
    if (!state.files.has(path)) throw new Error("ENOENT")
    return state.files.get(path)
  },
  createDirectory: async () => {},
  writeFileAtomic: state.write,
}))
import { documents } from "./documents"
import {
  recordSuccessfulIngest,
  registerImportedSource,
  hashReceiptRevision,
  loadIngestRecords,
} from "./receipts"
const input = {
  projectPath: "/p",
  taskId: "task",
  sourcePath: "/p/raw/sources/a.md",
  revision: "v1",
  writtenPaths: ["wiki/a.md"],
  createdPages: {},
  cacheHit: false,
}
beforeEach(() => {
  state.files.clear()
  vi.resetAllMocks()
  state.write.mockImplementation(async (path: string, value: string) => {
    state.files.set(path, value)
  })
})
describe("document catalog adapter", () => {
  it("keeps source identity and original registration when imported repeatedly", async () => {
    await registerImportedSource("/p", input.sourcePath, "/vault/a.md")
    const previous = (await documents.list("/p"))[input.sourcePath]
    await registerImportedSource("/p", input.sourcePath, "/different/a.md")
    expect((await documents.list("/p"))[input.sourcePath]).toEqual(previous)
  })
  it("reads idempotent version history from existing receipts without a data migration", async () => {
    await registerImportedSource("/p", input.sourcePath, "/vault/a.md")
    const source = (await documents.list("/p"))[input.sourcePath]
    await recordSuccessfulIngest(input)
    await recordSuccessfulIngest(input)
    await recordSuccessfulIngest({ ...input, revision: "v2" })
    const versions = await documents.revisions("/p", input.sourcePath)
    expect(versions).toHaveLength(2)
    expect(versions.map((v) => v.sourceId)).toEqual([source.id, source.id])
    expect(versions[0]).toMatchObject({
      revision: "v1",
      taskId: "task",
      outputPaths: ["wiki/a.md"],
    })
    expect((await documents.list("/p"))[input.sourcePath].receivedAt).toBe(source.receivedAt)
    expect(await documents.revisions("/other", input.sourcePath)).toEqual([])
  })
  it("keeps legacy cache-hit timestamps unknown", async () => {
    await recordSuccessfulIngest({ ...input, cacheHit: true })
    expect((await documents.revisions("/p", input.sourcePath))[0].firstIngestedAt).toBeNull()
  })
  it("serializes registration and receipts across equivalent project path spellings", async () => {
    const sourcePath = "C:/p/raw/sources/a.md"
    await Promise.all([
      registerImportedSource("C:\\p", sourcePath, "C:/vault/a.md"),
      recordSuccessfulIngest({ ...input, projectPath: "C:/p", sourcePath }),
    ])
    const records = await loadIngestRecords("C:/p")
    const source = records.sources[sourcePath]
    expect(source.originalPath).toBe("C:/vault/a.md")
    expect(Object.values(records.receipts)[0].sourceId).toBe(source.id)
  })
  it("preserves corrupt metadata rather than overwriting it", async () => {
    state.files.set("/p/.llm-wiki/ingest-records.json", "corrupt")
    await expect(registerImportedSource("/p", input.sourcePath, "/a.md")).rejects.toThrow()
    expect(state.files.get("/p/.llm-wiki/ingest-records.json")).toBe("corrupt")
    expect(state.write).not.toHaveBeenCalled()
  })
  it("retains the SHA-256 revision format", async () => {
    expect(await hashReceiptRevision("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    )
  })
})

describe("observed source and move metadata workflow", () => {
  it("enriches a watcher self-location without changing the source ID or first time", async () => {
    const { registerObservedSourcePaths } = await import("./source-paths")
    await registerObservedSourcePaths("/p", ["raw/sources/a.md"])
    const first = (await documents.list("/p"))[input.sourcePath]
    await registerImportedSource("/p", input.sourcePath, "/vault/original.md")
    const next = (await documents.list("/p"))[input.sourcePath]
    expect(next).toEqual({ ...first, originalPath: "/vault/original.md" })
  })
  it("moves source and summary references while preserving revision identity and historical receipts", async () => {
    const { migrateSourceMetadata } = await import("./source-paths")
    await registerImportedSource("/p", input.sourcePath, "/vault/a.md")
    const id = await recordSuccessfulIngest({
      ...input,
      writtenPaths: ["wiki/sources/a.md"],
      createdPages: { "wiki/sources/a.md": "2026-10-31T00:00:00Z" },
    })
    const before = await loadIngestRecords("/p")
    const source = before.sources[input.sourcePath]
    const nextPath = "/p/raw/sources/moved.md"
    expect(
      await migrateSourceMetadata(
        "/p",
        input.sourcePath,
        nextPath,
        new Map([["wiki/sources/a.md", "wiki/sources/moved.md"]]),
      ),
    ).toBe(true)
    const next = await loadIngestRecords("/p")
    expect(next.sources[nextPath]).toEqual(source)
    expect(next.sources[input.sourcePath]).toBeUndefined()
    expect(next.pages["wiki/sources/moved.md"]).toEqual({
      createdAt: "2026-10-31T00:00:00Z",
      sources: [nextPath],
    })
    expect(next.receipts[id]).toEqual(before.receipts[id])
    expect((await documents.revisions("/p", nextPath))[0].sourceId).toBe(source.id)
    expect(await migrateSourceMetadata("/p", input.sourcePath, nextPath)).toBe(false)
  })
  it("refuses to replace an independently registered destination", async () => {
    const { migrateSourceMetadata } = await import("./source-paths")
    await registerImportedSource("/p", input.sourcePath, "/vault/a.md")
    await registerImportedSource("/p", "/p/raw/sources/b.md", "/vault/b.md")
    const before = JSON.stringify(await documents.list("/p"))
    await expect(
      migrateSourceMetadata("/p", input.sourcePath, "/p/raw/sources/b.md"),
    ).rejects.toThrow("another source")
    expect(JSON.stringify(await documents.list("/p"))).toBe(before)
  })
})

it("registers a watcher batch in one write and avoids rewriting unchanged sources", async () => {
  const { registerObservedSourcePaths } = await import("./source-paths")
  const paths = Array.from({ length: 25 }, (_, i) => `raw/sources/${i}.md`)
  await registerObservedSourcePaths("/p", paths)
  expect(state.write).toHaveBeenCalledTimes(1)
  expect(Object.keys(await documents.list("/p"))).toHaveLength(25)
  await registerObservedSourcePaths("/p", paths)
  expect(state.write).toHaveBeenCalledTimes(1)
})
