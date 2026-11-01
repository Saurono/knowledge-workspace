import { afterEach, describe, expect, it } from "vitest"
import {
  beginStage,
  createReceivedCheckpoint,
  finishStage,
  recoverInterrupted,
  retryStage,
  summarizeIngestion,
  validateCheckpoint,
} from "@/modules/ingestion/domain"
import type { IngestionCheckpointV1, IngestionStage } from "@/modules/ingestion/domain"
import { accountFixture } from "../../server/testing"
import { createDocumentCheckpointRepository } from "../../server/ingestion-checkpoints"

const projectId = "11111111-1111-4111-8111-111111111111"
const documentId = "d01-acceptance-document"
const t0 = "2026-11-01T00:00:00.000Z"
const t1 = "2026-11-01T00:01:00.000Z"
const t2 = "2026-11-01T00:02:00.000Z"
const t3 = "2026-11-01T00:03:00.000Z"
const stages: IngestionStage[] = ["receive", "parse", "compile", "index", "feedback"]

function received(options: { indexPolicy?: "required" | "disabled"; feedbackPolicy?: "required" | "disabled" } = {}) {
  return createReceivedCheckpoint({ projectId, documentId, receivedAt: t0, artifactRef: "uploads/d01.bin", ...options })
}
function complete(checkpoint: IngestionCheckpointV1, stage: IngestionStage, attemptId: string, now: string, evidence = `${stage}:evidence`) {
  const begun = beginStage(checkpoint, stage, { attemptId, now })
  return finishStage(begun, stage, { attempt: begun.stages[stage].attempt, attemptId, now: later(now), outcome: "succeeded", evidence: [evidence] })
}
function later(value: string) { return new Date(Date.parse(value) + 1000).toISOString() }
function throughCompile() {
  return complete(complete(received({ feedbackPolicy: "required" }), "parse", "parse-a", t1), "compile", "compile-a", t2)
}

describe("D01 ingestion checkpoint acceptance", () => {
  it("records only receipt initially and does not report ready", () => {
    const checkpoint = received(), summary = summarizeIngestion(checkpoint)
    expect(checkpoint.stages.receive.status).toBe("succeeded")
    expect(checkpoint.stages.parse.status).toBe("pending")
    expect(checkpoint.stages.compile.status).toBe("pending")
    expect(checkpoint.stages.index.status).toBe("pending")
    expect(checkpoint.stages.feedback.status).toBe("skipped")
    expect(summary).toMatchObject({ status: "received", contentReady: false, knowledgeReady: false, feedbackDelivered: false, complete: false })
    expect(checkpoint.policy.feedback).toBe("disabled")
  })

  it("requires the five stages in order and requires evidence for every success", () => {
    const initial = received({ feedbackPolicy: "required" })
    expect(() => beginStage(initial, "compile", { attemptId: "compile", now: t1 })).toThrow()
    const parsed = complete(initial, "parse", "parse", t1)
    const compiling = beginStage(parsed, "compile", { attemptId: "compile", now: t2 })
    expect(() => finishStage(compiling, "compile", { attempt: 1, attemptId: "compile", now: t3, outcome: "succeeded", evidence: [] })).toThrow()
    const compiled = finishStage(compiling, "compile", { attempt: 1, attemptId: "compile", now: t3, outcome: "succeeded", evidence: ["compiled:doc"] })
    const indexed = complete(compiled, "index", "index", later(t3))
    const feedback = complete(indexed, "feedback", "feedback", later(later(t3)))
    expect(stages.every(stage => feedback.stages[stage].status === "succeeded")).toBe(true)
    expect(summarizeIngestion(feedback)).toMatchObject({ contentReady: true, knowledgeReady: true, feedbackDelivered: true, complete: true, status: "ready" })
  })

  it("distinguishes disabled stages from delivery and accepts disabled index as knowledge ready", () => {
    const checkpoint = received({ indexPolicy: "disabled", feedbackPolicy: "disabled" })
    expect(checkpoint.stages.index.status).toBe("skipped")
    expect(checkpoint.stages.feedback.status).toBe("skipped")
    const compiled = complete(complete(checkpoint, "parse", "parse", t1), "compile", "compile", t2)
    expect(summarizeIngestion(compiled)).toMatchObject({ contentReady: true, knowledgeReady: true, feedbackDelivered: false, complete: true, status: "ready" })
    expect(() => retryStage(compiled, "feedback", t3)).toThrow()
    expect(() => beginStage(compiled, "index", { attemptId: "forged", now: t3 })).toThrow()
  })

  it("keeps index failure partial and makes index retry independent of successful compilation", () => {
    const compiled = throughCompile()
    const begun = beginStage(compiled, "index", { attemptId: "index-1", now: t3 })
    const failed = finishStage(begun, "index", { attempt: 1, attemptId: "index-1", now: later(t3), outcome: "failed", error: { code: "index_error", message: "index unavailable" } })
    expect(summarizeIngestion(failed)).toMatchObject({ contentReady: true, knowledgeReady: false, complete: false, status: "partial" })
    const retried = retryStage(failed, "index", later(later(t3)))
    expect(retried.stages.compile).toMatchObject({ status: "succeeded", attempt: 1 })
    expect(retried.stages.index).toMatchObject({ status: "pending", attempt: 1 })
    const success = complete(retried, "index", "index-2", later(later(later(t3))))
    expect(success.stages.compile.attempt).toBe(1)
    expect(summarizeIngestion(success).knowledgeReady).toBe(true)
  })

  it("does not erase knowledge readiness after required feedback failure and retries only feedback", () => {
    const indexed = complete(throughCompile(), "index", "index", t3)
    const begun = beginStage(indexed, "feedback", { attemptId: "fb-1", now: later(t3) })
    const failed = finishStage(begun, "feedback", { attempt: 1, attemptId: "fb-1", now: later(later(t3)), outcome: "failed", error: { code: "delivery_error", message: "delivery unavailable" } })
    expect(summarizeIngestion(failed)).toMatchObject({ contentReady: true, knowledgeReady: true, feedbackDelivered: false, complete: false, status: "partial" })
    const retry = retryStage(failed, "feedback", later(later(later(t3))))
    expect(retry.stages.compile.attempt).toBe(1)
    expect(retry.stages.index.attempt).toBe(1)
    expect(retry.stages.feedback).toMatchObject({ status: "pending", attempt: 1 })
  })

  it("rejects late results after cancellation and after recovery starts a fresh attempt", () => {
    const compiled = throughCompile()
    const running = beginStage(compiled, "index", { attemptId: "old", now: t3 })
    const cancelled = finishStage(running, "index", { attempt: 1, attemptId: "old", now: later(t3), outcome: "cancelled", error: { code: "cancelled", message: "cancelled" } })
    expect(() => finishStage(cancelled, "index", { attempt: 1, attemptId: "old", now: later(later(t3)), outcome: "succeeded", evidence: ["late"] })).toThrow()
    const restarted = beginStage(retryStage(cancelled, "index", later(later(t3))), "index", { attemptId: "new", now: later(later(later(t3))) })
    expect(() => finishStage(restarted, "index", { attempt: 1, attemptId: "old", now: later(later(later(later(t3)))), outcome: "succeeded", evidence: ["late"] })).toThrow()
    expect(restarted.stages.index.attempt).toBe(2)
    const interrupted = recoverInterrupted(restarted, later(later(later(later(t3)))))
    expect(interrupted.stages.index).toMatchObject({ status: "blocked", error: { code: "interrupted" } })
    expect(() => finishStage(interrupted, "index", { attempt: 2, attemptId: "new", now: later(later(later(later(later(t3))))), outcome: "succeeded", evidence: ["late after restart"] })).toThrow()
    const restartedAgain = beginStage(retryStage(interrupted, "index", later(later(later(later(later(t3)))))), "index", { attemptId: "newer", now: later(later(later(later(later(later(t3)))))) })
    expect(restartedAgain.stages.index.attempt).toBe(3)
  })

  it("does not mutate input checkpoints or nested evidence", () => {
    const checkpoint = throughCompile()
    const before = structuredClone(checkpoint)
    const deepFreeze = <T>(value: T): T => {
      if (value && typeof value === "object" && !Object.isFrozen(value)) {
        Object.freeze(value)
        for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
      }
      return value
    }
    deepFreeze(checkpoint)
    const laterCheckpoint = beginStage(checkpoint, "index", { attemptId: "i", now: t3 })
    expect(checkpoint).toEqual(before)
    expect(laterCheckpoint.stages.compile.evidence).toEqual(checkpoint.stages.compile.evidence)
    expect(summarizeIngestion(checkpoint)).toEqual(summarizeIngestion(before))
  })

  it("rejects invalid versions, missing stages, invalid dependencies and invalid or backward times", () => {
    const checkpoint = throughCompile()
    expect(() => validateCheckpoint({ ...checkpoint, schemaVersion: 2 })).toThrow()
    const missing = structuredClone(checkpoint) as unknown as { stages: Record<string, unknown> }; delete missing.stages.feedback
    expect(() => validateCheckpoint(missing)).toThrow()
    const illegal = structuredClone(checkpoint) as unknown as { stages: Record<string, Record<string, unknown>> }
    illegal.stages.parse = { ...checkpoint.stages.parse, status: "pending", attempt: 0, attemptId: null, startedAt: null, finishedAt: null, evidence: [], error: null }
    expect(() => validateCheckpoint(illegal)).toThrow()
    expect(() => beginStage(checkpoint, "index", { attemptId: "i", now: "yesterday" })).toThrow()
    expect(() => beginStage(checkpoint, "index", { attemptId: "i", now: t1 })).toThrow()
    const skipped = structuredClone(received({ indexPolicy: "required" })) as unknown as { stages: Record<string, { status: string }> }
    skipped.stages.index.status = "skipped"
    expect(() => validateCheckpoint(skipped)).toThrow()
    expect(() => beginStage(received(), "receive", { attemptId: "twice", now: t1 })).toThrow()
  })

  it("summarizes a blocked parse as waiting", () => {
    const initial = received({ feedbackPolicy: "required" })
    const parseRunning = beginStage(initial, "parse", { attemptId: "parse-blocked", now: t1 })
    const parseBlocked = finishStage(parseRunning, "parse", { attempt: 1, attemptId: "parse-blocked", now: later(t1), outcome: "blocked", error: { code: "parse_blocked", message: "needs input" } })
    expect(summarizeIngestion(parseBlocked).status).toBe("waiting")
  })

  it("summarizes successful parse with compile pending as waiting", () => {
    const initial = received({ feedbackPolicy: "required" })
    const parsed = complete(initial, "parse", "parse-ready", t1)
    expect(summarizeIngestion(parsed).status).toBe("waiting")
  })

  it("summarizes successful compile and cancelled index as partial with ready content", () => {
    const parsed = complete(received({ feedbackPolicy: "required" }), "parse", "parse-ready", t1)
    const compiled = complete(parsed, "compile", "compile-ready", t2)
    const indexRunning = beginStage(compiled, "index", { attemptId: "index-cancel", now: t3 })
    const indexCancelled = finishStage(indexRunning, "index", { attempt: 1, attemptId: "index-cancel", now: later(t3), outcome: "cancelled", error: { code: "cancelled", message: "cancelled" } })
    expect(summarizeIngestion(indexCancelled)).toMatchObject({ status: "partial", contentReady: true, knowledgeReady: false })
  })

  it("rejects time inversion between parse finish and compile start", () => {
    const compiled = throughCompile()
    const inverted = structuredClone(compiled) as unknown as { stages: Record<string, Record<string, unknown>> }
    inverted.stages.compile = { ...compiled.stages.compile, startedAt: t1 }
    expect(() => validateCheckpoint(inverted)).toThrow()
  })
})

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup() })
describe("D01 shared document checkpoint persistence and read-only HTTP", () => {
  it("persists checkpoint snapshots with expected revisions, rejects competing writes, and recovers after restart", async () => {
    const f = await accountFixture(); cleanups.push(f.close); await f.bootstrap(); const admin = await f.login()
    const project = (await f.json("/projects", "POST", { name: "D01" }, admin.cookie)).data
    const doc = "d01-persist"
    await f.repository.save(project.id, "document", doc, { id: doc, name: "receipt.bin", status: "received", sourceId: doc, receivedAt: t0, size: 16, sha256: "a".repeat(64), mediaType: "application/octet-stream", sourceIngestedAt: null, metadata: { retained: true } }, null, t0)
    const repository = createDocumentCheckpointRepository(f.repository)
    const legacy = await repository.read(project.id, doc)
    expect(legacy).not.toBeNull()
    const initial = legacy!.checkpoint
    const competingA = beginStage(initial, "parse", { attemptId: "parse-race-a", now: t1 })
    const competingB = beginStage(initial, "parse", { attemptId: "parse-race-b", now: t1 })
    const results = await Promise.allSettled([
      repository.save(project.id, doc, legacy!.revision, competingA),
      repository.save(project.id, doc, legacy!.revision, competingB),
    ])
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1)
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1)
    const saved = results.find(result => result.status === "fulfilled")
    if (saved?.status !== "fulfilled") throw new Error("Expected one competing checkpoint write to succeed")
    await f.restart()
    const reopened = createDocumentCheckpointRepository(f.repository)
    const persisted = await reopened.read(project.id, doc)
    expect(persisted?.checkpoint.stages.parse.status).toBe("running")
    expect(persisted?.revision).toBe(saved.value.revision)
    const recovered = recoverInterrupted(persisted!.checkpoint, t2)
    expect(recovered.stages.parse).toMatchObject({ status: "blocked", error: { code: "interrupted" } })
    const recoverySaved = await reopened.save(project.id, doc, persisted!.revision, recovered)
    expect((await reopened.read(project.id, doc))?.checkpoint.stages.parse.status).toBe("blocked")
    expect(recoverySaved.revision).toBe(persisted!.revision + 1)
  })

  it("does not reset damaged snapshots or infer later-stage success from legacy received metadata", async () => {
    const f = await accountFixture(); cleanups.push(f.close); await f.bootstrap(); const admin = await f.login()
    const project = (await f.json("/projects", "POST", { name: "D01 legacy" }, admin.cookie)).data
    await f.repository.save(project.id, "document", "broken", { id: "broken", name: "broken.bin", status: "received", sourceId: "broken", receivedAt: t0, size: 16, sha256: "a".repeat(64), mediaType: "application/octet-stream", sourceIngestedAt: null, ingestion: { schemaVersion: 99 }, ingestionCheckpoint: { schemaVersion: 99 } }, null, t0)
    const beforeBrokenRead = await f.repository.get(project.id, "document", "broken")
    await f.repository.save(project.id, "document", "legacy", { id: "legacy", name: "legacy.bin", status: "received", done: true, receivedAt: t0, size: 16, sha256: "a".repeat(64), sourceId: "legacy", mediaType: "application/octet-stream", sourceIngestedAt: null, compiledAt: t0 }, null, t0)
    const adapter = createDocumentCheckpointRepository(f.repository)
    await expect(adapter.read(project.id, "broken")).rejects.toThrow()
    expect(await f.repository.get(project.id, "document", "broken")).toEqual(beforeBrokenRead)
    const legacy = await adapter.read(project.id, "legacy")
    if (legacy) expect(legacy.checkpoint.stages).toMatchObject({ receive: { status: "succeeded" }, parse: { status: "pending" }, compile: { status: "pending" }, index: { status: "pending" } })
  })

  it("additional hardening: refuses to turn legacy metadata without reliable receipt evidence into a successful receive", async () => {
    const f = await accountFixture(); cleanups.push(f.close); await f.bootstrap(); const admin = await f.login()
    const project = (await f.json("/projects", "POST", { name: "D01 invalid legacy" }, admin.cookie)).data
    const doc = "missing-receipt-evidence"
    await f.repository.save(project.id, "document", doc, { id: doc, name: "legacy.bin", status: "received", done: true, sourceId: doc, sourceIngestedAt: null }, null, t0)
    const adapter = createDocumentCheckpointRepository(f.repository)
    await expect(adapter.read(project.id, doc)).rejects.toThrow()
    const attemptedCheckpoint = createReceivedCheckpoint({ projectId: project.id, documentId: doc, receivedAt: t0, artifactRef: "uploads/legacy.bin" })
    await expect(adapter.save(project.id, doc, 1, attemptedCheckpoint)).rejects.toThrow()
    expect(await f.repository.get(project.id, "document", doc)).toMatchObject({ revision: 1 })
  })

  it("uploads an initial receive checkpoint and exposes it through an authorized read-only endpoint", async () => {
    const f = await accountFixture(); cleanups.push(f.close); await f.bootstrap(); const admin = await f.login()
    const project = (await f.json("/projects", "POST", { name: "D01 upload" }, admin.cookie)).data
    const upload = await fetch(`${f.origin}/api/v1/projects/${project.id}/documents`, { method: "POST", headers: { Cookie: admin.cookie, "X-KW-CSRF": "1", "X-File-Name": encodeURIComponent("evidence.txt"), "Content-Type": "application/octet-stream" }, body: "actual upload bytes" })
    expect([200, 201]).toContain(upload.status)
    const body = await upload.json()
    expect(body.data?.data?.sourceIngestedAt).toBeNull()
    const id = body.data?.key
    expect(typeof id).toBe("string")
    const path = `/projects/${project.id}/documents/${id}/ingestion`
    const query = await f.request(path, "GET", undefined, admin.cookie)
    expect(query.status).toBe(200)
    expect(query.headers.get("etag")).toMatch(/^"v\d+"$/)
    const data = (await query.json()).data
    expect(data.checkpoint.stages).toMatchObject({ receive: { status: "succeeded" }, parse: { status: "pending" }, compile: { status: "pending" }, index: { status: "pending" }, feedback: { status: "skipped" } })
    expect(data.summary.contentReady).toBe(false)
    expect((await f.request(path, "POST", { outcome: "succeeded" }, admin.cookie)).status).toBeGreaterThanOrEqual(400)
    expect((await f.request(path)).status).toBe(401)
    const other = (await f.json("/projects", "POST", { name: "Other" }, admin.cookie)).data
    expect((await f.request(`/projects/${other.id}/documents/${id}/ingestion`, "GET", undefined, admin.cookie)).status).toBe(404)
    const agent = await f.createAccount(admin.cookie, "d01-reader", "agent")
    let catalog = await f.authentication.catalog.read()
    await f.authentication.catalog.saveMembership(catalog.revision, { accountId: agent.id, projectId: project.id, permissionRole: "editor", workRoleIds: [] })
    const issued = await f.json("/auth/tokens", "POST", { accountId: agent.id, projectId: project.id, label: "D01 read only", workRoleId: null, permissions: ["project.read", "documents.read"], expiresAt: "2026-11-02T00:00:00.000Z" }, admin.cookie)
    expect(issued.response.status).toBe(201)
    const tokenHeaders = { Authorization: `Bearer ${issued.data.secret}` }
    expect((await f.request(path, "GET", undefined, "", tokenHeaders)).status).toBe(200)
    expect((await f.request(path, "POST", { outcome: "succeeded" }, "", tokenHeaders)).status).toBe(403)
    expect((await f.request(`/projects/${other.id}/documents/${id}/ingestion`, "GET", undefined, "", tokenHeaders)).status).toBe(403)
  })
})
