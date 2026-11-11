import { afterEach, describe, expect, it } from "vitest"
import { existsSync, mkdtempSync } from "node:fs"
import { mkdir, rm, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createProjectDocumentSourceLister, removeOrphanUploads, scanOrphanUploads } from "./orphan-uploads"

const roots: string[] = []
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "kw-orphans-"))
  roots.push(root)
  return root
}
async function upload(root: string, project: string, source: string, files: Record<string, string> = { "source.bin": "abc" }) {
  const path = join(root, "uploads", project, source)
  await mkdir(path, { recursive: true })
  for (const [name, contents] of Object.entries(files)) await writeFile(join(path, name), contents)
  return path
}
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

describe("orphan uploads", () => {
  it("scans two projects and four uploads without deleting; counts bytes and latest mtime", async () => {
    const root = fixture()
    await upload(root, "p1", "s1")
    await upload(root, "p1", "s2")
    await upload(root, "p2", "s3")
    const orphan = await upload(root, "p2", "s4", { "source.bin": "abc", "source.partial": "12345" })
    await utimes(join(orphan, "source.bin"), new Date("2020-01-01Z"), new Date("2020-01-01Z"))
    await utimes(join(orphan, "source.partial"), new Date("2021-01-01Z"), new Date("2021-01-01Z"))
    await mkdir(join(orphan, "deeper"))
    await writeFile(join(orphan, "deeper", "ignored"), "ignored")
    await writeFile(join(root, "uploads", "ignored-file"), "ignored")
    await writeFile(join(root, "uploads", "p1", "ignored-file"), "ignored")
    const result = await scanOrphanUploads({ root, listDocumentSourceIds: async p => p === "p1" ? ["s1", "s2"] : ["s3"] })
    expect(result).toEqual({ orphans: [{ projectId: "p2", sourceId: "s4", bytes: 8, modifiedAt: "2021-01-01T00:00:00.000Z" }], totalBytes: 8, scannedProjects: 2, scannedUploads: 4 })
    expect(existsSync(orphan)).toBe(true)
  })

  it("includes a partial-only upload", async () => {
    const root = fixture()
    await upload(root, "p", "partial", { "source.partial": "半截" })
    const result = await scanOrphanUploads({ root, listDocumentSourceIds: async () => [] })
    expect(result.orphans).toHaveLength(1)
    expect(result.orphans[0].bytes).toBe(Buffer.byteLength("半截"))
    expect(result.totalBytes).toBe(Buffer.byteLength("半截"))
  })

  it("returns empty results when uploads is absent", async () => {
    expect(await scanOrphanUploads({ root: fixture(), listDocumentSourceIds: async () => { throw new Error("must not call") } }))
      .toEqual({ orphans: [], totalBytes: 0, scannedProjects: 0, scannedUploads: 0 })
  })

  it("removes only the supplied orphan and preserves a referenced upload", async () => {
    const root = fixture()
    const orphan = await upload(root, "p", "orphan")
    const kept = await upload(root, "p", "kept")
    const scan = await scanOrphanUploads({ root, listDocumentSourceIds: async () => ["kept"] })
    expect(await removeOrphanUploads({ root, orphans: scan.orphans })).toEqual({ removed: 1, failed: [] })
    expect(existsSync(orphan)).toBe(false)
    expect(existsSync(kept)).toBe(true)
  })

  it("reports the original missing-path error and continues with the next orphan", async () => {
    const root = fixture()
    const path = await upload(root, "p", "exists")
    const result = await removeOrphanUploads({ root, orphans: ["missing", "exists"].map(sourceId => ({ projectId: "p", sourceId, bytes: 0, modifiedAt: null })) })
    expect(result.removed).toBe(1)
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0]).toMatchObject({ projectId: "p", sourceId: "missing" })
    expect(result.failed[0].reason).toContain("ENOENT")
    expect(result.failed[0].reason).toContain("missing")
    expect(existsSync(path)).toBe(false)
  })

  it("paginates 200 + 3 records by key and skips non-string sourceIds", async () => {
    const calls: unknown[] = []
    const records = Array.from({ length: 203 }, (_, index) => ({ key: `key-${index}`, data: { sourceId: `source-${index}` } }))
    const lister = createProjectDocumentSourceLister({ list: async (...args) => {
      calls.push(args)
      return args[2] === "" ? records.slice(0, 200) : records.slice(200)
    } })
    expect(await lister("p")).toEqual(records.map(record => record.data.sourceId))
    expect(calls).toEqual([["p", "document", "", 200], ["p", "document", "key-199", 200]])
    const filtered = createProjectDocumentSourceLister({ list: async () => [
      { data: null }, { data: { sourceId: 42 } }, { data: {} }, { data: { sourceId: "valid" } },
    ] })
    expect(await filtered("p")).toEqual(["valid"])
  })
})
