import { afterEach, expect, it } from "vitest"
import { accountFixture } from "./testing"
import type { ProjectPermission } from "@/modules/identity/domain"

const closers: (() => Promise<void>)[] = []
afterEach(async () => { for (const close of closers.splice(0)) await close() })

async function fixture(permissions: ProjectPermission[] = ["project.read", "memory.read"]) {
  const f = await accountFixture()
  closers.push(f.close)
  await f.bootstrap()
  const admin = await f.login()
  const project = (await f.json("/projects", "POST", { name: "CLI memory reads" }, admin.cookie)).data
  const root = `/projects/${project.id}`
  for (const memoryId of ["a", "b", "c"]) {
    const created = await f.json(root + "/memories", "POST", { memoryId, input: { title: memoryId, content: memoryId, category: "fact", domainIds: [], relatedIds: [] }, expectedVersion: null }, admin.cookie)
    expect(created.response.status).toBe(200)
  }
  const agent = await f.createAccount(admin.cookie, "cli-reader", "agent")
  const state = await f.authentication.catalog.read()
  await f.authentication.catalog.saveMembership(state.revision, { accountId: agent.id, projectId: project.id, permissionRole: "editor", workRoleIds: [] })
  const issued = await f.json("/auth/tokens", "POST", { accountId: agent.id, projectId: project.id, label: "CLI fixture", workRoleId: null, permissions, expiresAt: "2026-11-02T00:00:00.000Z" }, admin.cookie)
  expect(issued.response.status).toBeLessThan(400)
  const headers = { Authorization: `Bearer ${issued.data.secret}` }
  return { post: (body: Record<string, unknown>) => f.json(root + "/cli", "POST", body, "", headers) }
}

it("reads memory summaries through CLI with a bounded page", async () => {
  const f = await fixture()
  const result = await f.post({ tool: "memory.summaries", limit: "2" })
  expect(result.response.status).toBe(200)
  expect(Array.isArray(result.data.items)).toBe(true)
  expect(result.data.items.length).toBeLessThanOrEqual(2)
  expect(result.data.items).toHaveLength(2)
  expect(result.data.nextCursor).toEqual(expect.any(String))
})

it("reads memory graph items through CLI", async () => {
  const f = await fixture()
  const result = await f.post({ tool: "memory.graph" })
  expect(result.response.status).toBe(200)
  expect(result.data).toEqual({ items: expect.any(Array) })
  expect(result.data.items).toHaveLength(3)
})

it("requires memory.read for CLI memory summaries", async () => {
  const f = await fixture(["project.read", "wiki.read"])
  const result = await f.post({ tool: "memory.summaries" })
  expect(result.response.status).toBe(403)
  expect(result.error.code).toBe("forbidden")
})

it("rejects unsupported CLI memory tools", async () => {
  const f = await fixture()
  const result = await f.post({ tool: "memory.write" })
  expect(result.response.status).toBe(501)
  expect(result.error.code).toBe("unsupported")
})

it("uses service validation for invalid CLI memory limits", async () => {
  const f = await fixture()
  for (const tool of ["memory.summaries", "memory.graph"]) {
    const result = await f.post({ tool, limit: "0" })
    expect(result.response.status).toBe(400)
    expect(result.error.code).toBe("invalid_argument")
  }
})
