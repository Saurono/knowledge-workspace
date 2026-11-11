import { afterEach, beforeEach, expect, it } from "vitest"
import { createMemoryRecord } from "@/modules/memory/domain"
import { accountFixture } from "./testing"

let f: Awaited<ReturnType<typeof accountFixture>>
let cookie: string, otherCookie: string, path: string
const hiddenId = "hidden-memory-id"

beforeEach(async () => {
  f = await accountFixture()
  await f.bootstrap()
  const admin = await f.login()
  cookie = admin.cookie
  const otherAccount = await f.createAccount(cookie, "reader")
  otherCookie = (await f.login("reader")).cookie
  const project = (await f.json("/projects", "POST", { name: "projection" }, cookie)).data
  const catalog = await f.authentication.catalog.read()
  await f.authentication.catalog.saveMembership(catalog.revision, {
    accountId: otherAccount.id, projectId: project.id, permissionRole: "editor", workRoleIds: [],
  })
  const workspace = (await f.repository.governanceWorkspace(project.id))!
  const memories = ["public-a", "public-b", hiddenId].map(id => createMemoryRecord({
    id, title: id, content: id, category: "fact", status: "active", domainIds: ["domain"],
    relatedIds: id === "public-a" ? [hiddenId] : [],
    createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z",
    ...(id === hiddenId ? { access: { visibility: "private" as const, ownerId: admin.data.account.id } } : {}),
  }))
  await f.repository.governanceSaveWorkspace(project.id, {
    ...workspace.data, memories, domains: [{ id: "domain", name: "Domain" }],
    resourceDomains: { "wiki/example.md": ["domain"], "raw/example.pdf": ["domain"] },
  }, workspace.revision)
  path = `/projects/${project.id}/workspace`
})

afterEach(async () => { await f.close() })

it("keeps all three memories for the default workspace read", async () => {
  const result = await f.json(path, "GET", undefined, cookie)
  expect(result.response.status).toBe(200)
  expect(result.data.data.memories).toHaveLength(3)
  expect(result.data.data.domains).toHaveLength(1)
})

it("projects memories to an empty array while preserving domains and real metadata", async () => {
  const full = await f.json(path, "GET", undefined, cookie)
  const light = await f.json(path + "?memories=none", "GET", undefined, cookie)
  expect(light.response.status).toBe(200)
  expect(light.data.data.memories).toEqual([])
  expect(light.data).toEqual({ ...full.data, data: { ...full.data.data, memories: [] } })
  expect(light.response.headers.get("etag")).toBe(full.response.headers.get("etag"))
})

it("rejects every unsupported memories value with invalid_argument", async () => {
  for (const query of ["bogus", "all", "", "none&memories=bogus"]) {
    const result = await f.json(path + "?memories=" + query, "GET", undefined, cookie)
    expect(result.response.status).toBe(400)
    expect(result.error.code).toBe("invalid_argument")
  }
})

it("projects an authorized view without exposing a hidden memory ID in any field", async () => {
  const full = await f.json(path, "GET", undefined, otherCookie)
  const light = await f.json(path + "?memories=none", "GET", undefined, otherCookie)
  expect(full.response.status).toBe(200)
  expect(light.response.status).toBe(200)
  expect(full.data.data.memories).toHaveLength(2)
  expect(full.data.data.memories[0].relatedIds).toEqual([])
  expect(light.data.data.memories).toEqual([])
  expect(light.data.data.domains).toEqual(full.data.data.domains)
  expect(light.data.data.resourceDomains).toEqual(full.data.data.resourceDomains)
  expect(JSON.stringify(light.data)).not.toContain(hiddenId)
})
