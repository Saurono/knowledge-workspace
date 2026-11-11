import { expect, it } from "vitest"
import { projectPhaseReceipt } from "@/modules/obsidian/application"
import { createReceivedCheckpoint } from "@/modules/ingestion/domain"

it("preserves source times across revisions and all times on replay; leaves legacy times null", () => {
  const receivedAt = "2026-11-06T00:00:00.000Z"
  const sourceIngestedAt = "2026-11-06T01:00:00.000Z"
  const later = "2026-11-07T01:00:00.000Z"
  const checkpoint = createReceivedCheckpoint({ projectId: "project", documentId: "document", receivedAt, artifactRef: "source:1", indexPolicy: "disabled", feedbackPolicy: "disabled" })
  const base = { id: "receipt-1", sourceId: "source-1", runId: "run-1", checkpoint }
  const first = projectPhaseReceipt({ ...base, sourceRevision: "a".repeat(64), times: { receivedAt, sourceIngestedAt, revisionIngestedAt: sourceIngestedAt } })
  expect(first.times).toEqual({ receivedAt: "2026-11-06T00:00:00.000Z", sourceIngestedAt: "2026-11-06T01:00:00.000Z", revisionIngestedAt: "2026-11-06T01:00:00.000Z" })
  const input = { ...base, runId: "run-2", sourceRevision: "b".repeat(64), times: { ...first.times, revisionIngestedAt: later } }
  const expected = { receivedAt: "2026-11-06T00:00:00.000Z", sourceIngestedAt: "2026-11-06T01:00:00.000Z", revisionIngestedAt: "2026-11-07T01:00:00.000Z" }
  expect(projectPhaseReceipt(input).times).toEqual(expected)
  expect(projectPhaseReceipt(input).times).toEqual(expected)
  expect(projectPhaseReceipt({ ...base, sourceRevision: null, revisionKind: "unknown", times: { receivedAt: null, sourceIngestedAt: null, revisionIngestedAt: null } }).times).toEqual({ receivedAt: null, sourceIngestedAt: null, revisionIngestedAt: null })
})
