export const INGESTION_STAGES = ["receive", "parse", "compile", "index", "feedback"] as const
export type IngestionStage = typeof INGESTION_STAGES[number]
export type StageStatus = "pending" | "running" | "succeeded" | "failed" | "blocked" | "cancelled" | "skipped"
export interface StageError { code: string; message: string }
export interface IngestionStageRecord { status: StageStatus; attempt: number; attemptId: string | null; startedAt: string | null; finishedAt: string | null; evidence: string[]; error: StageError | null }
export interface IngestionCheckpointV1 { schemaVersion: 1; projectId: string; documentId: string; createdAt: string; updatedAt: string; policy: { index: "required" | "disabled"; feedback: "required" | "disabled" }; stages: Record<IngestionStage, IngestionStageRecord> }
export type IngestionSummaryStatus = "received" | "processing" | "waiting" | "failed" | "cancelled" | "partial" | "ready"
export interface IngestionSummary { status: IngestionSummaryStatus; contentReady: boolean; knowledgeReady: boolean; feedbackDelivered: boolean; complete: boolean }
export interface CreateReceivedCheckpointInput { projectId: string; documentId: string; receivedAt: string; artifactRef: string; indexPolicy?: "required" | "disabled"; feedbackPolicy?: "required" | "disabled" }
export interface CheckpointError extends Error { code: string }
function fail(message: string): never { const error = new Error(message) as CheckpointError; error.code = "invalid_argument"; throw error }
function validId(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value) }
function time(value: unknown): value is string {
  if (typeof value !== "string") return false
  const match = value.match(/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/)
  if (!match || !Number.isFinite(Date.parse(value))) return false
  const [, year, month, day] = match
  const calendar = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
  return calendar.getUTCFullYear() === Number(year) && calendar.getUTCMonth() + 1 === Number(month) && calendar.getUTCDate() === Number(day)
}
function clone<T>(value: T): T { return structuredClone(value) }
function empty(status: StageStatus = "pending"): IngestionStageRecord { return { status, attempt: 0, attemptId: null, startedAt: null, finishedAt: null, evidence: [], error: null } }
export function createReceivedCheckpoint(input: CreateReceivedCheckpointInput): IngestionCheckpointV1 {
  if (!validId(input.projectId) || !validId(input.documentId)) fail("Invalid project or document identifier")
  if (!time(input.receivedAt)) fail("Invalid receive time")
  if (typeof input.artifactRef !== "string" || !input.artifactRef.trim()) fail("Artifact reference is required")
  const policy = { index: input.indexPolicy ?? "required", feedback: input.feedbackPolicy ?? "disabled" }
  if (!["required", "disabled"].includes(policy.index) || !["required", "disabled"].includes(policy.feedback)) fail("Invalid checkpoint policy")
  const stages: IngestionCheckpointV1["stages"] = { receive: empty(), parse: empty(), compile: empty(), index: empty(), feedback: empty() }
  stages.receive = { status: "succeeded", attempt: 1, attemptId: null, startedAt: input.receivedAt, finishedAt: input.receivedAt, evidence: [input.artifactRef], error: null }
  if (policy.index === "disabled") stages.index = empty("skipped")
  if (policy.feedback === "disabled") stages.feedback = empty("skipped")
  return { schemaVersion: 1, projectId: input.projectId, documentId: input.documentId, createdAt: input.receivedAt, updatedAt: input.receivedAt, policy, stages }
}
function orderedTime(checkpoint: IngestionCheckpointV1, now: string) { if (!time(now) || Date.parse(now) < Date.parse(checkpoint.updatedAt)) fail("Operation time is invalid or precedes checkpoint") }
function validStage(stage: string): stage is IngestionStage { return (INGESTION_STAGES as readonly string[]).includes(stage) }
export function beginStage(checkpoint: IngestionCheckpointV1, stage: IngestionStage, input: { attemptId: string; now: string }): IngestionCheckpointV1 {
  validateCheckpoint(checkpoint); orderedTime(checkpoint, input.now)
  if (!validStage(stage) || typeof input.attemptId !== "string" || !input.attemptId.trim()) fail("Invalid stage attempt")
  const record = checkpoint.stages[stage], position = INGESTION_STAGES.indexOf(stage)
  if (record.status !== "pending" || INGESTION_STAGES.slice(0, position).some(previous => !["succeeded", "skipped"].includes(checkpoint.stages[previous].status))) fail("Stage is not ready to begin")
  const next = clone(checkpoint); const target = next.stages[stage]
  target.status = "running"; target.attempt++; target.attemptId = input.attemptId; target.startedAt = input.now; target.finishedAt = null; target.evidence = []; target.error = null; next.updatedAt = input.now
  return next
}
export function finishStage(checkpoint: IngestionCheckpointV1, stage: IngestionStage, input: { attempt: number; attemptId: string; now: string; outcome: "succeeded" | "failed" | "blocked" | "cancelled"; evidence?: string[]; error?: StageError }): IngestionCheckpointV1 {
  validateCheckpoint(checkpoint); orderedTime(checkpoint, input.now)
  const current = checkpoint.stages[stage]
  if (!current || current.status !== "running" || current.attempt !== input.attempt || current.attemptId !== input.attemptId) fail("Stage attempt is stale or not running")
  if (!input || !["succeeded", "failed", "blocked", "cancelled"].includes(input.outcome)) fail("Invalid stage outcome")
  const evidence = input.evidence ?? []
  if (!Array.isArray(evidence) || evidence.some(item => typeof item !== "string" || !item.trim())) fail("Invalid stage evidence")
  if (input.outcome === "succeeded" && !evidence.some(item => item.trim())) fail("Successful stages require evidence")
  if (input.outcome !== "succeeded" && (!input.error || typeof input.error.code !== "string" || !input.error.code.trim() || typeof input.error.message !== "string" || !input.error.message.trim())) fail("Non-success outcomes require a structured error")
  const next = clone(checkpoint), target = next.stages[stage]; target.status = input.outcome; target.finishedAt = input.now; target.evidence = [...evidence]; target.error = input.outcome === "succeeded" ? null : { code: input.error!.code, message: input.error!.message }; next.updatedAt = input.now
  return next
}
export function retryStage(checkpoint: IngestionCheckpointV1, stage: IngestionStage, now: string): IngestionCheckpointV1 {
  validateCheckpoint(checkpoint); orderedTime(checkpoint, now)
  const current = checkpoint.stages[stage]
  if (!current || !["failed", "blocked", "cancelled"].includes(current.status) || checkpoint.stages[stage].status === "skipped") fail("Stage cannot be retried")
  const next = clone(checkpoint), attempt = next.stages[stage].attempt
  Object.assign(next.stages[stage], empty()); next.stages[stage].attempt = attempt; next.updatedAt = now; return next
}
export function recoverInterrupted(checkpoint: IngestionCheckpointV1, now: string): IngestionCheckpointV1 {
  validateCheckpoint(checkpoint)
  const running = INGESTION_STAGES.filter(stage => checkpoint.stages[stage].status === "running")
  if (!running.length) return checkpoint
  orderedTime(checkpoint, now)
  const next = clone(checkpoint)
  for (const stage of running) { const record = next.stages[stage]; record.status = "blocked"; record.finishedAt = now; record.error = { code: "interrupted", message: "Stage execution was interrupted" } }
  next.updatedAt = now; return next
}
export function validateCheckpoint(value: unknown): asserts value is IngestionCheckpointV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("Checkpoint must be an object")
  const cp = value as IngestionCheckpointV1
  if (cp.schemaVersion !== 1 || !validId(cp.projectId) || !validId(cp.documentId) || !time(cp.createdAt) || !time(cp.updatedAt) || Date.parse(cp.updatedAt) < Date.parse(cp.createdAt)) fail("Invalid checkpoint identity or timestamps")
  if (!cp.policy || !["required", "disabled"].includes(cp.policy.index) || !["required", "disabled"].includes(cp.policy.feedback)) fail("Invalid checkpoint policy")
  if (!cp.stages || typeof cp.stages !== "object" || Object.keys(cp.stages).length !== INGESTION_STAGES.length || INGESTION_STAGES.some(stage => !(stage in cp.stages))) fail("Incomplete checkpoint stages")
  for (let stageIndex = 0; stageIndex < INGESTION_STAGES.length; stageIndex++) {
    const stage = INGESTION_STAGES[stageIndex]
    const r = cp.stages[stage]
    if (!r || !["pending", "running", "succeeded", "failed", "blocked", "cancelled", "skipped"].includes(r.status) || !Number.isSafeInteger(r.attempt) || r.attempt < 0 || !Array.isArray(r.evidence) || r.evidence.some(e => typeof e !== "string" || !e.trim())) fail(`Invalid ${stage} record`)
    if (r.status === "skipped" && (r.attempt !== 0 || !((stage === "index" && cp.policy.index === "disabled") || (stage === "feedback" && cp.policy.feedback === "disabled")))) fail(`${stage} cannot be skipped`)
    if ((stage === "index" && cp.policy.index === "disabled" || stage === "feedback" && cp.policy.feedback === "disabled") && r.status !== "skipped") fail(`Disabled ${stage} must be skipped`)
    if (r.status === "running") { if (r.attempt < 1 || typeof r.attemptId !== "string" || !r.attemptId.trim() || !time(r.startedAt) || Date.parse(r.startedAt) < Date.parse(cp.createdAt) || Date.parse(r.startedAt) > Date.parse(cp.updatedAt) || r.finishedAt !== null || r.error !== null || r.evidence.length) fail(`Invalid running ${stage} record`) }
    else if (r.status === "pending" || r.status === "skipped") { if (r.attemptId !== null || r.startedAt !== null || r.finishedAt !== null || r.error !== null || r.evidence.length) fail(`Invalid ${r.status} ${stage} record`) }
    else { if (r.attempt < 1 || !(stage === "receive" && r.status === "succeeded" && r.attemptId === null) && (typeof r.attemptId !== "string" || !r.attemptId.trim()) || !time(r.startedAt) || !time(r.finishedAt) || Date.parse(r.startedAt) < Date.parse(cp.createdAt) || Date.parse(r.finishedAt) < Date.parse(r.startedAt) || Date.parse(r.finishedAt) > Date.parse(cp.updatedAt)) fail(`Invalid finished ${stage} record`); if (r.status === "succeeded" ? !r.evidence.length || r.error !== null : !r.error || typeof r.error.code !== "string" || !r.error.code.trim() || typeof r.error.message !== "string" || !r.error.message.trim()) fail(`Invalid ${stage} result`) }
    if (r.startedAt && INGESTION_STAGES.slice(0, stageIndex).some(previous => cp.stages[previous].finishedAt && Date.parse(r.startedAt!) < Date.parse(cp.stages[previous].finishedAt!))) fail(`${stage} started before an upstream stage finished`)
  }
  for (let i = 0; i < INGESTION_STAGES.length; i++) { const stage = INGESTION_STAGES[i], record = cp.stages[stage]; if ((record.status !== "pending" || record.attempt > 0) && record.status !== "skipped" && INGESTION_STAGES.slice(0, i).some(prev => !["succeeded", "skipped"].includes(cp.stages[prev].status))) fail(`${stage} violates stage dependencies`) }
}
export function summarizeIngestion(checkpoint: IngestionCheckpointV1): IngestionSummary {
  validateCheckpoint(checkpoint)
  const { stages, policy } = checkpoint, contentReady = stages.compile.status === "succeeded" && stages.compile.evidence.some(e => !!e.trim())
  const knowledgeReady = contentReady && (stages.index.status === "succeeded" || (policy.index === "disabled" && stages.index.status === "skipped"))
  const feedbackDelivered = stages.feedback.status === "succeeded" && stages.feedback.evidence.length > 0
  const complete = knowledgeReady && (policy.feedback === "disabled" || feedbackDelivered)
  const statuses = INGESTION_STAGES.map(stage => stages[stage].status)
  let status: IngestionSummaryStatus
  if (statuses.includes("running")) status = "processing"
  else if (contentReady) status = complete ? "ready" : "partial"
  else if (statuses.includes("failed")) status = "failed"
  else if (statuses.includes("cancelled")) status = "cancelled"
  else if (stages.receive.status === "succeeded" && stages.parse.status === "pending") status = "received"
  else if (statuses.includes("blocked") || stages.parse.status === "succeeded" || stages.compile.status === "pending") status = "waiting"
  else status = "waiting"
  return { status, contentReady, knowledgeReady, feedbackDelivered, complete }
}
