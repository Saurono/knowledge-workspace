import { INGESTION_STAGES, summarizeIngestion, validateCheckpoint, type IngestionCheckpointV1, type IngestionStage } from "@/modules/ingestion/domain"
import { phaseReceiptPayload, type PhaseReceiptV2 } from "../domain"

export interface PhaseReceiptRecords { vaultPath: string | null; receipts: Record<string, PhaseReceiptV2> }
export interface PhaseReceiptRepository {
  update(projectPath: string, change: (records: PhaseReceiptRecords) => Promise<boolean>): Promise<void>
  read(projectPath: string): Promise<PhaseReceiptRecords>
}
export interface PhaseVaultPort {
  exists(path: string): Promise<boolean>
  createDirectory(path: string): Promise<void>
  writeAtomic(path: string, content: string): Promise<void>
  read(path: string): Promise<string | null>
  writeReceipt?(root: string, fileName: string, content: string): Promise<string>
}
const vaultRoot = (path: string) => path.replace(/\\/g, "/").replace(/\/+$/, "")
const digest = async (value: unknown) => {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)))
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join("")
}

export function projectPhaseReceipt(input: {
  id: string; sourceId: string; sourceKind?: PhaseReceiptV2["sourceKind"]; sourceRevision: string | null; revisionKind?: PhaseReceiptV2["revisionKind"]; runId: string; attemptId?: string
  checkpoint: IngestionCheckpointV1; outputVersions?: Array<{path:string;version:string}>; indexCommitRefs?: string[]
  times: PhaseReceiptV2["times"]; now?: string
}): PhaseReceiptV2 {
  validateCheckpoint(input.checkpoint)
  const revisionKind = input.revisionKind ?? (input.sourceRevision ? "parsed-text-sha256" : "unknown")
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(input.sourceId) || !/^[A-Za-z0-9_-]{1,128}$/.test(input.runId) ||
    input.sourceRevision !== null && !/^[a-f0-9]{64}$/.test(input.sourceRevision) ||
    revisionKind === "unknown" !== (input.sourceRevision === null)) throw new Error("Invalid phase receipt identity")
  const outputVersions = input.outputVersions ?? []
  if (outputVersions.some(output => typeof output.path !== "string" || !output.path.replace(/\\/g, "/").startsWith("wiki/") ||
    output.path.replace(/\\/g, "/").split("/").some(part => !part || part === "." || part === "..") ||
    typeof output.version !== "string" || !output.version.trim())) throw new Error("Invalid compiled output reference")
  const indexCommitRefs = input.indexCommitRefs ?? []
  if (indexCommitRefs.some(ref => typeof ref !== "string" || !ref.trim())) throw new Error("Invalid index commit reference")
  const activeStages = INGESTION_STAGES
    .filter(stage => !["pending", "skipped"].includes(input.checkpoint.stages[stage].status))
  const activeStage: IngestionStage | null = activeStages.length ? activeStages[activeStages.length - 1] : null
  const activeAttemptId = activeStage ? input.checkpoint.stages[activeStage].attemptId : null
  if (input.attemptId !== undefined && input.attemptId !== activeAttemptId) throw new Error("Receipt attempt does not match checkpoint evidence")
  const failed = INGESTION_STAGES.find(stage => input.checkpoint.stages[stage].error)
  return {
    schemaVersion: 2, id: `${input.sourceId}-${revisionKind}-${input.sourceRevision ?? input.runId}`, projectId: input.checkpoint.projectId, sourceId: input.sourceId, sourceKind: input.sourceKind ?? "unknown",
    sourceRevision: input.sourceRevision, revisionKind, runId: input.runId, attemptId: activeAttemptId, activeStage,
    checkpoint: structuredClone(input.checkpoint), stages: structuredClone(input.checkpoint.stages), summary: summarizeIngestion(input.checkpoint),
    outputVersions: structuredClone(outputVersions), indexCommitRefs: [...indexCommitRefs],
    error: failed ? structuredClone(input.checkpoint.stages[failed].error) : null,
    times: structuredClone(input.times), delivery: "pending", deliveredDigest: null, deliveryError: null, deliveredAt: null,
    updatedAt: input.now ?? input.checkpoint.updatedAt,
  }
}

export function createPhaseReceiptService(repository: PhaseReceiptRepository, vault: PhaseVaultPort, clock = () => new Date().toISOString()) {
  return {
    async read(projectPath: string) { return structuredClone(await repository.read(projectPath)) },
    async configureVault(projectPath: string, path: string | null) {
      if (path && (!/^(?:[A-Za-z]:[\\/]|\/)/.test(path) || path.replace(/\\/g, "/").split("/").includes("..")))
        throw new Error("Vault path must be an absolute canonical path")
      const normalized = path ? vaultRoot(path) : null
      if (normalized && !(await vault.exists(`${normalized}/.obsidian`))) throw new Error("Select an existing Obsidian Vault explicitly")
      await repository.update(projectPath, async records => {
        if (records.vaultPath === normalized) return false
        records.vaultPath = normalized
        if (normalized) for (const receipt of Object.values(records.receipts)) {
          receipt.delivery = "pending"; receipt.deliveredDigest = null; receipt.deliveredAt = null; receipt.deliveryError = null
        }
        return true
      })
      if (normalized) await this.sync(projectPath)
    },
    async save(projectPath: string, receipt: PhaseReceiptV2) {
      await repository.update(projectPath, async records => {
        const id = receipt.id
        const previous = records.receipts[id]
        validateCheckpoint(receipt.checkpoint)
        if (receipt.checkpoint.projectId !== receipt.projectId ||
          receipt.checkpoint.stages[receipt.activeStage ?? "receive"].attemptId !== receipt.attemptId ||
          JSON.stringify(summarizeIngestion(receipt.checkpoint)) !== JSON.stringify(receipt.summary)) throw new Error("Invalid phase receipt projection")
        const candidate = { ...receipt, id, ...(previous?.supersededBy ? { supersededBy: previous.supersededBy } : {}) }
        if (previous) {
          if (Date.parse(candidate.checkpoint.updatedAt) < Date.parse(previous.checkpoint.updatedAt)) return false
          // Timestamp granularity is not a stage ordering guarantee. Permit a legal
          // checkpoint advance at the same instant, but never accept an older attempt.
          for (const stage of INGESTION_STAGES) {
            const before = previous.checkpoint.stages[stage], after = candidate.checkpoint.stages[stage]
            const explicitInvalidation = after.attemptId === null && after.status === "pending"
            if (after.attempt < before.attempt || (after.attempt === before.attempt && before.attemptId !== after.attemptId && !explicitInvalidation)) return false
          }
          if (Date.parse(candidate.checkpoint.updatedAt) === Date.parse(previous.checkpoint.updatedAt) &&
            (candidate.runId !== previous.runId || candidate.activeStage !== previous.activeStage || candidate.attemptId !== previous.attemptId) &&
            JSON.stringify(candidate.checkpoint) === JSON.stringify(previous.checkpoint)) return false
        }
        const unchanged = previous && await digest(phaseReceiptPayload(previous)) === await digest(phaseReceiptPayload(candidate))
        records.receipts[id] = { ...candidate,
          delivery: unchanged ? previous.delivery : "pending",
          deliveredDigest: unchanged ? previous.deliveredDigest : null,
          deliveredAt: unchanged ? previous.deliveredAt : null,
          deliveryError: unchanged ? previous.deliveryError : null,
          updatedAt: candidate.updatedAt }
        if (candidate.sourceRevision !== null && candidate.revisionKind !== "unknown") {
          for (const [unknownId, unknown] of Object.entries(records.receipts)) {
            if (unknownId === id || unknown.sourceId !== candidate.sourceId || unknown.runId !== candidate.runId ||
                unknown.sourceRevision !== null || unknown.revisionKind !== "unknown" || unknown.supersededBy ||
                unknown.summary.status !== "processing") continue
            // A pending local delivery does not prove its older Vault file is
            // absent: earlier saves may already have delivered this stable name.
            // Keep the run-scoped record and overwrite that owned file with an
            // explicit superseded pointer on the next sync.
            records.receipts[unknownId] = { ...unknown, supersededBy: id, delivery: "pending", deliveredDigest: null, deliveredAt: null, deliveryError: null }
          }
        }
        return true
      })
    },
    async deliver(projectPath: string, id: string) {
      let result = false, failure: unknown
      await repository.update(projectPath, async records => {
        const receipt = records.receipts[id], root = records.vaultPath
        if (!receipt) return false
        if (!root || !(await vault.exists(`${root}/.obsidian`))) {
          receipt.delivery = "pending"; receipt.deliveryError = "Obsidian Vault is unavailable"; receipt.deliveredDigest = null; receipt.deliveredAt = null
          failure = new Error(receipt.deliveryError)
          return true
        }
        const body = phaseReceiptPayload(receipt), expected = await digest(body)
        const targetName = receipt.sourceRevision
          ? `${encodeURIComponent(receipt.sourceId)}-${encodeURIComponent(receipt.sourceRevision)}.json`
          : `${encodeURIComponent(receipt.sourceId)}-unknown-${encodeURIComponent(receipt.runId)}.json`
        const target = `${vaultRoot(root)}/kb-ingest-records/${targetName}`
        try {
          if (receipt.delivery === "delivered" && receipt.deliveredDigest === expected) {
            const existing = await vault.read(target)
            if (existing !== null && await digest(JSON.parse(existing)) === expected) return false
          }
          if (!vault.writeReceipt) await vault.createDirectory(`${vaultRoot(root)}/kb-ingest-records`)
          const actual = vault.writeReceipt
            ? await vault.writeReceipt(vaultRoot(root), targetName, JSON.stringify(body, null, 2))
            : (await vault.writeAtomic(target, JSON.stringify(body, null, 2)), await vault.read(target))
          if (actual === null || await digest(JSON.parse(actual)) !== expected) throw new Error("Receipt write verification failed")
          receipt.delivery = "delivered"; receipt.deliveredDigest = expected; receipt.deliveredAt = clock(); receipt.deliveryError = null; result = true
        } catch (error) {
          receipt.delivery = "pending"; receipt.deliveredDigest = null; receipt.deliveredAt = null; receipt.deliveryError = String(error)
          failure = error
        }
        return true
      })
      if (failure) throw failure
      return result
    },
    async sync(projectPath: string) {
      let ids: string[] = []
      // Re-read every target so externally deleted or edited JSON is repaired,
      // even when the local record still says it was delivered.
      await repository.update(projectPath, async records => { ids = Object.keys(records.receipts); return false })
      let delivered = 0; const failed: string[] = []
      for (const id of ids) try { if (await this.deliver(projectPath, id)) delivered++ } catch { failed.push(id) }
      return { delivered, failed }
    },
  }
}
