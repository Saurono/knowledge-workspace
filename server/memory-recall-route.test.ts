import { afterEach, expect, it } from "vitest"
import { accountFixture } from "./testing"
import { createMemoryRecord } from "@/modules/memory/domain"

const closers: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of closers.splice(0)) await close() })
async function fixture() {
  const f = await accountFixture(); closers.push(f.close)
  await f.bootstrap()
  const admin = await f.login()
  const project = (await f.json("/projects", "POST", { name: "Recall" }, admin.cookie)).data
  const root = `/projects/${project.id}`
  const memories = [0.2, 0.9, 0.6].map((importance, i) => createMemoryRecord({ id: `m${i}`, title: `Title${i}`, content: `Content${i}`, category: "fact", domainIds: [], relatedIds: [], importance, status: "active", createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z" }))
  const save = async () => {
    const current = await f.repository.governanceWorkspace(project.id)
    await f.repository.save(project.id, "workspace", "default", { ...current!.data, memories }, current!.revision, "2026-11-01T00:00:00Z")
  }
  await save()
  const recall = (body: unknown = {}, cookie = admin.cookie) => f.json(root + "/memories/recall", "POST", body, cookie)
  return { f, admin, project, root, memories, save, recall }
}
it("recalls two memories in importance and citation order without duplicate content", async () => {
  const { recall } = await fixture(), result = await recall({ limit: 2 })
  expect(result.response.status).toBe(200)
  expect(result.data.recall.hits.map((h: { memoryId: string }) => h.memoryId)).toEqual(["m1", "m2"])
  expect(result.data.injection.text).toContain("Content1")
  expect(result.data.injection.text).toContain("Content2")
  expect(result.data.injection.text.indexOf("Content1")).toBeLessThan(result.data.injection.text.indexOf("Content2"))
  expect(result.data.injection.citations).toEqual(result.data.recall.hits.map((h: { memoryId: string; version: number }) => ({ memoryId: h.memoryId, version: h.version })))
  expect(Object.keys(result.data.recall.hits[0]).sort()).toEqual(["memoryId", "reason", "score", "version"])
})
it("requires a valid grant for private memory", async () => {
  const { f, admin, project, root, memories, save, recall } = await fixture()
  const owner = await f.createAccount(admin.cookie, "owner")
  await f.authentication.catalog.saveMembership((await f.authentication.catalog.read()).revision, { accountId: owner.id, projectId: project.id, permissionRole: "editor", workRoleIds: [] })
  memories[1].access = { visibility: "private", ownerId: owner.id }
  await save()
  const denied = (await recall()).data
  expect(denied.injection.text).not.toContain("Content1")
  expect(denied.recall.hits.some((h: { memoryId: string }) => h.memoryId === "m1")).toBe(false)
  const login = await f.login("owner")
  expect((await f.request(root + "/memories/m1/grants", "POST", { accountId: admin.data.account.id, actions: ["read"], expiresAt: "2026-11-02T00:00:00Z" }, login.cookie)).status).toBe(201)
  const allowed = (await recall()).data
  expect(allowed.injection.text).toContain("Content1")
  expect(allowed.recall.hits.some((h: { memoryId: string }) => h.memoryId === "m1")).toBe(true)
})
it("excludes candidate and archived memories", async () => {
  const { memories, save, recall } = await fixture()
  memories[0].status = "candidate"; memories[1].status = "archived"
  await save()
  const result = (await recall()).data
  expect(result.recall.hits.map((h: { memoryId: string }) => h.memoryId)).toEqual(["m2"])
  expect(result.injection.text).not.toMatch(/Content[01]/)
})
it("validates recall parameters", async () => {
  const { recall } = await fixture()
  for (const body of [{ limit: 0 }, { limit: 51 }, { limit: 1.5 }, { maxChars: 50 }, { maxChars: 20001 }, { taskId: 1 }]) {
    const result = await recall(body)
    expect(result.response.status).toBe(400)
    expect(result.error.code).toBe("invalid_argument")
  }
})
it("returns deterministic text and citations", async () => {
  const { recall } = await fixture(), a = (await recall({ limit: 2, taskId: "task" })).data, b = (await recall({ limit: 2, taskId: "task" })).data
  expect(a.injection.text).toBe(b.injection.text)
  expect(a.injection.citations).toEqual(b.injection.citations)
})
it("denies credentials without memory.read", async () => {
  const { f, admin, project, root } = await fixture()
  const agent = await f.createAccount(admin.cookie, "robot", "agent")
  await f.authentication.catalog.saveMembership((await f.authentication.catalog.read()).revision, { accountId: agent.id, projectId: project.id, permissionRole: "editor", workRoleIds: [] })
  const token = (await f.json("/auth/tokens", "POST", { accountId: agent.id, projectId: project.id, label: "Restricted", workRoleId: null, permissions: ["project.read"], expiresAt: "2026-11-02T00:00:00Z" }, admin.cookie)).data
  expect((await f.request(root + "/memories/recall", "POST", {}, "", { Authorization: `Bearer ${token.secret}` })).status).toBe(403)
})
