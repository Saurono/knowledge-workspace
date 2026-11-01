import { describe, expect, it } from "vitest"
import { createIngestionLifecycleService, IngestionLifecycleError } from "./lifecycle"
import { createReceivedCheckpoint } from "../domain/checkpoint"

const checkpoint = createReceivedCheckpoint({ projectId: "project", documentId: "document", receivedAt: "2026-11-01T10:00:00.000Z", artifactRef: "document:document" })
function setup() {
  let current: { revision: number; checkpoint: typeof checkpoint } | null = { revision: 1, checkpoint }
  const repository = {
    async read() { return current },
    async save(projectId: string, documentId: string, expectedRevision: number, next: typeof checkpoint) {
      if (!current) throw Object.assign(new Error("missing"), { code: "not_found" })
      if (current.revision !== expectedRevision) throw Object.assign(new Error("stale"), { code: "conflict" })
      if (next.projectId !== projectId || next.documentId !== documentId) throw Object.assign(new Error("owner mismatch"), { code: "invalid_argument" })
      current = { revision: current.revision + 1, checkpoint: next }
      return current
    },
  }
  return { service: createIngestionLifecycleService(repository), get current() { return current }, remove() { current = null } }
}
describe("ingestion lifecycle optimistic repository port", () => {
  it("requires a positive safe integer expected revision and reports structured module errors", async () => {
    const f = setup()
    for (const revision of [0, -1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(f.service.begin("project", "document", revision, "parse", { attemptId: "parse-1", now: "2026-11-01T10:00:01.000Z" })).rejects.toMatchObject({ code: "invalid_argument" })
    }
    await expect(f.service.begin("project", "document", 2, "parse", { attemptId: "parse-1", now: "2026-11-01T10:00:01.000Z" })).rejects.toMatchObject({ code: "conflict" })
    f.remove()
    await expect(f.service.begin("project", "document", 1, "parse", { attemptId: "parse-1", now: "2026-11-01T10:00:01.000Z" })).rejects.toMatchObject({ code: "not_found" })
    await expect(f.service.read("bad project", "document")).rejects.toBeInstanceOf(IngestionLifecycleError)
  })
  it("uses the supplied revision, saves once, and does not resave a no-op recovery", async () => {
    const f = setup(), first = await f.service.begin("project", "document", 1, "parse", { attemptId: "parse-1", now: "2026-11-01T10:00:01.000Z" })
    expect(first.revision).toBe(2)
    const finished = await f.service.finish("project", "document", 2, "parse", { attempt: 1, attemptId: "parse-1", now: "2026-11-01T10:00:02.000Z", outcome: "succeeded", evidence: ["parsed:document"] })
    expect(finished.revision).toBe(3)
    const noOp = await f.service.recover("project", "document", 3, "2026-11-01T10:00:02.000Z")
    expect(noOp.revision).toBe(3)
  })
})
