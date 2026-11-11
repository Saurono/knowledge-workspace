import { describe, expect, it } from "vitest"
import { compactRevisions, stableDigest } from "../domain"
import { createMemoryRecord, validateMemories } from "../domain/model"

function fixture(count: number) {
  const record = createMemoryRecord({
    id: "a", title: "Title", content: "Content", category: "", domainIds: [], relatedIds: [],
    createdAt: "2026-11-10T00:00:00Z", updatedAt: "2026-11-10T00:00:00Z",
  })
  return { ...record, version: count, revisions: Array.from({ length: count }, (_, i) => ({
    ...record.revisions[0], version: i + 1,
  })) }
}

describe("revision compaction", () => {
  it("leaves eight revisions unchanged", () => {
    const input = fixture(8)
    expect(compactRevisions(input)).toEqual({ record: input, archived: [] })
    expect(compactRevisions(input).record).toBe(input)
  })
  it("archives four, preserves input, validates and is idempotent", () => {
    const input = fixture(9), before = structuredClone(input)
    const { record, archived } = compactRevisions(input)
    expect(record.revisions.map(r => r.version)).toEqual([5, 6, 7, 8, 9])
    expect(archived.map(r => r.version)).toEqual([1, 2, 3, 4])
    expect(archived.map(r => r.data)).toEqual(input.revisions.slice(0, 4))
    expect(record.revisionCompaction).toEqual({ upToVersion: 4, keptFrom: 5, digest: expect.stringMatching(/^[0-9a-f]{16}$/) })
    expect(input).toEqual(before)
    expect(input.revisions).toHaveLength(9)
    expect(record).not.toBe(input)
    expect(record.revisions).not.toBe(input.revisions)
    expect(validateMemories([record])).toEqual([record])
    expect(compactRevisions(record)).toEqual({ record, archived: [] })
    expect(compactRevisions(record).record.revisionCompaction).toBe(record.revisionCompaction)
    expect(() => validateMemories([{ ...record, revisionCompaction: { ...record.revisionCompaction!, keptFrom: 1 } }])).toThrow()
  })
  it("produces stable FNV-1a 64 checksums", () => {
    expect(stableDigest("hello")).toBe("a430d84680aabd0b")
    expect(stableDigest("same")).toBe(stableDigest("same"))
    expect(stableDigest("same")).not.toBe(stableDigest("different"))
  })
})
