import type { EmbeddingConfig } from "../domain"
import type { VerifiedPageIndexCommit, VerifiedPageIndexPort } from "./ports"

export interface VerifiedSourceOutput {
  relativePath: string
  contentRevision: string
}

export interface VerifiedSourceSnapshot {
  sourceId: string
  sourceRevision: string
  /** Hash of source bytes at compile time, distinct from parsed-text sourceRevision. */
  rawSourceRevision: string
  configFingerprint: string
  outputs: VerifiedSourceOutput[]
}

export interface VerifiedSourcePageRecord extends VerifiedSourceOutput {
  pageId: string
  status: "pending" | "verified" | "failed"
  evidence: VerifiedPageIndexCommit | null
  error: string | null
}

export interface VerifiedSourceIndexRecord {
  schemaVersion: 1
  sourceId: string
  projectPath: string
  sourceRevision: string
  rawSourceRevision: string
  configFingerprint: string
  pages: VerifiedSourcePageRecord[]
  attemptToken: string
  attempt: number
  status: "running" | "succeeded" | "failed" | "cancelled" | "blocked"
  times: { receivedAt: string | null; sourceIngestedAt: string | null; revisionIngestedAt: string | null }
  startedAt: string
  updatedAt: string
  error: { code: string; message: string } | null
}

export interface VersionedVerifiedSourceIndexRecord {
  version: number
  record: VerifiedSourceIndexRecord
}

export interface VerifiedSourceIndexRepository {
  read(sourceId: string): Promise<VersionedVerifiedSourceIndexRecord | null>
  readCurrentSnapshot(sourceId: string): Promise<VerifiedSourceSnapshot | null>
  save(sourceId: string, expectedVersion: number, record: VerifiedSourceIndexRecord): Promise<VersionedVerifiedSourceIndexRecord>
}

export interface VerifiedSourceIndexInput {
  projectPath: string
  sourceId: string
  sourceRevision: string
  rawSourceRevision: string
  configFingerprint: string
  outputs: VerifiedSourceOutput[]
  config: EmbeddingConfig
  attemptToken: string
  times?: VerifiedSourceIndexRecord["times"]
}

export interface VerifiedSourceIndexResult {
  status: VerifiedSourceIndexRecord["status"] | "superseded"
  record: VerifiedSourceIndexRecord
  version: number
}

export class VerifiedSourceIndexError extends Error {
  constructor(public readonly code: "invalid_argument" | "not_found" | "conflict" | "invalid_record", message: string) {
    super(message)
    this.name = "VerifiedSourceIndexError"
  }
}

const HASH = /^(?:sha256:)?[a-f0-9]{64}$/
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const TIME = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/

function clone<T>(value: T): T { return structuredClone(value) }
function message(error: unknown): string { return error instanceof Error ? error.message : String(error) }
function pageId(path: string): string | null {
  if (!path.startsWith("wiki/") || path.includes("\\") || path.startsWith("/") || path.split("/").some(part => !part || part === "." || part === "..") || !/\.md$/i.test(path)) return null
  return path.slice(5, -3)
}
function normalizedSnapshot(snapshot: VerifiedSourceSnapshot): VerifiedSourceSnapshot {
  return { ...snapshot, outputs: snapshot.outputs.map(output => ({ ...output })).sort((a, b) => a.relativePath.localeCompare(b.relativePath)) }
}
function snapshotFromRecord(record: VerifiedSourceIndexRecord): VerifiedSourceSnapshot {
  return normalizedSnapshot({
    sourceId: record.sourceId,
    sourceRevision: record.sourceRevision,
    rawSourceRevision: record.rawSourceRevision,
    configFingerprint: record.configFingerprint,
    outputs: record.pages.map(({ relativePath, contentRevision }) => ({ relativePath, contentRevision })),
  })
}
function sameSnapshot(left: VerifiedSourceSnapshot, right: VerifiedSourceSnapshot): boolean {
  try { return JSON.stringify(normalizedSnapshot(left)) === JSON.stringify(normalizedSnapshot(right)) } catch { return false }
}
function validateSnapshot(value: VerifiedSourceSnapshot): VerifiedSourceSnapshot {
  if (!value || !ID.test(value.sourceId) || !HASH.test(value.sourceRevision) || !HASH.test(value.rawSourceRevision) || !HASH.test(value.configFingerprint) || !Array.isArray(value.outputs) || value.outputs.length === 0) {
    throw new VerifiedSourceIndexError("invalid_argument", "Invalid source revision, config fingerprint, or output manifest")
  }
  const normalized = normalizedSnapshot(value)
  const paths = new Set<string>(), ids = new Set<string>()
  for (const output of normalized.outputs) {
    const id = output && typeof output.relativePath === "string" ? pageId(output.relativePath) : null
    if (!id || !HASH.test(output.contentRevision) || paths.has(output.relativePath) || ids.has(id)) {
      throw new VerifiedSourceIndexError("invalid_argument", "Invalid, duplicate, or unsafe wiki output in source manifest")
    }
    paths.add(output.relativePath)
    ids.add(id)
  }
  return normalized
}
function validateRecord(value: unknown, sourceId: string): asserts value is VerifiedSourceIndexRecord {
  const record = value as VerifiedSourceIndexRecord | null
  if (!record || typeof record !== "object" || record.schemaVersion !== 1 || record.sourceId !== sourceId || typeof record.projectPath !== "string" || !record.projectPath ||
      !HASH.test(record.sourceRevision) || !HASH.test(record.rawSourceRevision) || !HASH.test(record.configFingerprint) || !Array.isArray(record.pages) ||
      !record.pages.length || typeof record.attemptToken !== "string" || !record.attemptToken.trim() ||
      !Number.isSafeInteger(record.attempt) || record.attempt < 1 ||
      !["running", "succeeded", "failed", "cancelled", "blocked"].includes(record.status) ||
      !record.times || !["receivedAt", "sourceIngestedAt", "revisionIngestedAt"].every(key => record.times[key as keyof typeof record.times] === null || TIME.test(record.times[key as keyof typeof record.times] as string)) ||
      !TIME.test(record.startedAt) || !TIME.test(record.updatedAt) || Date.parse(record.updatedAt) < Date.parse(record.startedAt)) {
    throw new VerifiedSourceIndexError("invalid_record", "Invalid verified source index record; original data was preserved")
  }
  let outputs: VerifiedSourceOutput[]
  try { outputs = validateSnapshot(snapshotFromRecord(record)).outputs }
  catch { throw new VerifiedSourceIndexError("invalid_record", "Invalid verified source output manifest; original data was preserved") }
  if (outputs.length !== record.pages.length) throw new VerifiedSourceIndexError("invalid_record", "Invalid verified source index pages; original data was preserved")
  for (let index = 0; index < record.pages.length; index++) {
    const page = record.pages[index], expected = outputs[index]
    if (!page || typeof page.relativePath !== "string" || typeof page.pageId !== "string" ||
        !["pending", "verified", "failed"].includes(page.status) ||
        page.relativePath !== expected.relativePath || page.contentRevision !== expected.contentRevision || page.pageId !== pageId(expected.relativePath) ||
        (page.status === "verified" ? !page.evidence || !!page.error : page.evidence !== null) ||
        (page.error !== null && typeof page.error !== "string")) {
      throw new VerifiedSourceIndexError("invalid_record", "Invalid verified source index pages; original data was preserved")
    }
    if (page.status === "verified") {
      try { validateEvidence(record.projectPath, page, page.evidence!) }
      catch { throw new VerifiedSourceIndexError("invalid_record", "Invalid verified page evidence; original data was preserved") }
    }
  }
  if ((record.status === "succeeded" && record.pages.some(page => page.status !== "verified")) ||
      (record.error !== null && (!record.error || !record.error.code || !record.error.message)) ||
      (record.status === "running" && record.error !== null) ||
      (record.status === "succeeded" && record.error !== null)) {
    throw new VerifiedSourceIndexError("invalid_record", "Invalid verified source index pages; original data was preserved")
  }
}

function validateEvidence(projectPath: string, output: VerifiedSourceOutput, evidence: VerifiedPageIndexCommit): void {
  const expectedPageId = pageId(output.relativePath)
  if (!expectedPageId || evidence.projectPath !== projectPath || evidence.pageId !== expectedPageId ||
      evidence.contentRevision !== output.contentRevision || !HASH.test(evidence.configFingerprint) ||
      !/^page-commit-manifests\/[a-f0-9]{64}\.json$/.test(evidence.manifestRef) ||
      !Number.isSafeInteger(evidence.expectedChunkCount) || evidence.expectedChunkCount <= 0 ||
      evidence.chunkKeys.length !== evidence.expectedChunkCount || evidence.chunkKeys.some(key => typeof key !== "string" || !key.trim()) ||
      new Set(evidence.chunkKeys).size !== evidence.chunkKeys.length || !HASH.test(evidence.chunkDigest) ||
      !["committed", "unchanged"].includes(evidence.status)) {
    throw new VerifiedSourceIndexError("invalid_argument", "Native index commit evidence does not match the compiled page output")
  }
}

function pageRecords(snapshot: VerifiedSourceSnapshot): VerifiedSourcePageRecord[] {
  return snapshot.outputs.map(output => ({ ...output, pageId: pageId(output.relativePath)!, status: "pending" as const, evidence: null, error: null }))
}

export function createVerifiedSourceIndexService(
  repository: VerifiedSourceIndexRepository,
  pageIndex: VerifiedPageIndexPort,
  options: { now: () => string },
) {
  async function currentRecord(sourceId: string): Promise<VersionedVerifiedSourceIndexRecord | null> {
    const value = await repository.read(sourceId)
    if (value) {
      if (!Number.isSafeInteger(value.version) || value.version < 1) throw new VerifiedSourceIndexError("invalid_record", "Invalid source index repository version")
      validateRecord(value.record, sourceId)
    }
    return value
  }
  async function readMatchingSnapshot(sourceId: string, expected: VerifiedSourceSnapshot): Promise<boolean> {
    const current = await repository.readCurrentSnapshot(sourceId)
    if (!current) return false
    try { return sameSnapshot(validateSnapshot(current), expected) } catch { return false }
  }
  async function active(sourceId: string, token: string): Promise<VersionedVerifiedSourceIndexRecord | null> {
    const value = await currentRecord(sourceId)
    return value && value.record.status === "running" && value.record.attemptToken === token ? value : null
  }
  async function checkAttemptSnapshot(sourceId: string, token: string, snapshot: VerifiedSourceSnapshot) {
    const matches = await readMatchingSnapshot(sourceId, snapshot)
    const current = await active(sourceId, token)
    return { matches, current }
  }
  async function save(sourceId: string, expectedVersion: number, record: VerifiedSourceIndexRecord) {
    try { return await repository.save(sourceId, expectedVersion, clone(record)) }
    catch (error) {
      const code = error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : undefined
      if (code === "conflict") throw new VerifiedSourceIndexError("conflict", message(error))
      throw error
    }
  }
  async function persistTerminal(sourceId: string, token: string, status: "failed" | "blocked", code: string, text: string, version: number, record: VerifiedSourceIndexRecord) {
    const latest = await active(sourceId, token)
    if (!latest) return { status: "superseded" as const, record: (await currentRecord(sourceId))?.record ?? record, version: (await currentRecord(sourceId))?.version ?? version }
    const next = clone(latest.record)
    next.status = status; next.error = { code, message: text }; next.updatedAt = options.now()
    const written = await save(sourceId, latest.version, next)
    return { status, record: written.record, version: written.version }
  }
  async function run(input: { projectPath: string; sourceId: string; config: EmbeddingConfig; snapshot: VerifiedSourceSnapshot; token: string; version: number; record: VerifiedSourceIndexRecord }): Promise<VerifiedSourceIndexResult> {
    let version = input.version, record = input.record
    for (let index = 0; index < record.pages.length; index++) {
      let latest = await active(input.sourceId, input.token)
      if (!latest) {
        const final = await currentRecord(input.sourceId)
        return { status: final?.record.status === "cancelled" ? "cancelled" : "superseded", record: final?.record ?? record, version: final?.version ?? version }
      }
      const before = await checkAttemptSnapshot(input.sourceId, input.token, input.snapshot)
      if (!before.current) {
        const final = await currentRecord(input.sourceId)
        return { status: final?.record.status === "cancelled" ? "cancelled" : "superseded", record: final?.record ?? record, version: final?.version ?? version }
      }
      if (!before.matches) {
        const terminal = await persistTerminal(input.sourceId, input.token, "blocked", "snapshot_changed", "Source revision, config, or output manifest changed during indexing", before.current.version, before.current.record)
        return terminal
      }
      version = before.current.version
      record = clone(before.current.record)
      const page = record.pages[index]
      try {
        let evidence: VerifiedPageIndexCommit | null = page.evidence
        let verified = false
        if (page.status === "verified" && evidence) {
          const check = await pageIndex.verifyPage({ projectPath: input.projectPath, relativePath: page.relativePath, config: input.config, expected: evidence })
          const afterVerify = await checkAttemptSnapshot(input.sourceId, input.token, input.snapshot)
          latest = afterVerify.current
          if (!latest) {
            const final = await currentRecord(input.sourceId)
            return { status: final?.record.status === "cancelled" ? "cancelled" : "superseded", record: final?.record ?? record, version: final?.version ?? version }
          }
          if (!afterVerify.matches) {
            return await persistTerminal(input.sourceId, input.token, "blocked", "snapshot_changed", "Source revision, config, or output manifest changed during verification", latest.version, latest.record)
          }
          verified = check.status === "verified" && check.manifestRef === evidence.manifestRef
        }
        if (!verified) {
          const committed = await pageIndex.commitPage({ projectPath: input.projectPath, relativePath: page.relativePath, config: input.config, force: true })
          const afterCommit = await checkAttemptSnapshot(input.sourceId, input.token, input.snapshot)
          latest = afterCommit.current
          if (!latest) {
            const final = await currentRecord(input.sourceId)
            return { status: final?.record.status === "cancelled" ? "cancelled" : "superseded", record: final?.record ?? record, version: final?.version ?? version }
          }
          if (!afterCommit.matches) {
            return await persistTerminal(input.sourceId, input.token, "blocked", "snapshot_changed", "Source revision, config, or output manifest changed during page commit", latest.version, latest.record)
          }
          validateEvidence(input.projectPath, page, committed)
          const check = await pageIndex.verifyPage({ projectPath: input.projectPath, relativePath: page.relativePath, config: input.config, expected: committed })
          const afterCheck = await checkAttemptSnapshot(input.sourceId, input.token, input.snapshot)
          latest = afterCheck.current
          if (!latest) {
            const final = await currentRecord(input.sourceId)
            return { status: final?.record.status === "cancelled" ? "cancelled" : "superseded", record: final?.record ?? record, version: final?.version ?? version }
          }
          if (!afterCheck.matches) {
            return await persistTerminal(input.sourceId, input.token, "blocked", "snapshot_changed", "Source revision, config, or output manifest changed during page verification", latest.version, latest.record)
          }
          if (check.status !== "verified" || check.manifestRef !== committed.manifestRef) {
            page.status = "failed"; page.evidence = null; page.error = `Native page verification returned ${check.status}`
          } else {
            evidence = committed; page.status = "verified"; page.evidence = evidence; page.error = null
          }
        } else {
          page.status = "verified"; page.error = null
        }
      } catch (error) {
        page.status = "failed"; page.evidence = null; page.error = message(error)
      }
      latest = await active(input.sourceId, input.token)
      if (!latest) {
        const final = await currentRecord(input.sourceId)
        return { status: final?.record.status === "cancelled" ? "cancelled" : "superseded", record: final?.record ?? record, version: final?.version ?? version }
      }
      const beforeSave = await checkAttemptSnapshot(input.sourceId, input.token, input.snapshot)
      latest = beforeSave.current
      if (!latest) {
        const final = await currentRecord(input.sourceId)
        return { status: final?.record.status === "cancelled" ? "cancelled" : "superseded", record: final?.record ?? record, version: final?.version ?? version }
      }
      if (!beforeSave.matches) {
        return await persistTerminal(input.sourceId, input.token, "blocked", "snapshot_changed", "Source revision, config, or output manifest changed before progress was saved", latest.version, latest.record)
      }
      // Rebase the updated page onto the latest attempt record so only this
      // attempt's progress is saved after every external await.
      const next = clone(latest.record)
      next.pages[index] = page
      next.updatedAt = options.now()
      const written = await save(input.sourceId, latest.version, next)
      version = written.version; record = written.record
    }
    const latest = await active(input.sourceId, input.token)
    if (!latest) {
      const final = await currentRecord(input.sourceId)
      return { status: final?.record.status === "cancelled" ? "cancelled" : "superseded", record: final?.record ?? record, version: final?.version ?? version }
    }
    const beforeComplete = await checkAttemptSnapshot(input.sourceId, input.token, input.snapshot)
    if (!beforeComplete.current) {
      const final = await currentRecord(input.sourceId)
      return { status: final?.record.status === "cancelled" ? "cancelled" : "superseded", record: final?.record ?? record, version: final?.version ?? version }
    }
    if (!beforeComplete.matches) {
      return await persistTerminal(input.sourceId, input.token, "blocked", "snapshot_changed", "Source revision, config, or output manifest changed before completion", beforeComplete.current.version, beforeComplete.current.record)
    }
    const next = clone(beforeComplete.current.record)
    // Recheck every page after all commits. A later page commit may invalidate an
    // earlier page's manifest, so per-page verification during the loop is not enough.
    let allVerified = next.pages.length > 0 && next.pages.every(page => page.status === "verified" && page.evidence !== null)
    for (const page of next.pages) {
      if (!page.evidence) { allVerified = false; continue }
      try {
        const check = await pageIndex.verifyPage({ projectPath: input.projectPath, relativePath: page.relativePath, config: input.config, expected: page.evidence })
        const afterFinalVerify = await checkAttemptSnapshot(input.sourceId, input.token, input.snapshot)
        if (!afterFinalVerify.current) {
          const final = await currentRecord(input.sourceId)
          return { status: final?.record.status === "cancelled" ? "cancelled" : "superseded", record: final?.record ?? next, version: final?.version ?? beforeComplete.current.version }
        }
        if (!afterFinalVerify.matches) {
          return await persistTerminal(input.sourceId, input.token, "blocked", "snapshot_changed", "Source revision, config, or output manifest changed during final page verification", afterFinalVerify.current.version, afterFinalVerify.current.record)
        }
        if (check.status !== "verified" || check.manifestRef !== page.evidence.manifestRef) allVerified = false
      } catch {
        allVerified = false
        const afterFailedVerify = await checkAttemptSnapshot(input.sourceId, input.token, input.snapshot)
        if (!afterFailedVerify.current) {
          const final = await currentRecord(input.sourceId)
          return { status: final?.record.status === "cancelled" ? "cancelled" : "superseded", record: final?.record ?? next, version: final?.version ?? beforeComplete.current.version }
        }
        if (!afterFailedVerify.matches) {
          return await persistTerminal(input.sourceId, input.token, "blocked", "snapshot_changed", "Source revision, config, or output manifest changed during final page verification", afterFailedVerify.current.version, afterFailedVerify.current.record)
        }
      }
    }
    // Refresh the attempt after the final await and only publish success while it
    // remains active and its compiled snapshot is still current.
    const finalState = await checkAttemptSnapshot(input.sourceId, input.token, input.snapshot)
    if (!finalState.current) {
      const final = await currentRecord(input.sourceId)
      return { status: final?.record.status === "cancelled" ? "cancelled" : "superseded", record: final?.record ?? next, version: final?.version ?? beforeComplete.current.version }
    }
    if (!finalState.matches) return await persistTerminal(input.sourceId, input.token, "blocked", "snapshot_changed", "Source revision, config, or output manifest changed before completion", finalState.current.version, finalState.current.record)
    const succeeded = allVerified && finalState.current.record.pages.every(page => page.status === "verified" && page.evidence !== null)
    const terminalRecord = clone(finalState.current.record)
    terminalRecord.status = succeeded ? "succeeded" : "failed"
    terminalRecord.error = succeeded ? null : { code: "page_index_failed", message: "One or more page indexes could not be verified" }
    terminalRecord.updatedAt = options.now()
    const written = await save(input.sourceId, finalState.current.version, terminalRecord)
    return { status: written.record.status, record: written.record, version: written.version }
  }

  async function begin(input: VerifiedSourceIndexInput): Promise<VerifiedSourceIndexResult> {
    if (!ID.test(input.sourceId) || !input.attemptToken.trim() || !TIME.test(options.now())) throw new VerifiedSourceIndexError("invalid_argument", "Invalid source indexing attempt")
    const snapshot = validateSnapshot({ sourceId: input.sourceId, sourceRevision: input.sourceRevision, rawSourceRevision: input.rawSourceRevision, configFingerprint: input.configFingerprint, outputs: input.outputs })
    if (!await readMatchingSnapshot(input.sourceId, snapshot)) throw new VerifiedSourceIndexError("conflict", "Current source snapshot does not match the requested index attempt")
    const current = await currentRecord(input.sourceId)
    if (current?.record.attemptToken === input.attemptToken) throw new VerifiedSourceIndexError("conflict", "Attempt token must be unique across source index attempts")
    const startedAt = options.now()
    const record: VerifiedSourceIndexRecord = {
    schemaVersion: 1, sourceId: input.sourceId, projectPath: input.projectPath, sourceRevision: snapshot.sourceRevision, rawSourceRevision: input.rawSourceRevision,
      configFingerprint: snapshot.configFingerprint, pages: pageRecords(snapshot), attemptToken: input.attemptToken,
      attempt: (current?.record.attempt ?? 0) + 1, status: "running",
      times: clone(input.times ?? current?.record.times ?? { receivedAt: null, sourceIngestedAt: null, revisionIngestedAt: null }),
      startedAt, updatedAt: startedAt, error: null,
    }
    const written = await save(input.sourceId, current?.version ?? 0, record)
    return run({ projectPath: input.projectPath, sourceId: input.sourceId, config: input.config, snapshot, token: input.attemptToken, version: written.version, record: written.record })
  }

  async function retryIndex(input: { projectPath: string; sourceId: string; configFingerprint: string; config: EmbeddingConfig; attemptToken: string }): Promise<VerifiedSourceIndexResult> {
    const current = await currentRecord(input.sourceId)
    if (!current) throw new VerifiedSourceIndexError("not_found", "Source index record not found")
    if (!["failed", "blocked", "cancelled", "running", "succeeded"].includes(current.record.status)) throw new VerifiedSourceIndexError("conflict", "Source index record cannot be resumed")
    if (input.projectPath !== current.record.projectPath) throw new VerifiedSourceIndexError("conflict", "Project path changed; source index evidence cannot be reused")
    if (!input.attemptToken.trim() || input.attemptToken === current.record.attemptToken) throw new VerifiedSourceIndexError("conflict", "Attempt token must be unique across source index attempts")
    const snapshot = validateSnapshot({ ...snapshotFromRecord(current.record), configFingerprint: input.configFingerprint })
    if (!await readMatchingSnapshot(input.sourceId, snapshot)) throw new VerifiedSourceIndexError("conflict", "Source revision or output manifest changed; recompile is required")
    const now = options.now()
    const record = clone(current.record)
    record.attemptToken = input.attemptToken
    record.configFingerprint = input.configFingerprint
    record.attempt++
    record.status = "running"
    record.updatedAt = now
    record.error = null
    for (const page of record.pages) {
      if (page.status !== "verified") { page.status = "pending"; page.evidence = null; page.error = null }
    }
    const written = await save(input.sourceId, current.version, record)
    return run({ projectPath: input.projectPath, sourceId: input.sourceId, config: input.config, snapshot, token: input.attemptToken, version: written.version, record: written.record })
  }

  async function cancel(sourceId: string, attemptToken: string): Promise<VersionedVerifiedSourceIndexRecord> {
    const current = await active(sourceId, attemptToken)
    if (!current) throw new VerifiedSourceIndexError("conflict", "Source index attempt is stale or no longer running")
    const record = clone(current.record)
    record.status = "cancelled"
    record.error = { code: "cancelled", message: "Source indexing attempt was cancelled" }
    record.updatedAt = options.now()
    return save(sourceId, current.version, record)
  }

  async function read(sourceId: string) { return currentRecord(sourceId) }
  return { begin, retryIndex, cancel, read }
}
