import { createDirectory, fileExists, readFile, writeFileAtomic, writeVaultReceipt } from "@/commands/fs"
import { isAbsolutePath, normalizePath } from "@/lib/path-utils"
import { withProjectLock } from "@/lib/project-mutex"
import { createPhaseReceiptService, type PhaseReceiptRecords, type PhaseReceiptRepository } from "@/modules/obsidian/application"
import type { PhaseReceiptV2 } from "@/modules/obsidian/domain"
import { INGESTION_STAGES, summarizeIngestion, validateCheckpoint } from "@/modules/ingestion/domain"

const recordsPath = (projectPath: string) => `${normalizePath(projectPath)}/.llm-wiki/phase-receipts.json`
const empty = (): PhaseReceiptRecords => ({ vaultPath: null, receipts: {} })
async function load(projectPath: string): Promise<PhaseReceiptRecords> {
  const path = recordsPath(projectPath)
  if (!(await fileExists(path))) return empty()
  const value = JSON.parse(await readFile(path)) as PhaseReceiptRecords
  if (!value || !value.receipts || typeof value.receipts !== "object" || Array.isArray(value.receipts) ||
    (value.vaultPath !== null && (typeof value.vaultPath !== "string" || !isAbsolutePath(value.vaultPath) || value.vaultPath.replace(/\\/g, "/").split("/").includes("..")))) throw new Error("Invalid phase receipt records; original file preserved")
  for (const [id, receipt] of Object.entries(value.receipts)) {
    if (!receipt || id !== receipt.id || receipt.schemaVersion !== 2 || !/^[A-Za-z0-9_-]{1,128}$/.test(receipt.projectId) || !/^[A-Za-z0-9_-]{1,128}$/.test(receipt.sourceId) ||
      (receipt.sourceKind !== undefined && !(receipt.sourceKind === "generated-wiki" || receipt.sourceKind === "raw" || receipt.sourceKind === "unknown")) ||
      !(receipt.sourceRevision === null || /^[a-f0-9]{64}$/.test(receipt.sourceRevision)) ||
      !(receipt.revisionKind === "raw-bytes-sha256" || receipt.revisionKind === "parsed-text-sha256" || receipt.revisionKind === "unknown") ||
      !(receipt.revisionKind === "unknown" && receipt.sourceRevision === null || receipt.revisionKind !== "unknown" && /^[a-f0-9]{64}$/.test(receipt.sourceRevision ?? "")) ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(receipt.runId) || !receipt.stages || !receipt.summary ||
      (receipt.supersededBy !== undefined && !/^[A-Za-z0-9_-]{1,128}-parsed-text-sha256-[a-f0-9]{64}$/.test(receipt.supersededBy)) ||
      !["pending", "delivered"].includes(receipt.delivery) ||
      !(receipt.deliveredDigest === null || /^[a-f0-9]{64}$/.test(receipt.deliveredDigest)) ||
      !(receipt.activeStage === null || (INGESTION_STAGES as readonly unknown[]).includes(receipt.activeStage)) ||
      receipt.checkpoint?.projectId !== receipt.projectId || receipt.checkpoint.stages?.[receipt.activeStage ?? "receive"]?.attemptId !== receipt.attemptId ||
      receipt.id !== `${receipt.sourceId}-${receipt.revisionKind}-${receipt.sourceRevision ?? receipt.runId}`)
      throw new Error("Invalid phase receipt records; original file preserved")
    try {
      validateCheckpoint(receipt.checkpoint)
      const activeStages = INGESTION_STAGES.filter(stage => !["pending", "skipped"].includes(receipt.checkpoint.stages[stage].status))
      const derivedStage = activeStages.length ? activeStages[activeStages.length - 1] : null
      if (receipt.activeStage !== derivedStage ||
        JSON.stringify(summarizeIngestion(receipt.checkpoint)) !== JSON.stringify(receipt.summary) ||
        JSON.stringify(receipt.stages) !== JSON.stringify(receipt.checkpoint.stages)) throw new Error("projection mismatch")
    } catch { throw new Error("Invalid phase receipt records; original file preserved") }
  }
  for (const receipt of Object.values(value.receipts)) if (receipt.supersededBy) {
    const resolved = value.receipts[receipt.supersededBy]
    // Known receipt IDs are stable per source revision and are updated by later
    // runs. The pointer archives the revision result, so its runId may differ.
    if (!resolved || resolved.sourceId !== receipt.sourceId || resolved.projectId !== receipt.projectId || resolved.sourceRevision === null || resolved.revisionKind === "unknown")
      throw new Error("Invalid superseded phase receipt link; original file preserved")
  }
  return value
}
export async function loadPhaseReceiptRecords(projectPath: string): Promise<PhaseReceiptRecords> {
  return structuredClone(await load(projectPath))
}
const repository: PhaseReceiptRepository = {
  read: projectPath => withProjectLock(`${normalizePath(projectPath)}\0phase-receipts`, () => load(projectPath)),
  update: (projectPath, change) => withProjectLock(`${normalizePath(projectPath)}\0phase-receipts`, async () => {
    const records = await load(projectPath)
    if (!(await change(records))) return
    const path = recordsPath(projectPath)
    await createDirectory(`${normalizePath(projectPath)}/.llm-wiki`)
    await writeFileAtomic(path, JSON.stringify(records, null, 2))
  }),
}

export const phaseReceipts = createPhaseReceiptService(repository, {
  exists: async path => fileExists(path),
  createDirectory,
  writeAtomic: writeFileAtomic,
  read: async path => (await fileExists(path)) ? readFile(path) : null,
  writeReceipt: (root, fileName, content) => writeVaultReceipt(root, fileName, content),
})
export type { PhaseReceiptV2 }
