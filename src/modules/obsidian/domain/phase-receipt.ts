export type PhaseStageRecord = { status: string; attempt: number; attemptId: string | null; startedAt: string | null; finishedAt: string | null; evidence: string[]; error: { code: string; message: string } | null }
export type PhaseStageSnapshot = Record<"receive" | "parse" | "compile" | "index" | "feedback", PhaseStageRecord>
export type PhaseSummary = { status: string; contentReady: boolean; knowledgeReady: boolean; feedbackDelivered: boolean; complete: boolean }

export interface PhaseReceiptV2 {
  schemaVersion: 2
  id: string
  projectId: string
  sourceId: string
  sourceKind?: "generated-wiki" | "raw" | "unknown"
  sourceRevision: string | null
  revisionKind: "raw-bytes-sha256" | "parsed-text-sha256" | "unknown"
  runId: string
  supersededBy?: string
  attemptId: string | null
  activeStage: "receive" | "parse" | "compile" | "index" | "feedback" | null
  checkpoint: { schemaVersion: 1; projectId: string; documentId: string; createdAt: string; updatedAt: string; policy: { index: "required" | "disabled"; feedback: "required" | "disabled" }; stages: PhaseStageSnapshot }
  stages: PhaseStageSnapshot
  summary: PhaseSummary
  outputVersions: Array<{ path: string; version: string }>
  indexCommitRefs: string[]
  error: { code: string; message: string } | null
  times: { receivedAt: string | null; sourceIngestedAt: string | null; revisionIngestedAt: string | null }
  delivery: "pending" | "delivered"
  deliveredDigest: string | null
  deliveryError: string | null
  deliveredAt: string | null
  updatedAt: string
}

export function phaseReceiptPayload(receipt: PhaseReceiptV2) {
  const { delivery: _delivery, deliveredDigest: _digest, deliveryError: _deliveryError, deliveredAt: _deliveredAt, ...payload } = receipt
  return payload
}
