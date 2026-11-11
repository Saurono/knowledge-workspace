import { expect, it } from "vitest"
import { accountFixture } from "./testing"
import { createMemoryRecord } from "@/modules/memory/domain"

it("routes graph before memory IDs, validates limits, orders nodes and checks permissions", async () => {
  const f = await accountFixture()
  try {
    await f.bootstrap()
    const admin = await f.login()
    const project = (await f.json("/projects", "POST", { name: "graph" }, admin.cookie)).data
    const workspace = (await f.repository.governanceWorkspace(project.id))!
    const memories = ["c", "b", "a"].map(id => createMemoryRecord({
      id, title: id, content: id, category: "fact", domainIds: [], relatedIds: [],
      createdAt: "2026-11-01T00:00:00.000Z",
      updatedAt: id === "c" ? "2026-11-01T00:00:00.000Z" : "2026-11-02T00:00:00.000Z", status: "active",
    }))
    await f.repository.governanceSaveWorkspace(project.id, { ...workspace.data, memories }, workspace.revision)
    const read = async (query = "", cookie = admin.cookie) => {
      const response = await f.request(`/projects/${project.id}/memories/graph${query}`, "GET", undefined, cookie)
      return { status: response.status, body: await response.json() }
    }
    const graph = await read()
    expect(graph.status).toBe(200) // Must not resolve memoryId=graph.
    expect(graph.body.data.items).toHaveLength(3)
    const limited = await read("?limit=1")
    expect(limited.status).toBe(200)
    expect(limited.body.data.items).toHaveLength(1)
    expect(limited.body.data.items[0].id).toBe("a")
    for (const limit of ["0", "2001", "abc"]) {
      const invalid = await read(`?limit=${limit}`)
      expect(invalid.status).toBe(400)
      expect(invalid.body.error.code).toBe("invalid_argument")
    }
    await f.createAccount(admin.cookie, "unprivileged")
    const other = await f.login("unprivileged")
    expect((await read("", other.cookie)).status).toBe(403)
  } finally { await f.close() }
})
