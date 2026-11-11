export type WritebackStatus = "draft" | "conflict" | "rejected" | "published"
export type KnowledgeResolution = "open" | "workaround" | "verified" | "superseded"
export type AttemptOutcome = "failed" | "unverified" | "verified"

export interface WritebackObservation {
  id: string
  tool: string
  outcome: "succeeded" | "failed" | "cancelled" | "unknown"
  occurredAt: string
  /** A reference or digest only. Do not persist arbitrary tool output here. */
  evidenceRef?: string
  targetHash?: string
  environment?: string
  verification?: { kind: "user-manual" | "bound-executor"; targetHash: string; artifactId?: string; version?: string; environment: string; observedAt: string }
}
export interface WritebackArtifact {
  id: string
  path: string
  version: string
  contentHash: string
  visibility: "private" | "project" | "role"
  roleId?: string
}
export interface TroubleshootingAttempt { id: string; description: string; outcome: AttemptOutcome; evidenceRefs: string[] }
export interface TroubleshootingKnowledge {
  kind: "troubleshooting"
  title: string
  symptom: string
  environment: string
  applicability: string[]
  rootCause: string
  rootCauseStatus: "unknown" | "suspected" | "confirmed"
  attempts: TroubleshootingAttempt[]
  resolution: KnowledgeResolution
  solution: string
  evidenceRefs: string[]
  limitations: string[]
}
export interface UsageGuideKnowledge {
  kind: "usage-guide"
  title: string
  artifact: WritebackArtifact
  purpose: string
  prerequisites: string[]
  steps: string[]
  checks: string[]
  limitations: string[]
  relatedProblemIds: string[]
  status: "needs-authoring" | "ready-for-review" | "needs-update"
}
export interface ProcedureKnowledge {
  kind: "procedure"
  title: string
  applicability: string[]
  prerequisites: string[]
  steps: string[]
  verification: string[]
  nonApplicableWhen: string[]
  relatedProblemIds: string[]
  relatedGuideIds: string[]
}
export type WritebackKnowledge = TroubleshootingKnowledge | UsageGuideKnowledge | ProcedureKnowledge
export interface WikiWritebackDraft {
  schemaVersion: 1
  id: string
  idempotencyKey: string
  payloadDigest: string
  projectId: string
  runId: string
  scopeId: string
  status: WritebackStatus
  revision: number
  createdAt: string
  updatedAt: string
  expectedBaseRevision: string | null
  observations: WritebackObservation[]
  artifacts: WritebackArtifact[]
  knowledge: WritebackKnowledge[]
  creator: { kind: "agent" | "user" | "system"; id: string; effectivePrincipalId?: string }
  reviewer?: { kind: "user"; id: string; decisionAt: string }
  publishedPageIds: string[]
  lastError?: string
}

const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value)
const safeId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(value)
const stringList = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === "string")

/** Verification requires an explicit event bound to the artifact and environment. */
export function isResolutionVerified(observations: readonly WritebackObservation[], targetHash: string, environment: string, artifact?: WritebackArtifact): boolean {
  return hash(targetHash) && !!environment && observations.some(item => item.outcome === "succeeded" && !!item.verification?.observedAt &&
    (!artifact || (item.verification?.artifactId === artifact.id && item.verification.version === artifact.version)) && item.verification?.targetHash === targetHash &&
    item.verification.environment === environment && hash(item.verification.targetHash) &&
    (item.verification.kind === "user-manual" || item.verification.kind === "bound-executor"))
}

/** Stable key; storage must also compare the canonical payload digest. */
export function writebackIdempotencyKey(input: { projectId: string; runId: string; scopeId: string; artifacts: readonly WritebackArtifact[]; observations: readonly WritebackObservation[] }): string {
  const canonical = JSON.stringify({
    projectId: input.projectId, runId: input.runId, scopeId: input.scopeId,
    artifacts: [...input.artifacts].map(({ id, version, contentHash }) => ({ id, version, contentHash })).sort((a, b) => a.id.localeCompare(b.id)),
    observations: [...input.observations].map(({ id, tool, outcome, occurredAt, evidenceRef, targetHash, environment, verification }) => ({ id, tool, outcome, occurredAt, evidenceRef, targetHash, environment, verification })).sort((a, b) => a.id.localeCompare(b.id)),
  })
  let a = 0x811c9dc5, b = 0x9e3779b9
  for (let i = 0; i < canonical.length; i++) { a = Math.imul(a ^ canonical.charCodeAt(i), 0x01000193); b = Math.imul(b ^ canonical.charCodeAt(i), 0x85ebca6b) }
  return `wb1-${(a >>> 0).toString(16).padStart(8, "0")}${(b >>> 0).toString(16).padStart(8, "0")}`
}

export function validateWritebackDraft(value: unknown): value is WikiWritebackDraft {
  try {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const d = value as WikiWritebackDraft
  if (d.schemaVersion !== 1 || !safeId(d.id) || !/^wb1-[a-f0-9]{16}$/.test(d.idempotencyKey) || !hash(d.payloadDigest) ||
    !safeId(d.projectId) || !safeId(d.runId) || !safeId(d.scopeId) ||
    !["draft", "conflict", "rejected", "published"].includes(d.status) || !Number.isSafeInteger(d.revision) || d.revision < 1 ||
    typeof d.createdAt !== "string" || typeof d.updatedAt !== "string" ||
    !(d.expectedBaseRevision === null || typeof d.expectedBaseRevision === "string") ||
    !Array.isArray(d.observations) || !Array.isArray(d.artifacts) || !Array.isArray(d.knowledge) ||
    !d.creator || !["agent", "user", "system"].includes(d.creator.kind) || typeof d.creator.id !== "string" ||
    !Array.isArray(d.publishedPageIds) || !d.publishedPageIds.every(safeId)) return false
  if (!d.observations.every(o => !!o && safeId(o.id) && typeof o.tool === "string" && ["succeeded", "failed", "cancelled", "unknown"].includes(o.outcome) && typeof o.occurredAt === "string")) return false
  if (!d.artifacts.every(a => !!a && safeId(a.id) && typeof a.path === "string" && typeof a.version === "string" && hash(a.contentHash) && ["private", "project", "role"].includes(a.visibility))) return false
  return d.knowledge.every(k => {
    if (!k || typeof k !== "object" || typeof k.title !== "string") return false
    if (k.kind === "troubleshooting" && (k.resolution === "verified" || k.attempts?.some(a => a.outcome === "verified"))) {
      const bound = (refs: string[]) => d.artifacts.some(a => isResolutionVerified(d.observations.filter(o => refs.includes(o.id)), a.contentHash, k.environment, a))
      if ((k.resolution === "verified" && !bound(k.evidenceRefs)) || k.attempts.some(a => a.outcome === "verified" && !bound(a.evidenceRefs))) return false
    }
    if (k.kind === "troubleshooting") return typeof k.symptom === "string" && typeof k.environment === "string" && stringList(k.applicability) &&
      ["unknown", "suspected", "confirmed"].includes(k.rootCauseStatus) && ["open", "workaround", "verified", "superseded"].includes(k.resolution) &&
      Array.isArray(k.attempts) && stringList(k.evidenceRefs) && stringList(k.limitations) &&
      k.attempts.every(a => !!a && safeId(a.id) && typeof a.description === "string" && ["failed", "unverified", "verified"].includes(a.outcome) && stringList(a.evidenceRefs))
    if (k.kind === "usage-guide") return !!k.artifact && safeId(k.artifact.id) && !!k.artifact.path && !!k.artifact.version && hash(k.artifact.contentHash) && stringList(k.prerequisites) && stringList(k.steps) &&
      stringList(k.checks) && stringList(k.limitations) && stringList(k.relatedProblemIds) && ["needs-authoring", "ready-for-review", "needs-update"].includes(k.status)
    if (k.kind === "procedure") return stringList(k.applicability) && stringList(k.prerequisites) && stringList(k.steps) &&
      stringList(k.verification) && stringList(k.nonApplicableWhen) && stringList(k.relatedProblemIds) && stringList(k.relatedGuideIds)
    return false
  })
  } catch { return false }
}

export function assertWritebackTransition(current: WikiWritebackDraft, next: WikiWritebackDraft): void {
  const allowed: Record<WritebackStatus, WritebackStatus[]> = {
    draft: ["draft", "conflict", "rejected", "published"],
    conflict: ["conflict", "draft", "rejected"], rejected: [], published: [],
  }
  if (!allowed[current.status].includes(next.status)) throw new Error("Illegal writeback transition")
  if (next.status === "published" && (!next.reviewer?.id || !next.reviewer.decisionAt || !next.publishedPageIds.length))
    throw new Error("Publication requires review and committed pages")
  if (next.status === "rejected" && !next.reviewer?.id) throw new Error("Rejection requires review")
  if (next.status !== "published" && next.publishedPageIds.length) throw new Error("Unpublished draft has pages")
}

/** Keep the old binding; callers persist a new guide for the new artifact. */
export function markGuideForArtifactChange(guide: UsageGuideKnowledge, artifact: WritebackArtifact): UsageGuideKnowledge {
  return guide.artifact.id === artifact.id &&
    (guide.artifact.contentHash !== artifact.contentHash || guide.artifact.version !== artifact.version || guide.artifact.path !== artifact.path)
    ? { ...structuredClone(guide), status: "needs-update" } : structuredClone(guide)
}
