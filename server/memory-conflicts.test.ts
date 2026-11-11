import { expect, it } from "vitest"
import { accountFixture } from "./testing"
import { createMemoryRecord, type MemoryRecord } from "@/modules/memory/domain"

it("routes memory conflicts with deduplication, resolutions, active targets, limits and permissions", async () => {
  const f = await accountFixture()
  try {
    await f.bootstrap()
    const admin = await f.login()
    const project = (await f.json("/projects", "POST", { name: "conflicts" }, admin.cookie)).data
    const memories = ["A", "B"].map(id => createMemoryRecord({
      id, title: id, content: id, category: "fact", domainIds: [], relatedIds: [],
      createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z", status: "active",
    }))
    const save = async (records: MemoryRecord[]) => {
      const workspace = (await f.repository.governanceWorkspace(project.id))!
      await f.repository.governanceSaveWorkspace(project.id, { ...workspace.data, memories: records }, workspace.revision)
    }
    const read = async (query = "", cookie = admin.cookie) => {
      const response = await f.request(`/projects/${project.id}/memories/conflicts${query}`, "GET", undefined, cookie)
      return { status: response.status, body: await response.json() }
    }
    memories[0].relations = [{ type: "contradicts", targetId: "B" }]
    await save(memories)
    const before = await f.repository.governanceWorkspace(project.id)
    const first = await read()
    expect(first.status).toBe(200) // The named route must precede memories/<id>.
    expect(first.body.data.items).toEqual([{ a: "A", b: "B", relation: "contradicts", since: memories[0].updatedAt }])
    expect(await f.repository.governanceWorkspace(project.id)).toEqual(before)

    memories[1].relations = [{ type: "contradicts", targetId: "A" }]
    await save(memories)
    expect((await read()).body.data.items).toHaveLength(1)

    memories[0].resolutions = [{ ofConflictWith: "B", decision: "both-intentional", by: "reviewer", at: memories[0].updatedAt }]
    await save(memories)
    expect((await read()).body.data.items).toEqual([])

    delete memories[0].resolutions
    memories[1].status = "archived"
    await save(memories)
    expect((await read()).body.data.items).toEqual([])

    for (const query of ["?limit=0", "?limit=1001", "?limit=abc"]) {
      const invalid = await read(query)
      expect(invalid.status).toBe(400)
      expect(invalid.body.error.code).toBe("invalid_argument")
    }
    await f.createAccount(admin.cookie, "unprivileged")
    const other = await f.login("unprivileged")
    expect((await read("", other.cookie)).status).toBe(403)
  } finally { await f.close() }
})
