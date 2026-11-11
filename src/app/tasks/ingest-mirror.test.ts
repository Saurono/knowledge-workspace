import { expect, it, vi } from "vitest"
import type { IngestTask } from "@/modules/ingestion"
import type { TaskProtocol } from "@/modules/tasks"
import { createLegacyIngestMirror, LEGACY_INGEST_EXECUTOR } from "./ingest-mirror"

const task = (status: IngestTask["status"] = "pending", id = "a"): IngestTask => ({ id, projectId: "p", sourcePath: "/docs/a.pdf", sourceId: "s", sourceRevision: "r", folderContext: "docs", status, addedAt: 1000, error: null, retryCount: 0 })
function setup(seed: TaskProtocol[] = [], fail = false) {
  const records = new Map(seed.map(t => [t.id, t]))
  let listener!: (tasks: readonly IngestTask[]) => void
  let tick = 0
  const onError = vi.fn()
  const adopt = vi.fn(async (t: TaskProtocol) => { if (fail && t.id.endsWith(":a")) throw new Error("write"); records.set(t.id, t); return t })
  const mirror = createLegacyIngestMirror({ subscribe(fn) { listener = fn; return () => {} }, host: { list: async () => [...records.values()], adopt }, now: () => new Date(10000 + tick++ * 1000).toISOString(), onError })
  return { ...mirror, records, adopt, onError, emit: (ts: IngestTask[]) => listener(ts), get: () => records.get("legacy-ingest:p:a")! }
}
it("1 maps pending fields", async () => {
  const h = setup(); await h.sync([task()]); const t = h.get()
  expect(t).toMatchObject({ id: "legacy-ingest:p:a", kind: "ingest", executorId: LEGACY_INGEST_EXECUTOR, stage: "queued", createdAt: new Date(1000).toISOString(), log: [], result: { report: null, ingest: null } })
  expect(t.payload).toEqual({ sourcePath: "/docs/a.pdf", projectId: "p", sourceId: "s", sourceRevision: "r", folderContext: "docs", retryCount: 0, title: "a.pdf" })
})
it("2 preserves start and reports no counts", async () => {
  const h = setup(); await h.sync([task("processing")]); const start = h.get().startedAt
  await h.sync([task("done")]); expect(h.get().startedAt).toBe(start); expect(h.get().finishedAt).toBeTruthy(); expect(h.get().result.ingest).toBeNull()
  expect(h.get().log.map(l => l.message)).toEqual(["legacy queue: done", "Ingest finished in legacy queue; written file counts are not reported"])
})
it("3 maps failure", async () => {
  const h = setup(); await h.sync([task()]); await h.sync([{ ...task("failed"), error: "broken" }])
  expect(h.get().error).toEqual({ code: "legacy_ingest_failed", message: "broken", retriable: true }); expect(h.get().log).toHaveLength(1); expect(h.get().log[0].level).toBe("error")
})
it("4 initially cancelled has no log", async () => { const h = setup(); await h.sync([task("cancelled")]); expect(h.get().stage).toBe("cancelled"); expect(h.get().finishedAt).toBeTruthy(); expect(h.get().log).toEqual([]) })
it("5 skips unchanged snapshots", async () => { const h = setup(); await h.sync([task()]); await h.sync([task()]); expect(h.adopt).toHaveBeenCalledTimes(1) })
it("6 allows rollback preserving timestamps", async () => {
  const h = setup(); await h.sync([task("processing")]); const old = h.get(); await h.sync([task()]); expect(h.get()).toMatchObject({ stage: "queued", createdAt: old.createdAt, startedAt: old.startedAt }); expect(h.get().log.map(l => l.message)).toEqual(["legacy queue: pending"])
})
it("7 seeds restart records", async () => {
  const original = setup(); await original.sync([task("processing")]); const seed = { ...original.get(), createdAt: new Date(0).toISOString() }
  const h = setup([seed]); await h.sync([task("processing")]); expect(h.adopt).not.toHaveBeenCalled(); expect(h.get().createdAt).toBe(seed.createdAt)
})
it("8 cancels missing active records only", async () => {
  const h = setup(); await h.sync([task("processing")]); await h.sync([]); expect(h.get().stage).toBe("cancelled"); expect(h.get().log).toMatchObject([{ level: "warn", message: "Removed from legacy queue" }])
  await h.sync([task("done", "b")]); const calls = h.adopt.mock.calls.length; await h.sync([]); expect(h.adopt).toHaveBeenCalledTimes(calls)
})
it("9 isolates adoption failures", async () => { const h = setup([], true); await h.sync([task(), task("pending", "b")]); expect(h.onError).toHaveBeenCalledTimes(1); expect(h.records.has("legacy-ingest:p:b")).toBe(true) })
it("10 resolves ready after initial sync and stops", async () => { const h = setup(); h.emit([task()]); await h.ready; expect(h.adopt).toHaveBeenCalledTimes(1); h.stop(); h.emit([task("done")]); await h.sync([]); expect(h.adopt).toHaveBeenCalledTimes(1) })
