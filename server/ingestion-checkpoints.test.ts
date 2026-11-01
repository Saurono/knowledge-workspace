import { afterEach, describe, expect, it } from "vitest"
import { accountFixture } from "./testing"
import { createDocumentCheckpointRepository } from "./ingestion-checkpoints"
import { beginStage, createReceivedCheckpoint, recoverInterrupted } from "@/modules/ingestion/domain"

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanups.splice(0)) await close() })
async function fixture() {
  const f = await accountFixture(); cleanups.push(f.close); await f.bootstrap()
  const admin = await f.login(), project = (await f.json("/projects", "POST", { name: "Checkpoint" }, admin.cookie)).data
  return { service: f, project }
}
const received = (projectId: string, documentId: string) => createReceivedCheckpoint({ projectId, documentId, receivedAt: "2026-11-01T10:00:00.000Z", artifactRef: `document:${documentId}` })
const legacy = (id: string) => ({ id, sourceId: id, name: "note.md", mediaType: "text/markdown", size: 4, sha256: "a".repeat(64), receivedAt: "2026-11-01T10:00:00.000Z", sourceIngestedAt: null, status: "received" })

describe("SQLite document checkpoint adapter", () => {
  it("preserves metadata, wins one CAS race, persists running state, and recovers after restart", async () => {
    const f = await fixture(), id = "doc-cas"
    await f.service.repository.save(f.project.id, "document", id, { ...legacy(id), integrationMarker: "preserve-me" }, null, "2026-11-01T10:00:00.000Z")
    let adapter = createDocumentCheckpointRepository(f.service.repository, () => "2026-11-01T10:00:05.000Z")
    const initial = await adapter.read(f.project.id, id)
    expect(initial?.checkpoint.stages.parse.status).toBe("pending")
    const running = beginStage(initial!.checkpoint, "parse", { attemptId: "parse-1", now: "2026-11-01T10:00:01.000Z" })
    const raced = await Promise.allSettled([
      adapter.save(f.project.id, id, initial!.revision, running),
      adapter.save(f.project.id, id, initial!.revision, running),
    ])
    expect(raced.filter(result => result.status === "fulfilled")).toHaveLength(1)
    expect(raced.filter(result => result.status === "rejected")).toHaveLength(1)
    const persisted = await adapter.read(f.project.id, id)
    expect(persisted?.checkpoint.stages.parse.status).toBe("running")
    expect((await f.service.repository.get(f.project.id, "document", id))?.data).toMatchObject({ integrationMarker: "preserve-me", sourceIngestedAt: null })

    await f.service.restart()
    adapter = createDocumentCheckpointRepository(f.service.repository, () => "2026-11-01T10:00:06.000Z")
    const afterRestart = await adapter.read(f.project.id, id)
    expect(afterRestart?.checkpoint.stages.parse.status).toBe("running")
    const recovered = recoverInterrupted(afterRestart!.checkpoint, "2026-11-01T10:00:06.000Z")
    await adapter.save(f.project.id, id, afterRestart!.revision, recovered)
    expect((await adapter.read(f.project.id, id))?.checkpoint.stages.parse).toMatchObject({ status: "blocked", error: { code: "interrupted" } })
  })
  it("refuses untrusted legacy or corrupt snapshots and immutable identity or policy changes", async () => {
    const f = await fixture(), adapter = createDocumentCheckpointRepository(f.service.repository, () => "2026-11-01T10:00:10.000Z")
    const badId = "doc-old-bad", goodId = "doc-old-good", corruptId = "doc-corrupt"
    await f.service.repository.save(f.project.id, "document", badId, { id: badId, status: "done", receivedAt: "2026-11-01T10:00:00.000Z" }, null, "2026-11-01T10:00:00.000Z")
    const badCheckpoint = received(f.project.id, badId)
    await expect(adapter.read(f.project.id, badId)).rejects.toMatchObject({ code: "invalid_argument" })
    await expect(adapter.save(f.project.id, badId, 1, badCheckpoint)).rejects.toMatchObject({ code: "invalid_argument" })
    expect((await f.service.repository.get(f.project.id, "document", badId))?.data).not.toHaveProperty("ingestion")

    const malformed: Array<[string, Record<string, unknown>]> = [
      ["source-id", { ...legacy("source-id"), sourceId: "another-document" }],
      ["zero-size", { ...legacy("zero-size"), size: 0 }],
      ["missing-size", (({ size: _size, ...data }) => data)(legacy("missing-size"))],
      ["bad-sha", { ...legacy("bad-sha"), sha256: "bad" }],
      ["empty-name", { ...legacy("empty-name"), name: "   " }],
      ["path-name", { ...legacy("path-name"), name: "../note.md" }],
      ["empty-media", { ...legacy("empty-media"), mediaType: "" }],
      ["bad-received-at", { ...legacy("bad-received-at"), receivedAt: "not-a-date" }],
    ]
    for (const [id, metadata] of malformed) {
      await f.service.repository.save(f.project.id, "document", id, metadata, null, "2026-11-01T10:00:00.000Z")
      await expect(adapter.read(f.project.id, id), id).rejects.toMatchObject({ code: "invalid_argument" })
      await expect(adapter.save(f.project.id, id, 1, received(f.project.id, id)), id).rejects.toMatchObject({ code: "invalid_argument" })
      expect((await f.service.repository.get(f.project.id, "document", id))?.data, id).not.toHaveProperty("ingestion")
    }

    await f.service.repository.save(f.project.id, "document", goodId, legacy(goodId), null, "2026-11-01T10:00:00.000Z")
    const good = await adapter.read(f.project.id, goodId)
    const started = beginStage(good!.checkpoint, "parse", { attemptId: "parse-1", now: "2026-11-01T10:00:01.000Z" })
    started.updatedAt = "2026-11-01T10:00:05.000Z"
    await adapter.save(f.project.id, goodId, good!.revision, started)
    const current = (await adapter.read(f.project.id, goodId))!
    const changedCreated = structuredClone(current.checkpoint); changedCreated.createdAt = "2026-10-31T23:59:59.000Z"
    await expect(adapter.save(f.project.id, goodId, current.revision, changedCreated)).rejects.toMatchObject({ code: "invalid_argument" })
    const changedPolicy = structuredClone(current.checkpoint); changedPolicy.policy.feedback = "required"; changedPolicy.stages.feedback.status = "pending"
    await expect(adapter.save(f.project.id, goodId, current.revision, changedPolicy)).rejects.toMatchObject({ code: "invalid_argument" })
    const reversedTime = structuredClone(current.checkpoint); reversedTime.updatedAt = "2026-11-01T10:00:04.000Z"
    await expect(adapter.save(f.project.id, goodId, current.revision, reversedTime)).rejects.toMatchObject({ code: "invalid_argument" })

    await f.service.repository.save(f.project.id, "document", corruptId, { ...legacy(corruptId), ingestion: { schemaVersion: 99 } }, null, "2026-11-01T10:00:00.000Z")
    await expect(adapter.read(f.project.id, corruptId)).rejects.toMatchObject({ code: "invalid_argument" })
    await expect(adapter.save(f.project.id, corruptId, 1, received(f.project.id, corruptId))).rejects.toMatchObject({ code: "invalid_argument" })
  })
})
