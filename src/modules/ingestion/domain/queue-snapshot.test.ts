import { describe, expect, it } from "vitest"
import { decodeQueueSnapshot, encodeQueueSnapshot } from "./queue-snapshot"

describe("v1 ingest queue snapshot compatibility", () => {
  it("backfills only missing project IDs and preserves unknown legacy fields", () => {
    const raw = JSON.stringify([
      { id: "old", sourcePath: "raw/中文.md", extension: { keep: true } },
      { id: "foreign", projectId: "other" },
    ])
    const restored = decodeQueueSnapshot(raw, "current")
    expect(JSON.parse(encodeQueueSnapshot(restored))).toEqual([
      { id: "old", projectId: "current", sourcePath: "raw/中文.md", extension: { keep: true } },
      { id: "foreign", projectId: "other" },
    ])
  })
  it("rejects malformed snapshots so the queue can apply its existing read-failure policy", () => {
    expect(() => decodeQueueSnapshot("broken", "p")).toThrow()
    expect(() => decodeQueueSnapshot("{}", "p")).toThrow()
  })
})
