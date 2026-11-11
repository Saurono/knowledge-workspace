import { expect, it } from "vitest"
import { accountFixture } from "./testing"

it("updates metadata over HTTP, skips equivalent writes and rejects stale versions", async () => {
  const f = await accountFixture()
  try {
    await f.bootstrap()
    const admin = await f.login()
    const project = await f.json("/projects", "POST", { name: "metadata updates" }, admin.cookie)
    expect(project.response.status).toBe(201)
    const root = `/projects/${project.data.id}`
    const workspace = await f.json(root + "/workspace", "GET", undefined, admin.cookie)
    expect(workspace.data.revision).toEqual(expect.any(Number))
    const post = (memoryId: string, input: Record<string, unknown>, expectedVersion: number | null) =>
      f.json(root + "/memories", "POST", { memoryId, input, expectedVersion }, admin.cookie)
    expect((await post("b", { title: "b", content: "other memory", category: "fact", domainIds: [], relatedIds: [] }, null)).response.status).toBe(200)
    const created = await post("a", { title: "a", content: "original memory", category: "fact", domainIds: [], relatedIds: [] }, null)
    expect(created.response.status).toBe(200)
    expect(created.data.memory.version).toBe(1)
    const updated = await post("a", { relatedIds: ["b"] }, 1)
    expect(updated.response.status).toBe(200)
    expect(updated.data.memory.version).toBe(2)
    expect(updated.data.memory.relatedIds).toEqual(["b"])
    expect(updated.data.memory.revisions).toHaveLength(created.data.memory.revisions.length + 1)
    expect(updated.data.memory.revisions[1]).toMatchObject({ version: 2, title: "a", content: "original memory", changeNote: "metadata" })
    const repeated = await post("a", { relatedIds: ["b"] }, 2)
    expect(repeated.response.status).toBe(200)
    expect(repeated.data.memory).toEqual(updated.data.memory)
    expect(repeated.data.revision).toBe(updated.data.revision)
    const stale = await post("a", { relatedIds: ["b"] }, 1)
    expect(stale.response.status).toBe(409)
    expect(stale.error.details.currentVersion).toBe(2)
  } finally { await f.close() }
})
