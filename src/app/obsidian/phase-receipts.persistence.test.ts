import { beforeEach, expect, it, vi } from "vitest"

const files = vi.hoisted(() => new Map<string, string>())
vi.mock("@/commands/fs", () => ({
  createDirectory: async () => {},
  fileExists: async (path: string) => path.endsWith("/.obsidian") || files.has(path),
  readFile: async (path: string) => files.get(path) ?? "",
  writeFileAtomic: async (path: string, content: string) => { files.set(path, content) },
  writeVaultReceipt: async (root: string, name: string, content: string) => { const target = `${root}/kb-ingest-records/${name}`; files.set(target, content); return content },
}))

import { loadPhaseReceiptRecords, phaseReceipts } from "./phase-receipts"
import { createReceivedCheckpoint, beginStage, finishStage } from "@/modules/ingestion/domain"
import { projectPhaseReceipt } from "@/modules/obsidian/application"

beforeEach(() => files.clear())

it("persists binding and pending receipt in project JSON so a fresh service can resume sync", async () => {
  let checkpoint = createReceivedCheckpoint({ projectId: "p1", documentId: "doc1", receivedAt: "2026-11-06T00:00:00.000Z", artifactRef: "source", indexPolicy: "disabled", feedbackPolicy: "disabled" })
  checkpoint = beginStage(checkpoint, "parse", { attemptId: "parse1", now: checkpoint.updatedAt })
  checkpoint = finishStage(checkpoint, "parse", { attempt: 1, attemptId: "parse1", now: checkpoint.updatedAt, outcome: "succeeded", evidence: ["parsed"] })
  checkpoint = beginStage(checkpoint, "compile", { attemptId: "compile1", now: checkpoint.updatedAt })
  checkpoint = finishStage(checkpoint, "compile", { attempt: 1, attemptId: "compile1", now: checkpoint.updatedAt, outcome: "succeeded", evidence: ["compiled"] })
  const receipt = projectPhaseReceipt({ id: "ignored", sourceId: "source1", sourceRevision: "b".repeat(64), runId: "run1", attemptId: "compile1", checkpoint, times: { receivedAt: checkpoint.createdAt, sourceIngestedAt: checkpoint.updatedAt, revisionIngestedAt: checkpoint.updatedAt } })
  await phaseReceipts.save("/project", receipt)
  await phaseReceipts.configureVault("/project", "/vault")
  const persisted = JSON.parse(files.get("/project/.llm-wiki/phase-receipts.json")!)
  expect(persisted.vaultPath).toBe("/vault")
  expect(persisted.receipts[receipt.id]).toMatchObject({ schemaVersion: 2, delivery: "delivered" })
  expect(files.has(`/vault/kb-ingest-records/source1-${"b".repeat(64)}.json`)).toBe(true)
})

it("persists a superseded pointer and rewrites an already-owned unknown Vault file", async () => {
  const start = "2026-11-06T00:00:00.000Z"
  let checkpoint = createReceivedCheckpoint({ projectId: "p1", documentId: "doc1", receivedAt: start, artifactRef: "source", indexPolicy: "disabled", feedbackPolicy: "disabled" })
  checkpoint = beginStage(checkpoint, "parse", { attemptId: "parse1", now: start })
  const unknown = projectPhaseReceipt({ id: "unknown", sourceId: "source1", sourceRevision: null, revisionKind: "unknown", runId: "run1", checkpoint, times: { receivedAt: null, sourceIngestedAt: null, revisionIngestedAt: null } })
  await phaseReceipts.save("/project", unknown)
  await phaseReceipts.configureVault("/project", "/vault")
  checkpoint = finishStage(checkpoint, "parse", { attempt: 1, attemptId: "parse1", now: start, outcome: "succeeded", evidence: ["parsed"] })
  checkpoint = beginStage(checkpoint, "compile", { attemptId: "compile1", now: start })
  await phaseReceipts.save("/project", projectPhaseReceipt({ id: unknown.id, sourceId: "source1", sourceRevision: null, revisionKind: "unknown", runId: "run1", checkpoint, times: unknown.times }))

  let knownCheckpoint = createReceivedCheckpoint({ projectId: "p1", documentId: "doc1", receivedAt: start, artifactRef: "source", indexPolicy: "disabled", feedbackPolicy: "disabled" })
  knownCheckpoint = beginStage(knownCheckpoint, "parse", { attemptId: "parse-known", now: start })
  knownCheckpoint = finishStage(knownCheckpoint, "parse", { attempt: 1, attemptId: "parse-known", now: start, outcome: "succeeded", evidence: ["parsed"] })
  const known = projectPhaseReceipt({ id: "ignored", sourceId: "source1", sourceRevision: "c".repeat(64), runId: "run1", checkpoint: knownCheckpoint, times: unknown.times })
  await phaseReceipts.save("/project", known)
  await phaseReceipts.sync("/project")
  const persisted = await loadPhaseReceiptRecords("/project")
  expect(persisted.receipts[unknown.id].supersededBy).toBe(known.id)
  expect(JSON.parse(files.get("/vault/kb-ingest-records/source1-unknown-run1.json")!)).toMatchObject({ supersededBy: known.id, summary: { status: "processing" } })

  // A later run updates the stable source/revision receipt ID. The archived
  // unknown record remains a valid pointer to that revision across runs.
  knownCheckpoint = beginStage(knownCheckpoint, "compile", { attemptId: "compile-known", now: "2026-11-06T00:00:01.000Z" })
  await phaseReceipts.save("/project", projectPhaseReceipt({ id: "ignored", sourceId: "source1", sourceRevision: "c".repeat(64), runId: "run2", checkpoint: knownCheckpoint, times: unknown.times }))
  const afterRepeat = await loadPhaseReceiptRecords("/project")
  expect(afterRepeat.receipts[unknown.id].supersededBy).toBe(known.id)
  expect(afterRepeat.receipts[known.id].runId).toBe("run2")
})
