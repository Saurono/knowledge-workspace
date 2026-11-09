import { expect, it } from "vitest"
import { beginStage, createReceivedCheckpoint, finishStage, invalidateStageAndDescendants } from "@/modules/ingestion/domain"
import { projectPhaseReceipt } from "../application/phase-receipts"

it("projects validated five-stage checkpoints into a v2 receipt without client status", () => {
  const now = "2026-11-06T00:00:00.000Z"
  let checkpoint = createReceivedCheckpoint({ projectId: "project", documentId: "document", receivedAt: now, artifactRef: "source:1", indexPolicy: "disabled", feedbackPolicy: "disabled" })
  checkpoint = beginStage(checkpoint, "parse", { attemptId: "parse-1", now })
  checkpoint = finishStage(checkpoint, "parse", { attempt: 1, attemptId: "parse-1", now, outcome: "succeeded", evidence: ["parsed"] })
  checkpoint = beginStage(checkpoint, "compile", { attemptId: "compile-1", now })
  checkpoint = finishStage(checkpoint, "compile", { attempt: 1, attemptId: "compile-1", now, outcome: "succeeded", evidence: ["compiled"] })
  const receipt = projectPhaseReceipt({ id: "r1", sourceId: "source", sourceRevision: "a".repeat(64), runId: "run", attemptId: "compile-1", checkpoint, times: { receivedAt: now, sourceIngestedAt: now, revisionIngestedAt: now } })
  expect(receipt).toMatchObject({ schemaVersion: 2, summary: { status: "ready", complete: true }, delivery: "pending", stages: checkpoint.stages })
  expect(receipt).not.toHaveProperty("status")
})

it("rejects an unvalidated/incomplete checkpoint", () => {
  expect(() => projectPhaseReceipt({
    id: "r", sourceId: "s", sourceRevision: "rev", runId: "run", attemptId: "a",
    checkpoint: {} as never, times: { receivedAt: null, sourceIngestedAt: null, revisionIngestedAt: null },
  })).toThrow()
})

it("projects receive-only and failed checkpoints without inventing compile attempts", () => {
  const now = "2026-11-06T00:00:00.000Z"
  const base = () => createReceivedCheckpoint({ projectId: "project", documentId: "doc", receivedAt: now, artifactRef: "received", indexPolicy: "required", feedbackPolicy: "required" })
  const make = (checkpoint: ReturnType<typeof base>) => projectPhaseReceipt({ id: "ignored", sourceId: "source", sourceRevision: "c".repeat(64), runId: "run", checkpoint, times: { receivedAt: now, sourceIngestedAt: null, revisionIngestedAt: null } })
  const received = make(base())
  expect(received).toMatchObject({ activeStage: "receive", attemptId: null, summary: { status: "received" } })

  const outcomes = ["parse", "compile", "index", "feedback"] as const
  for (const stage of outcomes) {
    let checkpoint = base()
    const previous = outcomes.slice(0, outcomes.indexOf(stage))
    for (const completed of previous) {
      checkpoint = beginStage(checkpoint, completed, { attemptId: `${completed}-1`, now: checkpoint.updatedAt })
      checkpoint = finishStage(checkpoint, completed, { attempt: 1, attemptId: `${completed}-1`, now: checkpoint.updatedAt, outcome: "succeeded", evidence: [`${completed} evidence`] })
    }
    checkpoint = beginStage(checkpoint, stage, { attemptId: `${stage}-failed`, now: checkpoint.updatedAt })
    checkpoint = finishStage(checkpoint, stage, { attempt: 1, attemptId: `${stage}-failed`, now: checkpoint.updatedAt, outcome: "failed", error: { code: "failed", message: `${stage} failed` } })
    const projected = make(checkpoint)
    expect(projected.activeStage).toBe(stage)
    expect(projected.attemptId).toBe(`${stage}-failed`)
    expect(projected.error).toEqual({ code: "failed", message: `${stage} failed` })
  }
})

it("maps pending invalidated descendants to the last executed stage in the fixed lifecycle order", () => {
  const now = "2026-11-06T00:00:00.000Z"
  let checkpoint = createReceivedCheckpoint({ projectId: "project", documentId: "doc", receivedAt: now, artifactRef: "source", indexPolicy: "required", feedbackPolicy: "required" })
  for (const [index, stage] of (["parse", "compile", "index", "feedback"] as const).entries()) {
    checkpoint = beginStage(checkpoint, stage, { attemptId: `${stage}-attempt`, now: `2026-11-06T00:00:0${index + 1}.000Z` })
    checkpoint = finishStage(checkpoint, stage, { attempt: 1, attemptId: `${stage}-attempt`, now: `2026-11-06T00:00:0${index + 2}.000Z`, outcome: "succeeded", evidence: [`${stage}:proof`] })
  }
  checkpoint = invalidateStageAndDescendants(checkpoint, "index", "2026-11-06T00:00:10.000Z")
  const projected = projectPhaseReceipt({ id: "ignored", sourceId: "source", sourceRevision: "d".repeat(64), runId: "run", checkpoint, times: { receivedAt: now, sourceIngestedAt: now, revisionIngestedAt: now } })
  expect(projected.activeStage).toBe("compile")
  expect(projected.attemptId).toBe("compile-attempt")
})
