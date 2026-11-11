import { expect, it } from "vitest"
import { createMemoryRecord } from "@/modules/memory/domain"
import { accountFixture } from "./testing"

it("keeps workspace writes, lifecycle, expiry, deletion and recreation mirrored", async () => {
  const f = await accountFixture()
  try {
    await f.bootstrap()
    const admin = await f.login()
    const project = (await f.json("/projects", "POST", { name: "mirror guard" }, admin.cookie)).data
    const root = `/projects/${project.id}`, path = root + "/workspace"
    const base = (await f.json(path, "GET", undefined, admin.cookie)).data
    const make = (id: string, status: "candidate" | "active") => createMemoryRecord({ id, title: id, content: id, category: "fact", domainIds: [], relatedIds: [], createdAt: "2020-01-01T00:00:00Z", updatedAt: "2020-01-01T00:00:00Z", status, source: { kind: "user", actorId: admin.data.account.id } })
    const memories = [make("a", "candidate"), make("b", "active")]
    const mirror = async (count: number) => expect(await f.repository.verifyMemoryMirror(project.id)).toMatchObject({ ok: true, jsonCount: count, rowCount: count })
    expect((await f.request(path, "PUT", { ...base.data, memories }, admin.cookie, { "If-Match": `"v${base.revision}"` })).status).toBe(200)
    await mirror(2)
    const post = (suffix: string, body?: unknown) => f.json(root + suffix, "POST", body, admin.cookie)
    expect((await post("/memories", { memoryId: "c", input: { title: "c", content: "c", category: "fact", domainIds: [], relatedIds: [] }, expectedVersion: null })).response.status).toBe(200)
    await mirror(3)
    for (const [suffix, body] of [["/memories/a/promote", undefined], ["/memories/c/archive", undefined], ["/memories/a/supersede", { newId: "b" }]] as const) {
      expect((await post(suffix, body)).response.status).toBe(200)
      await mirror(3)
    }
    // Seed a due record through the whole-workspace entry before the explicit expiry route.
    const current = (await f.json(path, "GET", undefined, admin.cookie)).data
    const due = createMemoryRecord({ ...make("due", "active"), validity: { until: "2020-02-01T00:00:00Z" } })
    expect((await f.request(path, "PUT", { ...current.data, memories: [...current.data.memories, due] }, admin.cookie, { "If-Match": `"v${current.revision}"` })).status).toBe(200)
    await mirror(4)
    const expired = await post("/memories/expire")
    expect(expired.response.status).toBe(200)
    expect(expired.data.expired).toBe(1)
    await mirror(4)
    const workspace = await f.repository.get(project.id, "workspace", "default")
    expect((await f.repository.memoryTransitionRows(project.id, "a")).length).toBeGreaterThan(0)
    await f.repository.remove(project.id, "workspace", "default", workspace!.revision, new Date().toISOString())
    expect(await f.repository.memoryRows(project.id)).toEqual([])
    for (const id of ["a", "b", "c", "due"]) expect(await f.repository.memoryTransitionRows(project.id, id)).toEqual([])
    await mirror(0)
    // HTTP cannot delete a workspace, and `createAuthorizedRepository` refuses to save one that is gone
    // (authorized-repository.ts: it requires `current`), so recreation happens at the adapter layer that
    // actually performed the delete. Confirmed 404 on the HTTP path by running it.
    await f.repository.save(project.id, "workspace", "default", { ...base.data, memories }, null, new Date().toISOString())
    await mirror(2)
    expect((await f.repository.memoryRows(project.id)).map(m => m.id).sort()).toEqual(["a", "b"])
  } finally { await f.close() }
})
