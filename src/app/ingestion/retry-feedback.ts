import { finishStage, beginStage, retryStage, type IngestionCheckpointV1 } from "@/modules/ingestion/domain"
import { projectPhaseReceipt } from "@/modules/obsidian/application"
import type { PhaseReceiptV2 } from "@/modules/obsidian/domain"
import { phaseReceipts } from "@/app/obsidian/phase-receipts"

export interface FeedbackRetryRecords { vaultPath: string | null; receipts: Record<string, PhaseReceiptV2> }
export interface FeedbackRetryPorts {
  read(projectPath: string): Promise<FeedbackRetryRecords>
  save(projectPath: string, receipt: PhaseReceiptV2): Promise<void>
  deliver(projectPath: string, receiptId: string): Promise<boolean>
  now(): string
  createAttemptId(runId: string): string
}

export function isFeedbackRetryable(receipt: PhaseReceiptV2): boolean {
  const checkpoint = receipt.checkpoint
  return checkpoint.policy.feedback === "required" &&
    checkpoint.stages.compile.status === "succeeded" &&
    ["succeeded", "skipped"].includes(checkpoint.stages.index.status) &&
    ["pending", "failed", "blocked", "cancelled"].includes(checkpoint.stages.feedback.status)
}

export function createFeedbackRetryService(ports: FeedbackRetryPorts) {
  const active = new Map<string, Promise<boolean>>()

  const matchesAttempt = (receipt: PhaseReceiptV2 | undefined, source: PhaseReceiptV2, attemptId: string) =>
    !!receipt && receipt.id === source.id && receipt.runId === source.runId && receipt.sourceId === source.sourceId &&
    receipt.sourceRevision === source.sourceRevision && receipt.checkpoint.stages.feedback.status === "running" &&
    receipt.checkpoint.stages.feedback.attemptId === attemptId

  async function retry(projectPath: string, receiptId: string): Promise<boolean> {
    const key = `${projectPath}\0${receiptId}`
    const pending = active.get(key)
    if (pending) return pending
    const operation = perform(projectPath, receiptId).finally(() => active.delete(key))
    active.set(key, operation)
    return operation
  }

  async function perform(projectPath: string, receiptId: string): Promise<boolean> {
    const records = await ports.read(projectPath)
    if (!records.vaultPath) return false
    const initial = records.receipts[receiptId]
    if (!initial || !isFeedbackRetryable(initial)) return false
    const nowAtLeast = (receipt: PhaseReceiptV2) => {
      const current = ports.now()
      return Date.parse(current) < Date.parse(receipt.checkpoint.updatedAt) ? receipt.checkpoint.updatedAt : current
    }
    const startedAt = nowAtLeast(initial)
    let checkpoint = initial.checkpoint as IngestionCheckpointV1
    if (["failed", "blocked", "cancelled"].includes(checkpoint.stages.feedback.status))
      checkpoint = retryStage(checkpoint, "feedback", startedAt)
    const attemptId = ports.createAttemptId(initial.runId)
    checkpoint = beginStage(checkpoint, "feedback", { attemptId, now: startedAt })
    let candidate = projectPhaseReceipt({ ...initial, id: "", checkpoint, attemptId, now: checkpoint.updatedAt })

    // Do not replace an attempt that changed while this work was being prepared.
    const beforeSave = (await ports.read(projectPath)).receipts[receiptId]
    if (!beforeSave || beforeSave.runId !== initial.runId || beforeSave.sourceRevision !== initial.sourceRevision ||
        beforeSave.checkpoint.stages.feedback.status !== initial.checkpoint.stages.feedback.status ||
        beforeSave.checkpoint.stages.feedback.attemptId !== initial.checkpoint.stages.feedback.attemptId) return false
    await ports.save(projectPath, candidate)
    let latest = (await ports.read(projectPath)).receipts[receiptId]
    if (!matchesAttempt(latest, initial, attemptId)) return false

    try {
      await ports.deliver(projectPath, receiptId)
      latest = (await ports.read(projectPath)).receipts[receiptId]
      if (!matchesAttempt(latest, initial, attemptId)) return false
      if (latest.delivery !== "delivered" || !latest.deliveredDigest) throw new Error("Vault receipt delivery has no verified read-back")

      checkpoint = finishStage(latest.checkpoint as IngestionCheckpointV1, "feedback", {
        attempt: latest.checkpoint.stages.feedback.attempt,
        attemptId,
        now: nowAtLeast(latest),
        outcome: "succeeded",
        evidence: [`vault-receipt-sha256:${latest.deliveredDigest}`],
      })
      candidate = projectPhaseReceipt({ ...latest, id: "", checkpoint, attemptId, now: checkpoint.updatedAt })
      const beforeFinishSave = (await ports.read(projectPath)).receipts[receiptId]
      if (!matchesAttempt(beforeFinishSave, initial, attemptId)) return false
      await ports.save(projectPath, candidate)
      latest = (await ports.read(projectPath)).receipts[receiptId]
      if (!latest || latest.checkpoint.stages.feedback.status !== "succeeded" || latest.checkpoint.stages.feedback.attemptId !== attemptId) return false

      await ports.deliver(projectPath, receiptId)
      latest = (await ports.read(projectPath)).receipts[receiptId]
      if (!latest || latest.checkpoint.stages.feedback.status !== "succeeded" || latest.checkpoint.stages.feedback.attemptId !== attemptId ||
          latest.delivery !== "delivered" || !latest.deliveredDigest) throw new Error("Final Vault feedback receipt is pending delivery")
      return true
    } catch (error) {
      latest = (await ports.read(projectPath)).receipts[receiptId]
      if (matchesAttempt(latest, initial, attemptId)) {
        checkpoint = finishStage(latest!.checkpoint as IngestionCheckpointV1, "feedback", {
          attempt: latest!.checkpoint.stages.feedback.attempt,
          attemptId,
          now: nowAtLeast(latest!),
          outcome: "failed",
          error: { code: "feedback_retry_failed", message: error instanceof Error ? error.message : String(error) },
        })
        candidate = projectPhaseReceipt({ ...latest!, id: "", checkpoint, attemptId, now: checkpoint.updatedAt })
        await ports.save(projectPath, candidate)
      }
      throw error
    }
  }

  return { retry }
}

const retryService = createFeedbackRetryService({
  read: projectPath => phaseReceipts.read(projectPath),
  save: (projectPath, receipt) => phaseReceipts.save(projectPath, receipt),
  deliver: (projectPath, receiptId) => phaseReceipts.deliver(projectPath, receiptId),
  now: () => new Date().toISOString(),
  createAttemptId: runId => `${runId}-feedback-retry-${crypto.randomUUID()}`,
})

/** Recover Vault feedback delivery only; it never recompiles or reindexes. */
export const retryIngestionFeedback = retryService.retry
