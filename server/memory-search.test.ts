import { afterEach, expect, it } from "vitest"
import { accountFixture } from "./testing"
import { createMemoryRecord } from "@/modules/memory/domain"

const closers: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of closers.splice(0)) await close() })
async function fixture() {
  const f = await accountFixture(); closers.push(f.close)
  await f.bootstrap()
  const admin = await f.login()
  const project = (await f.json("/projects", "POST", { name: "Search" }, admin.cookie)).data
  const memories = [createMemoryRecord({ id: "m1", title: "向量数据库选型结论", content: "database123 originalword", category: "fact", domainIds: [], relatedIds: [], importance: 0.5, status: "active", createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z" })]
  const save = async () => {
    const current = (await f.repository.governanceWorkspace(project.id))!
    await f.repository.save(project.id, "workspace", "default", { ...current.data, memories }, current.revision, "2026-11-01T00:00:00Z")
  }
  await save()
  const search = async (query: string) => { const result = await f.json(`/projects/${project.id}/memories/search`, "POST", { query }, admin.cookie); expect(result.response.status, JSON.stringify(result)).toBe(200); return result.data }
  return { f, admin, project, memories, save, search }
}
it("searches Chinese with trigram", async () => {
  const { search } = await fixture()
  expect((await search("向量数据库")).results[0].memoryId).toBe("m1")
})
it("searches English and digits", async () => {
  const { search } = await fixture()
  for (const query of ["database", "123"]) expect((await search(query)).returned).toBe(1)
})
it("isolates projects", async () => {
  const { f, admin } = await fixture()
  const other = (await f.json("/projects", "POST", { name: "Other" }, admin.cookie)).data
  expect(await f.repository.searchMemories({ projectId: other.id, query: "database" })).toEqual([])
})
it("requires a grant for private memories", async () => {
  const { f, admin, project, memories, save, search } = await fixture()
  const owner = await f.createAccount(admin.cookie, "owner")
  await f.authentication.catalog.saveMembership((await f.authentication.catalog.read()).revision, { accountId: owner.id, projectId: project.id, permissionRole: "editor", workRoleIds: [] })
  memories[0].access = { visibility: "private", ownerId: owner.id }; await save()
  expect((await search("database")).returned).toBe(0)
  const login = await f.login("owner")
  expect((await f.request(`/projects/${project.id}/memories/m1/grants`, "POST", { accountId: admin.data.account.id, actions: ["read"], expiresAt: "2026-11-02T00:00:00Z" }, login.cookie)).status).toBe(201)
  expect((await search("database")).returned).toBe(1)
})
it("excludes candidate and archived while retaining their index entries", async () => {
  const { f, project, memories, save, search } = await fixture()
  for (const status of ["candidate", "archived"] as const) {
    memories[0].status = status; await save()
    expect((await search("database")).returned).toBe(0)
    expect(await f.repository.searchMemories({ projectId: project.id, query: "database" })).toHaveLength(1)
  }
})
it("returns empty results for fewer than three characters", async () => {
  const { search } = await fixture()
  for (const query of ["向量", "ab"]) expect((await search(query)).results).toEqual([])
})
it("rebuilds the index on update", async () => {
  const { memories, save, search } = await fixture()
  memories[0] = createMemoryRecord({ ...memories[0], content: "replacementword" }); await save()
  expect((await search("replacementword")).returned).toBe(1)
  expect((await search("originalword")).returned).toBe(0)
})
