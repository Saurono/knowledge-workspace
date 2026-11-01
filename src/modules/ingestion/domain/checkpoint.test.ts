import { describe, expect, it } from "vitest"
import { beginStage, createReceivedCheckpoint, finishStage, recoverInterrupted, retryStage, summarizeIngestion, validateCheckpoint } from "./checkpoint"
import type { IngestionCheckpointV1, IngestionStage } from "./checkpoint"

const start = "2026-10-01T10:00:00.000Z"
const initial = (options: { indexPolicy?: "required" | "disabled"; feedbackPolicy?: "required" | "disabled" } = {}) => createReceivedCheckpoint({ projectId: "project-1", documentId: "doc-1", receivedAt: start, artifactRef: "document:doc-1", ...options })
function completeStage(cp: IngestionCheckpointV1, stage: IngestionStage, at: number, outcome: "succeeded" | "failed" | "blocked" | "cancelled" = "succeeded") {
  const second = String(at * 2).padStart(2, "0"), finishSecond = String(at * 2 + 1).padStart(2, "0")
  const now = `2026-10-01T10:00:${second}.000Z`, attemptId = `${stage}-${at}`
  const begun = beginStage(cp, stage, { attemptId, now })
  return finishStage(begun, stage, { attempt: begun.stages[stage].attempt, attemptId, now: `2026-10-01T10:00:${finishSecond}.000Z`, outcome, evidence: outcome === "succeeded" ? [`${stage}:artifact`] : [], ...(outcome === "succeeded" ? {} : { error: { code: "test_failure", message: "Failed" } }) })
}
describe("ingestion checkpoint protocol", () => {
  it("starts received and becomes ready only when every configured stage succeeds", () => {
    let cp = initial({ feedbackPolicy: "required" })
    expect(summarizeIngestion(cp)).toEqual({ status: "received", contentReady: false, knowledgeReady: false, feedbackDelivered: false, complete: false })
    cp = completeStage(cp, "parse", 1); cp = completeStage(cp, "compile", 2); cp = completeStage(cp, "index", 3); cp = completeStage(cp, "feedback", 4)
    expect(summarizeIngestion(cp)).toEqual({ status: "ready", contentReady: true, knowledgeReady: true, feedbackDelivered: true, complete: true })
  })
  it("supports disabled index and feedback without calling feedback delivered", () => {
    let cp = initial({ indexPolicy: "disabled", feedbackPolicy: "disabled" })
    cp = completeStage(cp, "parse", 1); cp = completeStage(cp, "compile", 2)
    expect(summarizeIngestion(cp)).toEqual({ status: "ready", contentReady: true, knowledgeReady: true, feedbackDelivered: false, complete: true })
  })
  it("rejects empty compile evidence and reports index failure as partial", () => {
    let cp = completeStage(initial(), "parse", 1)
    const compile = beginStage(cp, "compile", { attemptId: "compile-1", now: "2026-10-01T10:00:04Z" })
    expect(() => finishStage(compile, "compile", { attempt: 1, attemptId: "compile-1", now: "2026-10-01T10:00:05Z", outcome: "succeeded" })).toThrow()
    cp = finishStage(compile, "compile", { attempt: 1, attemptId: "compile-1", now: "2026-10-01T10:00:05Z", outcome: "succeeded", evidence: ["compiled:doc"] })
    const begun = beginStage(cp, "index", { attemptId: "index-1", now: "2026-10-01T10:01:00Z" })
    expect(() => finishStage(begun, "index", { attempt: 1, attemptId: "index-1", now: "2026-10-01T10:01:01Z", outcome: "succeeded" })).toThrow()
    cp = finishStage(begun, "index", { attempt: 1, attemptId: "index-1", now: "2026-10-01T10:01:01Z", outcome: "failed", error: { code: "index_failed", message: "No index backend" } })
    expect(summarizeIngestion(cp)).toMatchObject({ status: "partial", contentReady: true, knowledgeReady: false, complete: false })
  })
  it("keeps knowledge readiness when feedback fails and retries only that stage", () => {
    let cp = initial({ feedbackPolicy: "required" }); cp = completeStage(cp, "parse", 1); cp = completeStage(cp, "compile", 2); cp = completeStage(cp, "index", 3); cp = completeStage(cp, "feedback", 4, "failed")
    expect(summarizeIngestion(cp)).toMatchObject({ knowledgeReady: true, feedbackDelivered: false, complete: false })
    cp = retryStage(cp, "feedback", "2026-10-01T10:02:00Z")
    expect(cp.stages.compile.status).toBe("succeeded"); expect(cp.stages.feedback.status).toBe("pending")
  })
  it("rejects late results after cancellation and requires a new attempt after recovery", () => {
    let cp = beginStage(initial(), "parse", { attemptId: "parse-1", now: "2026-10-01T10:01:00Z" })
    cp = finishStage(cp, "parse", { attempt: 1, attemptId: "parse-1", now: "2026-10-01T10:01:01Z", outcome: "cancelled", error: { code: "cancelled", message: "Stopped" } })
    expect(() => finishStage(cp, "parse", { attempt: 1, attemptId: "parse-1", now: "2026-10-01T10:01:02Z", outcome: "succeeded", evidence: ["late"] })).toThrow()
    cp = retryStage(cp, "parse", "2026-10-01T10:02:00Z")
    cp = beginStage(cp, "parse", { attemptId: "parse-2", now: "2026-10-01T10:02:01Z" })
    cp = recoverInterrupted(cp, "2026-10-01T10:02:02Z")
    expect(cp.stages.parse).toMatchObject({ status: "blocked", error: { code: "interrupted" } })
    expect(() => finishStage(cp, "parse", { attempt: 2, attemptId: "parse-2", now: "2026-10-01T10:02:03Z", outcome: "succeeded", evidence: ["late"] })).toThrow()
    cp = retryStage(cp, "parse", "2026-10-01T10:02:04Z")
    cp = beginStage(cp, "parse", { attemptId: "parse-3", now: "2026-10-01T10:02:05Z" })
    expect(cp.stages.parse.attempt).toBe(3)
  })
  it("reports blocked parse and pending compile as waiting, preserves partial content after index cancellation, and checks upstream times", () => {
    let cp = completeStage(initial(), "parse", 1, "blocked")
    expect(summarizeIngestion(cp).status).toBe("waiting")
    cp = retryStage(cp, "parse", "2026-10-01T10:00:04Z")
    cp = completeStage(cp, "parse", 2)
    expect(summarizeIngestion(cp).status).toBe("waiting")
    cp = completeStage(cp, "compile", 3)
    cp = completeStage(cp, "index", 4, "cancelled")
    expect(summarizeIngestion(cp)).toMatchObject({ status: "partial", contentReady: true, knowledgeReady: false, complete: false })
    const invalidTime = structuredClone(cp)
    invalidTime.stages.compile.startedAt = "2026-10-01T10:00:02.000Z"
    expect(() => validateCheckpoint(invalidTime)).toThrow()
  })
  it("rejects unsafe attempt counters, nonzero skipped counters, and retried pending stages behind failed upstreams", () => {
    const oversized = initial(); oversized.stages.parse.attempt = Number.MAX_SAFE_INTEGER + 1
    expect(() => validateCheckpoint(oversized)).toThrow()
    const skipped = initial({ indexPolicy: "disabled" }); skipped.stages.index.attempt = 1
    expect(() => validateCheckpoint(skipped)).toThrow()
    const failedParse = completeStage(initial(), "parse", 1, "failed")
    failedParse.stages.compile.attempt = 1
    expect(() => validateCheckpoint(failedParse)).toThrow()
  })
  it("does not mutate nested input and rejects damaged, skipped, and out of order data", () => {
    const cp = initial(), before = structuredClone(cp)
    beginStage(cp, "parse", { attemptId: "p", now: "2026-10-01T10:01:00Z" })
    expect(cp).toEqual(before)
    expect(() => validateCheckpoint({ ...cp, stages: { ...cp.stages, unexpected: {} } })).toThrow()
    expect(() => validateCheckpoint({ ...cp, updatedAt: "not-a-date" })).toThrow()
    expect(() => beginStage(cp, "compile", { attemptId: "c", now: "2026-10-01T10:01:00Z" })).toThrow()
    const malformed = { ...cp, stages: { ...cp.stages, index: { ...cp.stages.index, status: "failed" as const, attempt: 1, startedAt: start, finishedAt: start, error: { code: "x", message: "x" } } } } as IngestionCheckpointV1
    expect(() => retryStage(malformed, "index", "2026-10-01T10:01:00Z")).toThrow()
  })
})
