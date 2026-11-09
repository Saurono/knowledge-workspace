import { beforeEach, describe, expect, it, vi } from "vitest"

const fake = vi.hoisted(() => ({
  read: vi.fn(async (_path: string) => ({
    sources: {
      "/p/raw/sources/a.pdf": { id: "source-a", originalPath: null, receivedAt: "received", ingestedAt: "first-ingest", contentRevision: "b".repeat(64) },
      "/p/raw/sources/b.pdf": { id: "source-b", originalPath: null, receivedAt: null, ingestedAt: null },
    },
    receipts: {
      old: { sourceId: "source-a", sourceRevision: "a".repeat(64), revisionIngestedAt: "old-revision" },
      current: { sourceId: "source-a", sourceRevision: "b".repeat(64), revisionIngestedAt: "current-revision" },
    },
  })),
}))

vi.mock("@/app/document-records/repository", () => ({ loadIngestRecords: fake.read }))
import { readLocalSourceTimes } from "./source-times"

describe("readLocalSourceTimes", () => {
  beforeEach(() => fake.read.mockClear())

  it("projects receive, first-ingest and current-content-revision receipt times from one read", async () => {
    expect(await readLocalSourceTimes("/p", ["/p/raw/sources/a.pdf", "/p/raw/sources/b.pdf", "/p/raw/sources/missing.pdf"])).toEqual({
      "/p/raw/sources/a.pdf": { id: "source-a", receivedAt: "received", sourceIngestedAt: "first-ingest", revisionIngestedAt: "current-revision" },
      "/p/raw/sources/b.pdf": { id: "source-b", receivedAt: null, sourceIngestedAt: null, revisionIngestedAt: null },
      "/p/raw/sources/missing.pdf": null,
    })
    expect(fake.read).toHaveBeenCalledTimes(1)
  })

  it("does not treat a different source revision's receipt as the current revision", async () => {
    fake.read.mockImplementationOnce(async () => ({
      sources: { "/p/raw/sources/a.pdf": { id: "source-a", originalPath: null, receivedAt: "received", ingestedAt: null, contentRevision: "c".repeat(64) } },
      receipts: { old: { sourceId: "source-a", sourceRevision: "b".repeat(64), revisionIngestedAt: "stale" } },
    }) as never)
    expect(await readLocalSourceTimes("/p", ["/p/raw/sources/a.pdf"])).toEqual({
      "/p/raw/sources/a.pdf": { id: "source-a", receivedAt: "received", sourceIngestedAt: null, revisionIngestedAt: null },
    })
  })
})
