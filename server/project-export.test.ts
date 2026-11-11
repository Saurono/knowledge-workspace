import { afterEach, beforeEach, expect, it } from "vitest"
import { createMemoryRecord } from "@/modules/memory/domain"
import { accountFixture } from "./testing"

let f: Awaited<ReturnType<typeof accountFixture>>, cookie: string, id: string, root: string
beforeEach(async () => {
  f = await accountFixture()
  await f.bootstrap()
  cookie = (await f.login()).cookie
  const project = await f.json("/projects", "POST", { name: "Export project" }, cookie)
  expect(project.response.status).toBe(201)
  id = project.data.id
  root = `/projects/${id}`
  expect((await f.request(root + "/wiki/page?path=wiki/a.md", "PUT", { content: "Alpha" }, cookie, { "If-None-Match": "*" })).status).toBe(200)
  await f.repository.save(id, "document", "doc", { sourceId: "doc", name: "sample.txt", size: 12, mediaType: "text/plain", byteRevision: "bytes-1", authorship: { internal: true } }, null, "2026-11-01T00:00:00.000Z")
  const workspace = (await f.repository.governanceWorkspace(id))!
  const memories = ["a", "b"].map(id => createMemoryRecord({ id, title: id, content: id, category: "fact", status: "active", domainIds: [], relatedIds: [], createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z" }))
  await f.repository.governanceSaveWorkspace(id, { ...workspace.data, memories }, workspace.revision)
})
afterEach(async () => { await f.close() })
const bundle = async () => {
  const response = await f.request(root + "/export", "GET", undefined, cookie)
  expect(response.status).toBe(200)
  return response.json()
}
it("exports project, workspace, wiki and document counts", async () => {
  const value = await bundle()
  expect(value.bundleVersion).toBe(1)
  expect(value.project.name).toBe("Export project")
  expect(value.wiki).toHaveLength(1)
  expect(value.documents).toHaveLength(1)
  expect(value.workspace.memories).toHaveLength(2)
})
it("exports public fields without authorship", async () => {
  const value = await bundle()
  expect(value.wiki[0]).toEqual({ path: "wiki/a.md", content: "Alpha" })
  expect(value.documents[0]).toEqual({ sourceId: "doc", name: "sample.txt", size: 12, mediaType: "text/plain", byteRevision: "bytes-1" })
  expect(JSON.stringify(value)).not.toContain("authorship")
})
it("omits wiki without wiki.read while preserving other permitted data", async () => {
  const agent = await f.createAccount(cookie, "exporter", "agent")
  const state = await f.authentication.catalog.read()
  await f.authentication.catalog.saveMembership(state.revision, { accountId: agent.id, projectId: id, permissionRole: "editor", workRoleIds: [] })
  const token = await f.json("/auth/tokens", "POST", { accountId: agent.id, projectId: id, label: "Export", workRoleId: null, permissions: ["project.read", "documents.read", "memory.read"], expiresAt: "2026-11-02T00:00:00.000Z" }, cookie)
  expect(token.response.status).toBe(201)
  const response = await f.request(root + "/export", "GET", undefined, "", { Authorization: `Bearer ${token.data.secret}` })
  expect(response.status).toBe(200)
  const value = await response.json()
  expect(value.wiki).toEqual([])
  expect(value.documents).toHaveLength(1)
  expect(value.workspace.memories).toHaveLength(2)
})
// 201 页那条在 Windows CI 上会超过默认 5s（写盘 + 导出分页），给足超时，别用调小页数来"通过"。
it.each([3, 201])("exports all %i wiki pages", async count => {
  for (let i = 1; i < count; i++) await f.repository.save(id, "wiki", `wiki/${i}.md`, { path: `wiki/${i}.md`, content: "Page" }, null, "2026-11-01T00:00:00.000Z")
  expect((await bundle()).wiki).toHaveLength(count)
}, 60_000)
