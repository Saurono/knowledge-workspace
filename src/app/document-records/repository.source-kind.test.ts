import { describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({ body: "" }))
vi.mock("@/commands/fs", () => ({
  createDirectory: vi.fn(), writeFileAtomic: vi.fn(),
  fileExists: async () => true,
  readFile: async () => state.body,
}))

import { loadIngestRecords } from "./repository"

const makeRecords = (source: Record<string, unknown>) => ({
  version: 1,
  projectRootPath: "C:/project",
  vaultPath: null,
  sources: { "C:/project/wiki/queries/q.md": { id: "source-1", originalPath: null, receivedAt: null, ingestedAt: null, ...source } },
  pages: {},
  receipts: {},
})

describe("source kind record compatibility", () => {
  it("keeps legacy records without sourceKind unknown by omission", async () => {
    state.body = JSON.stringify(makeRecords({}))
    const loaded = await loadIngestRecords("C:/project")
    expect(loaded.sources["C:/project/wiki/queries/q.md"]).not.toHaveProperty("sourceKind")
  })

  it.each(["generated-wiki", "raw", "unknown"] as const)("accepts sourceKind %s", async sourceKind => {
    state.body = JSON.stringify(makeRecords({ sourceKind }))
    await expect(loadIngestRecords("C:/project")).resolves.toMatchObject({ sources: { "C:/project/wiki/queries/q.md": { sourceKind } } })
  })

  it("rejects invalid sourceKind without replacing persisted records", async () => {
    state.body = JSON.stringify(makeRecords({ sourceKind: "looks-like-raw" }))
    await expect(loadIngestRecords("C:/project")).rejects.toThrow("Invalid ingest records; original file preserved")
    expect(state.body).toContain("looks-like-raw")
  })
})
