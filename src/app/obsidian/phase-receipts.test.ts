import { expect, it, vi } from "vitest"
import { createPhaseReceiptService, projectPhaseReceipt } from "@/modules/obsidian/application"
import { beginStage, createReceivedCheckpoint, finishStage, invalidateStageAndDescendants } from "@/modules/ingestion/domain"

function fixture() {
  const files = new Map<string, string>()
  const writeAtomic = vi.fn(async (path: string, content: string) => { files.set(path, content) })
  const port = { read: async (path: string) => files.get(path) ?? null, writeAtomic, exists: async () => true, createDirectory: async () => {} }
  const records = { vaultPath: null as string | null, receipts: {} as Record<string, typeof receipt> }
  const repository = { update: async (_path: string, change: (value: typeof records) => Promise<boolean>) => { await change(records) }, read: async () => structuredClone(records) }
  let ticks = 0
  const service = createPhaseReceiptService(repository, port, () => `t${++ticks}`)
  let checkpoint = createReceivedCheckpoint({ projectId: "project", documentId: "document", receivedAt: "2026-11-06T00:00:00.000Z", artifactRef: "source:1", indexPolicy: "disabled", feedbackPolicy: "disabled" })
  checkpoint = beginStage(checkpoint, "parse", { attemptId: "parse-1", now: checkpoint.updatedAt })
  checkpoint = finishStage(checkpoint, "parse", { attempt: 1, attemptId: "parse-1", now: checkpoint.updatedAt, outcome: "succeeded", evidence: ["parsed"] })
  checkpoint = beginStage(checkpoint, "compile", { attemptId: "compile-1", now: checkpoint.updatedAt })
  checkpoint = finishStage(checkpoint, "compile", { attempt: 1, attemptId: "compile-1", now: checkpoint.updatedAt, outcome: "succeeded", evidence: ["compiled"] })
  const receipt = projectPhaseReceipt({ id: "receipt-1", sourceId: "source-1", sourceRevision: "a".repeat(64), runId: "run-1", attemptId: "compile-1", checkpoint, times: { receivedAt: checkpoint.createdAt, sourceIngestedAt: checkpoint.updatedAt, revisionIngestedAt: checkpoint.updatedAt } })
  return { files, writeAtomic, service, receipt, records }
}

it("keeps pending on write/readback failure and delivers after retry with digest confirmation", async () => {
  const f = fixture()
  await f.service.configureVault("project", "/vault")
  await f.service.save("project", f.receipt)
  f.writeAtomic.mockRejectedValueOnce(new Error("offline"))
  await expect(f.service.deliver("project", f.receipt.id)).rejects.toThrow("offline")
  expect(f.records.receipts[f.receipt.id].delivery).toBe("pending")
  await expect(f.service.deliver("project", f.receipt.id)).resolves.toBe(true)
  expect(f.records.receipts[f.receipt.id].delivery).toBe("delivered")
  expect(f.records.receipts[f.receipt.id].deliveredDigest).toMatch(/^[a-f0-9]{64}$/)
})

it("retries changed payloads after earlier delivery and syncs pending receipts", async () => {
  const f = fixture()
  await f.service.configureVault("project", "/vault")
  await f.service.save("project", f.receipt)
  await f.service.deliver("project", f.receipt.id)
  const updated = { ...f.receipt, outputVersions: [{ path: "wiki/a.md", version: "v2" }] }
  await f.service.save("project", updated)
  const sync = await f.service.sync("project")
  expect(sync).toEqual({ delivered: 1, failed: [] })
  expect(f.writeAtomic.mock.calls.some(([path]) => String(path).endsWith(`source-1-${"a".repeat(64)}.json`))).toBe(true)
})

it("persists pending receipts without a Vault, then recovers them automatically after explicit reconnect", async () => {
  const f = fixture()
  await f.service.save("project", f.receipt)
  expect(f.records.receipts[f.receipt.id]?.delivery).toBe("pending")
  expect(f.files.size).toBe(0)
  await f.service.configureVault("project", "/vault")
  expect(f.records.receipts[f.receipt.id]?.delivery).toBe("delivered")
})

it("records disconnected delivery errors and resends to a newly selected Vault", async () => {
  const f = fixture()
  await f.service.save("project", f.receipt)
  await f.service.configureVault("project", "/vault")
  expect(f.records.receipts[f.receipt.id]?.delivery).toBe("delivered")
  await f.service.configureVault("project", "/other-vault")
  expect(f.records.receipts[f.receipt.id]?.delivery).toBe("delivered")
  expect(f.writeAtomic.mock.calls.filter(([path]) => String(path).startsWith("/other-vault/")).length).toBeGreaterThan(0)
})

it("does not overwrite a later authoritative attempt with an older checkpoint", async () => {
  const f = fixture()
  await f.service.save("project", f.receipt)
  const now = "2026-11-06T00:00:01.000Z"
  let checkpoint = invalidateStageAndDescendants(f.receipt.checkpoint as never, "compile", now)
  checkpoint = beginStage(checkpoint, "compile", { attemptId: "compile-2", now })
  checkpoint = finishStage(checkpoint, "compile", { attempt: 2, attemptId: "compile-2", now, outcome: "succeeded", evidence: ["compiled:retry"] })
  const newer = projectPhaseReceipt({ id: f.receipt.id, sourceId: f.receipt.sourceId, sourceRevision: f.receipt.sourceRevision, runId: "run-2", checkpoint, times: f.receipt.times })
  await f.service.save("project", newer)
  await f.service.save("project", f.receipt)
  expect(f.records.receipts[f.receipt.id].runId).toBe("run-2")
})

it("rejects a late same-counter result with a different attempt ID even if its clock is later", async () => {
  const f = fixture()
  await f.service.save("project", f.receipt)
  const lateCheckpoint = { ...f.receipt.checkpoint, updatedAt: "2026-11-06T00:00:05.000Z",
    stages: { ...f.receipt.checkpoint.stages, compile: { ...f.receipt.checkpoint.stages.compile, attemptId: "compile-stale" } } }
  const late = projectPhaseReceipt({ id: f.receipt.id, sourceId: f.receipt.sourceId, sourceRevision: f.receipt.sourceRevision, runId: "late-run", checkpoint: lateCheckpoint as never, times: f.receipt.times })
  await f.service.save("project", late)
  expect(f.records.receipts[f.receipt.id].runId).toBe(f.receipt.runId)
})

it("keeps a legal stage advance when the clock gives both phases the same timestamp", async () => {
  const f = fixture()
  let advancedCheckpoint = createReceivedCheckpoint({ projectId: "project", documentId: "document", receivedAt: f.receipt.checkpoint.createdAt, artifactRef: "source:1", indexPolicy: "required", feedbackPolicy: "required" })
  advancedCheckpoint = beginStage(advancedCheckpoint, "parse", { attemptId: "parse-new", now: advancedCheckpoint.updatedAt })
  const initial = projectPhaseReceipt({ id: f.receipt.id, sourceId: f.receipt.sourceId, sourceRevision: f.receipt.sourceRevision, runId: f.receipt.runId, checkpoint: createReceivedCheckpoint({ projectId: "project", documentId: "document", receivedAt: f.receipt.checkpoint.createdAt, artifactRef: "source:1", indexPolicy: "required", feedbackPolicy: "required" }), times: f.receipt.times })
  await f.service.save("project", initial)
  const advanced = projectPhaseReceipt({ id: f.receipt.id, sourceId: f.receipt.sourceId, sourceRevision: f.receipt.sourceRevision, runId: f.receipt.runId, checkpoint: advancedCheckpoint, times: f.receipt.times })
  await f.service.save("project", advanced)
  expect(f.records.receipts[f.receipt.id].activeStage).toBe("parse")
})

it("re-delivers an externally deleted or modified JSON receipt on sync", async () => {
  const f = fixture()
  await f.service.configureVault("project", "/vault")
  await f.service.save("project", f.receipt)
  const target = `/vault/kb-ingest-records/source-1-${"a".repeat(64)}.json`
  f.files.delete(target)
  expect(await f.service.sync("project")).toEqual({ delivered: 1, failed: [] })
  f.files.set(target, "{\"tampered\":true}")
  expect(await f.service.sync("project")).toEqual({ delivered: 1, failed: [] })
  expect(JSON.parse(f.files.get(target)!)).toMatchObject({ sourceId: "source-1", schemaVersion: 2 })
})

it("delivers unknown source revisions under a run-scoped name without inventing a hash", async () => {
  const f = fixture()
  const unknown = projectPhaseReceipt({ id: "ignored", sourceId: "source-1", sourceRevision: null, revisionKind: "unknown", runId: "run-unknown", checkpoint: f.receipt.checkpoint as never, times: { receivedAt: null, sourceIngestedAt: null, revisionIngestedAt: null } })
  await f.service.configureVault("project", "/vault")
  await f.service.save("project", unknown)
  await f.service.sync("project")
  const target = "/vault/kb-ingest-records/source-1-unknown-run-unknown.json"
  expect(f.files.has(target)).toBe(true)
  expect(JSON.parse(f.files.get(target)!)).toMatchObject({ sourceRevision: null, revisionKind: "unknown" })
})

it("supersedes same-run unknown processing receipts atomically when a known revision arrives", async () => {
  const f = fixture()
  await f.service.configureVault("project", "/vault")
  const start = "2026-11-06T00:00:00.000Z"
  let checkpoint = createReceivedCheckpoint({ projectId: "project", documentId: "document", receivedAt: start, artifactRef: "observed:source-1", indexPolicy: "disabled", feedbackPolicy: "disabled" })
  checkpoint = beginStage(checkpoint, "parse", { attemptId: "parse-run-1", now: start })
  const unknown = projectPhaseReceipt({ id: "unknown", sourceId: "source-1", sourceRevision: null, revisionKind: "unknown", runId: "run-1", checkpoint, times: { receivedAt: null, sourceIngestedAt: null, revisionIngestedAt: null } })
  await f.service.save("project", unknown)
  await f.service.deliver("project", unknown.id)
  const unknownTarget = "/vault/kb-ingest-records/source-1-unknown-run-1.json"
  expect(JSON.parse(f.files.get(unknownTarget)!).summary.status).toBe("processing")

  checkpoint = finishStage(checkpoint, "parse", { attempt: 1, attemptId: "parse-run-1", now: start, outcome: "succeeded", evidence: ["parsed"] })
  checkpoint = beginStage(checkpoint, "compile", { attemptId: "compile-run-1", now: start })
  const stillProcessing = projectPhaseReceipt({ id: unknown.id, sourceId: "source-1", sourceRevision: null, revisionKind: "unknown", runId: "run-1", checkpoint, times: unknown.times })
  await f.service.save("project", stillProcessing)
  expect(f.records.receipts[unknown.id].delivery).toBe("pending")

  await f.service.save("project", f.receipt)
  expect(f.records.receipts[unknown.id]).toMatchObject({ supersededBy: f.receipt.id, delivery: "pending", summary: { status: "processing" } })
  expect(await f.service.sync("project")).toEqual({ delivered: 2, failed: [] })
  expect(JSON.parse(f.files.get(unknownTarget)!)).toMatchObject({ sourceRevision: null, revisionKind: "unknown", supersededBy: f.receipt.id, summary: { status: "processing" } })
})
