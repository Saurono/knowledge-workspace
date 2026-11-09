import { retryCompiledSourceIndex } from "@/app/retrieval/source-index"
import { phaseReceipts } from "@/app/obsidian/phase-receipts"
import { beginStage, finishStage, retryStage, type IngestionCheckpointV1 } from "@/modules/ingestion/domain"
import { projectPhaseReceipt } from "@/modules/obsidian/application"
import type { EmbeddingConfig } from "@/modules/retrieval/domain"

/** Retries only native indexing from the already compiled source receipt. */
export async function retryIngestionIndex(projectPath: string, id: string, config: EmbeddingConfig) {
  const records = await phaseReceipts.read(projectPath)
  const previous = records.receipts[id]
  if (!previous || previous.sourceRevision === null || previous.revisionKind === "unknown") throw new Error("A known compiled source revision is required to retry indexing")
  if (!["failed", "blocked", "cancelled"].includes(previous.checkpoint.stages.index.status)) throw new Error("Index stage is not retryable")
  const now = new Date().toISOString()
  let checkpoint = retryStage(previous.checkpoint as IngestionCheckpointV1, "index", now)
  const attemptToken = `${previous.runId}-index-retry-${crypto.randomUUID()}`
  let feedbackAttempt: string | undefined
  checkpoint = beginStage(checkpoint, "index", { attemptId: attemptToken, now })
  await phaseReceipts.save(projectPath, projectPhaseReceipt({ ...previous, id: "", checkpoint, attemptId: attemptToken, now }))
  try {
    const result = await retryCompiledSourceIndex({ projectPath, sourceId: previous.sourceId, config, attemptToken })
    if (result.status !== "succeeded") throw new Error(result.record.error?.message ?? `Index ${result.status}`)
    const refs = result.record.pages.flatMap((page) => page.evidence ? [`index:${page.pageId}:${page.evidence.manifestRef}`] : [])
    checkpoint = finishStage(checkpoint, "index", { attempt: checkpoint.stages.index.attempt, attemptId: attemptToken, now: new Date().toISOString(), outcome: "succeeded", evidence: refs })
    const updated = projectPhaseReceipt({ ...previous, id: "", checkpoint, attemptId: attemptToken, indexCommitRefs: refs, now: checkpoint.updatedAt })
    await phaseReceipts.save(projectPath, updated)
    if (checkpoint.policy.feedback === "required") {
      feedbackAttempt = `${previous.runId}-feedback-retry-${crypto.randomUUID()}`
      const feedbackNow = new Date().toISOString()
      if (["failed", "blocked", "cancelled"].includes(checkpoint.stages.feedback.status)) checkpoint = retryStage(checkpoint, "feedback", feedbackNow)
      checkpoint = beginStage(checkpoint, "feedback", { attemptId: feedbackAttempt, now: feedbackNow })
      const feedbackStarted = projectPhaseReceipt({ ...previous, id: "", checkpoint, attemptId: feedbackAttempt, indexCommitRefs: refs, now: checkpoint.updatedAt })
      await phaseReceipts.save(projectPath, feedbackStarted)
      await phaseReceipts.deliver(projectPath, feedbackStarted.id)
      const firstDelivery = (await phaseReceipts.read(projectPath)).receipts[feedbackStarted.id]
      if (!firstDelivery || firstDelivery.delivery !== "delivered" || !firstDelivery.deliveredDigest) throw new Error("Vault receipt delivery has no verified read-back")
      checkpoint = finishStage(checkpoint, "feedback", { attempt: checkpoint.stages.feedback.attempt, attemptId: feedbackAttempt,
        now: new Date().toISOString(), outcome: "succeeded", evidence: [`vault-receipt-sha256:${firstDelivery.deliveredDigest}`] })
      await phaseReceipts.save(projectPath, projectPhaseReceipt({ ...previous, id: "", checkpoint, attemptId: feedbackAttempt, indexCommitRefs: refs, now: checkpoint.updatedAt }))
      await phaseReceipts.deliver(projectPath, feedbackStarted.id)
      const finalDelivery = (await phaseReceipts.read(projectPath)).receipts[feedbackStarted.id]
      if (!finalDelivery || finalDelivery.delivery !== "delivered" || !finalDelivery.deliveredDigest) throw new Error("Final Vault receipt snapshot is pending delivery")
    }
    return result
  } catch (error) {
    if (checkpoint.stages.index.status === "running") {
      checkpoint = finishStage(checkpoint, "index", { attempt: checkpoint.stages.index.attempt, attemptId: attemptToken, now: new Date().toISOString(), outcome: "failed", error: { code: "index_retry_failed", message: String(error) } })
      await phaseReceipts.save(projectPath, projectPhaseReceipt({ ...previous, id: "", checkpoint, attemptId: attemptToken, now: checkpoint.updatedAt }))
    }
    if (feedbackAttempt && checkpoint.stages.feedback.status === "running") {
      checkpoint = finishStage(checkpoint, "feedback", { attempt: checkpoint.stages.feedback.attempt, attemptId: feedbackAttempt,
        now: new Date().toISOString(), outcome: "failed", error: { code: "feedback_retry_failed", message: String(error) } })
      await phaseReceipts.save(projectPath, projectPhaseReceipt({ ...previous, id: "", checkpoint, attemptId: feedbackAttempt, indexCommitRefs: checkpoint.stages.index.evidence, now: checkpoint.updatedAt }))
    }
    throw error
  }
}
