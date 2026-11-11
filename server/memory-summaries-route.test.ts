import { expect, it } from "vitest"
import { accountFixture } from "./testing"
import { createMemoryRecord } from "@/modules/memory/domain"

it("routes memory summaries with pagination, defaults, validation and permission checks", async () => {
  const f = await accountFixture()
  try {
    await f.bootstrap()
    const admin = await f.login()
    const project = (await f.json("/projects", "POST", { name: "summaries" }, admin.cookie)).data
    const workspace = (await f.repository.governanceWorkspace(project.id))!
    const memories = ["a", "b", "c"].map(id => createMemoryRecord({
      id, title: id, content: id, category: "fact", domainIds: [], relatedIds: [],
      createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z", status: "active",
    }))
    await f.repository.governanceSaveWorkspace(project.id, { ...workspace.data, memories }, workspace.revision)
    const path = `/projects/${project.id}/memories/summaries`
    const read = async (query = "", cookie = admin.cookie) => {
      const response = await f.request(path + query, "GET", undefined, cookie)
      return { status: response.status, body: await response.json() }
    }
    const first = await read("?limit=2")
    expect(first.status).toBe(200)
    expect(first.body.data.items).toHaveLength(2)
    expect(first.body.data.nextCursor).toBeTruthy()
    const second = await read(`?limit=2&cursor=${encodeURIComponent(first.body.data.nextCursor)}`)
    expect(second.status).toBe(200)
    expect(second.body.data.items).toHaveLength(1)
    expect(second.body.data.nextCursor).toBeNull()
    expect(new Set([...first.body.data.items, ...second.body.data.items].map(item => item.id))).toEqual(new Set(["a", "b", "c"]))
    const defaults = await read()
    expect(defaults.status).toBe(200)
    expect(defaults.body.data.items).toHaveLength(3)
    expect(defaults.body.data.nextCursor).toBeNull()
    for (const query of ["?limit=0", "?limit=201", "?limit=abc", "?cursor=bad"]) {
      const invalid = await read(query)
      expect(invalid.status).toBe(400)
      expect(invalid.body.error.code).toBe("invalid_argument")
    }
    await f.createAccount(admin.cookie, "unprivileged")
    const other = await f.login("unprivileged")
    expect((await read("", other.cookie)).status).toBe(403)
  } finally { await f.close() }
})
