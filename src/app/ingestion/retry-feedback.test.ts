import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import { beginStage, createReceivedCheckpoint, finishStage, retryStage, type IngestionCheckpointV1 } from "@/modules/ingestion/domain"
import { projectPhaseReceipt } from "@/modules/obsidian/application"
import { phaseReceiptPayload, type PhaseReceiptV2 } from "@/modules/obsidian/domain"
import { createFeedbackRetryService } from "./retry-feedback"

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex")
const at = (seconds: number) => new Date(Date.UTC(2026, 10, 8, 10, 0, seconds)).toISOString()

function fixture(overrides: { deliver?: (projectPath: string, id: string) => Promise<boolean> } = {}) {
  let checkpoint = createReceivedCheckpoint({ projectId: "project-1", documentId: "source-1", receivedAt: at(0), artifactRef: "raw-source:source-1", feedbackPolicy: "required" })
  checkpoint = beginStage(checkpoint, "parse", { attemptId: "parse-1", now: at(1) })
  checkpoint = finishStage(checkpoint, "parse", { attempt: 1, attemptId: "parse-1", now: at(2), outcome: "succeeded", evidence: ["parsed"] })
  checkpoint = beginStage(checkpoint, "compile", { attemptId: "compile-1", now: at(3) })
  checkpoint = finishStage(checkpoint, "compile", { attempt: 1, attemptId: "compile-1", now: at(4), outcome: "succeeded", evidence: ["compiled"] })
  checkpoint = beginStage(checkpoint, "index", { attemptId: "index-1", now: at(5) })
  checkpoint = finishStage(checkpoint, "index", { attempt: 1, attemptId: "index-1", now: at(6), outcome: "succeeded", evidence: ["index:page:manifest"] })
  checkpoint = beginStage(checkpoint, "feedback", { attemptId: "feedback-1", now: at(7) })
  checkpoint = finishStage(checkpoint, "feedback", { attempt: 1, attemptId: "feedback-1", now: at(8), outcome: "failed", error: { code: "vault_offline", message: "Vault offline" } })
  let receipt = projectPhaseReceipt({
    id: "", sourceId: "source-1", sourceKind: "raw", sourceRevision: "a".repeat(64), runId: "run-1", checkpoint,
    times: { receivedAt: at(0), sourceIngestedAt: at(4), revisionIngestedAt: at(4) }, indexCommitRefs: ["index:page:manifest"], now: at(8),
  })
  const records = { vaultPath: "/vault", receipts: { [receipt.id]: receipt } }
  let nowSeconds = 9
  let attempt = 0
  const deliver = overrides.deliver ?? (async (_projectPath: string, id: string) => {
    const current = records.receipts[id]
    if (!current) throw new Error(`Missing phase receipt ${id}; known: ${Object.keys(records.receipts).join(",")}`)
    records.receipts[id] = { ...current, delivery: "delivered", deliveredDigest: hash(phaseReceiptPayload(current)), deliveredAt: at(nowSeconds), deliveryError: null }
    nowSeconds++
    return true
  })
  const service = createFeedbackRetryService({
    async read() { return structuredClone(records) },
    async save(_projectPath, next) { records.receipts[next.id] = structuredClone(next); receipt = next },
    deliver,
    now: () => at(nowSeconds++),
    createAttemptId: () => `feedback-retry-${++attempt}`,
  })
  return { service, records, receipt, setReceipt(value: PhaseReceiptV2) { records.receipts[value.id] = structuredClone(value); receipt = value }, get receiptNow() { return receipt } }
}

describe("feedback-only receipt recovery", () => {
  it("records delivered-digest evidence and completes feedback without touching compile or index", async () => {
    const fake = fixture()
    const result = await fake.service.retry("/project", fake.receipt.id)
    expect(result).toBe(true)
    const final = fake.records.receipts[fake.receipt.id]
    expect(final.checkpoint.stages.compile.status).toBe("succeeded")
    expect(final.checkpoint.stages.index.status).toBe("succeeded")
    expect(final.checkpoint.stages.feedback.status).toBe("succeeded")
    expect(final.checkpoint.stages.feedback.evidence).toHaveLength(1)
    expect(final.checkpoint.stages.feedback.evidence[0]).toMatch(/^vault-receipt-sha256:[a-f0-9]{64}$/)
    expect(final.delivery).toBe("delivered")
    expect(final.deliveredDigest).toMatch(/^[a-f0-9]{64}$/)
    expect(final.summary.complete).toBe(true)
  })

  it("persists a failed feedback attempt when Vault delivery still fails", async () => {
    const fake = fixture({ deliver: async () => { throw new Error("Vault disconnected") } })
    await expect(fake.service.retry("/project", fake.receipt.id)).rejects.toThrow("Vault disconnected")
    const saved = fake.records.receipts[fake.receipt.id]
    expect(saved.checkpoint.stages.feedback.status).toBe("failed")
    expect(saved.checkpoint.stages.feedback.error?.code).toBe("feedback_retry_failed")
    expect(saved.checkpoint.stages.compile.status).toBe("succeeded")
    expect(saved.checkpoint.stages.index.status).toBe("succeeded")
  })

  it("does not finish a stale feedback attempt after another attempt replaces it", async () => {
    let release!: () => void
    let entered!: () => void
    const deliveryStarted = new Promise<void>(resolve => { entered = resolve })
    const fake = fixture({ deliver: async () => new Promise<boolean>(resolve => { entered(); release = () => resolve(true) }) })
    const running = fake.service.retry("/project", fake.receipt.id)
    await deliveryStarted
    const current = fake.records.receipts[fake.receipt.id]
    const oldAttempt = current.checkpoint.stages.feedback.attemptId!
    const finishedOld = finishStage(current.checkpoint as IngestionCheckpointV1, "feedback", {
      attempt: current.checkpoint.stages.feedback.attempt, attemptId: oldAttempt, now: at(15), outcome: "failed", error: { code: "replaced", message: "Superseded" },
    })
    let newer = retryStage(finishedOld, "feedback", at(16))
    newer = beginStage(newer, "feedback", { attemptId: "newer-feedback-attempt", now: at(17) })
    fake.setReceipt(projectPhaseReceipt({ ...current, id: "", checkpoint: newer, attemptId: "newer-feedback-attempt", now: at(17) }))
    release()
    await expect(running).resolves.toBe(false)
    expect(fake.records.receipts[fake.receipt.id].checkpoint.stages.feedback.attemptId).toBe("newer-feedback-attempt")
    expect(fake.records.receipts[fake.receipt.id].checkpoint.stages.feedback.status).toBe("running")
  })
})
