import { afterAll, beforeAll, expect, it, vi } from "vitest"
import { createHash } from "node:crypto"
import { rename, mkdir, readFile, realpath } from "node:fs/promises"
import { realFs, createTempProject, writeFileRaw } from "@/test-helpers/fs-temp"

vi.mock("@/commands/fs", () => realFs)

let projectTmp: Awaited<ReturnType<typeof createTempProject>>
let vaultTmp: Awaited<ReturnType<typeof createTempProject>>
beforeAll(async () => {
  projectTmp = await createTempProject("phase-receipts-project")
  vaultTmp = await createTempProject("phase-receipts-vault")
  // The real-fs adapter requires the root in the same canonical form as its
  // realpath(directory) check (runner temp roots may be aliases or differ in case).
  vaultTmp.path = await realpath(vaultTmp.path)
  await mkdir(`${vaultTmp.path}/.obsidian`, { recursive: true })
  await writeFileRaw(`${projectTmp.path}/raw/source.md`, "user source unchanged")
})
afterAll(async () => { await projectTmp?.cleanup(); await vaultTmp?.cleanup(); await (vaultTmp ? (await import("node:fs/promises")).rm(`${vaultTmp.path}-moved`, { recursive: true, force: true }) : Promise.resolve()) })

it("persists pending state locally, verifies external JSON after restart, and recovers after Vault relocation", async () => {
  const original = await readFile(`${projectTmp.path}/raw/source.md`, "utf8")
  const originalHash = createHash("sha256").update(original).digest("hex")
  const { phaseReceipts } = await import("./phase-receipts")
  await phaseReceipts.configureVault(projectTmp.path, vaultTmp.path)
  const revision = createHash("sha256").update(original).digest("hex")
  const { createReceivedCheckpoint, beginStage, finishStage } = await import("@/modules/ingestion/domain")
  let cp = createReceivedCheckpoint({ projectId: "p1", documentId: "d1", receivedAt: "2026-11-06T00:00:00.000Z", artifactRef: "source", indexPolicy: "disabled", feedbackPolicy: "disabled" })
  cp = beginStage(cp, "parse", { attemptId: "parse-1", now: cp.updatedAt })
  cp = finishStage(cp, "parse", { attempt: 1, attemptId: "parse-1", now: cp.updatedAt, outcome: "succeeded", evidence: ["parsed"] })
  cp = beginStage(cp, "compile", { attemptId: "compile-1", now: cp.updatedAt })
  cp = finishStage(cp, "compile", { attempt: 1, attemptId: "compile-1", now: cp.updatedAt, outcome: "succeeded", evidence: ["compiled"] })
  const { projectPhaseReceipt } = await import("@/modules/obsidian/application")
  const receipt = projectPhaseReceipt({ id: "ignored", sourceId: "source1", sourceRevision: revision, runId: "run1", attemptId: "compile-1", checkpoint: cp, times: { receivedAt: cp.createdAt, sourceIngestedAt: cp.updatedAt, revisionIngestedAt: cp.updatedAt } })
  await phaseReceipts.save(projectTmp.path, receipt)
  const localText = await readFile(`${projectTmp.path}/.llm-wiki/phase-receipts.json`, "utf8")
  expect(JSON.parse(localText).receipts[receipt.id].delivery).toBe("pending")

  const movedVault = `${vaultTmp.path}-moved`
  await rename(vaultTmp.path, movedVault)
  await vi.resetModules()
  const restarted = (await import("./phase-receipts")).phaseReceipts
  await expect(restarted.deliver(projectTmp.path, receipt.id)).rejects.toThrow("unavailable")
  const afterDisconnect = JSON.parse(await readFile(`${projectTmp.path}/.llm-wiki/phase-receipts.json`, "utf8"))
  expect(afterDisconnect.receipts[receipt.id]).toMatchObject({ delivery: "pending", deliveryError: "Obsidian Vault is unavailable" })

  await rename(movedVault, vaultTmp.path)
  await restarted.configureVault(projectTmp.path, vaultTmp.path)
  const externalPath = `${vaultTmp.path}/kb-ingest-records/source1-${revision}.json`
  const external = JSON.parse(await readFile(externalPath, "utf8"))
  expect(JSON.parse(await readFile(await realpath(externalPath), "utf8"))).toEqual(external)
  expect(external).toMatchObject({ schemaVersion: 2, sourceId: "source1", sourceRevision: revision })
  expect(createHash("sha256").update(await readFile(`${projectTmp.path}/raw/source.md`, "utf8")).digest("hex")).toBe(originalHash)
})
