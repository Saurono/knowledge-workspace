import { afterEach, beforeEach, expect, it } from "vitest"
import { createMemoryRecord } from "@/modules/memory/domain"
import { accountFixture } from "./testing"

let f: Awaited<ReturnType<typeof accountFixture>>, cookie: string, root: string
beforeEach(async () => {
  f = await accountFixture()
  await f.bootstrap()
  cookie = (await f.login()).cookie
  const project = await f.json("/projects", "POST", { name: "Import source" }, cookie)
  expect(project.response.status).toBe(201)
  root = `/projects/${project.data.id}`
  expect((await f.request(root + "/wiki/page?path=wiki/a.md", "PUT", { content: "Alpha" }, cookie, { "If-None-Match": "*" })).status).toBe(200)
  const workspace = (await f.repository.governanceWorkspace(project.data.id))!
  const memory = createMemoryRecord({ id: "memory-a", title: "Alpha", content: "Alpha", category: "fact", status: "active", domainIds: [], relatedIds: [], createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z" })
  await f.repository.governanceSaveWorkspace(project.data.id, { ...workspace.data, memories: [memory] }, workspace.revision)
})
afterEach(async () => { await f.close() })
const exported = async (path = root) => {
  const response = await f.request(path + "/export", "GET", undefined, cookie)
  expect(response.status).toBe(200)
  return response.json()
}
const newProject = async () => {
  const result = await f.json("/projects", "POST", { name: "Import target" }, cookie)
  expect(result.response.status).toBe(201)
  return `/projects/${result.data.id}`
}

it("plans a dry run without changing any project resources", async () => {
  const bundle = await exported()
  const before = (await f.json(root + "/events", "GET", undefined, cookie)).data
  const result = await f.json(root + "/import?dryRun=1", "POST", bundle, cookie)
  expect(result.response.status).toBe(200)
  expect(result.data).toMatchObject({ dryRun: true, plan: { wiki: { create: [], update: ["wiki/a.md"] }, memories: 1 } })
  expect(await exported()).toEqual(bundle)
  expect((await f.json(root + "/events", "GET", undefined, cookie)).data).toEqual(before)
})
it("updates existing wiki and merges memories idempotently by id", async () => {
  const bundle = await exported()
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await f.json(root + "/import", "POST", bundle, cookie)
    expect(result.response.status).toBe(200)
    expect(result.data.applied).toEqual({ memories: 1, domains: 0, wikiCreated: 0, wikiUpdated: 1 })
    expect(await exported()).toEqual(bundle)
  }
})
it("imports wiki and memories into a new project", async () => {
  const bundle = await exported(), target = await newProject()
  const result = await f.json(target + "/import", "POST", bundle, cookie)
  expect(result.response.status).toBe(200)
  expect(result.data.applied).toEqual({ memories: 1, domains: 0, wikiCreated: 1, wikiUpdated: 0 })
  const actual = await exported(target)
  expect(actual.wiki).toEqual(bundle.wiki)
  expect(actual.workspace.memories).toEqual(bundle.workspace.memories)
})
it("honestly skips document metadata without creating documents", async () => {
  const bundle = await exported(), target = await newProject()
  bundle.documents.push({ sourceId: "document-a", name: "sample.txt", size: 12 })
  const result = await f.json(target + "/import", "POST", bundle, cookie)
  expect(result.response.status).toBe(200)
  expect(result.data.documents).toEqual({ imported: 0, skippedReason: "document bytes are not part of the export bundle" })
  expect(result.data.plan.documents.create).toEqual(["document-a"])
  expect((await f.json(target + "/documents", "GET", undefined, cookie)).data).toEqual([])
})
it("rejects an unknown related memory id with a specific diagnostic", async () => {
  const bundle = await exported()
  bundle.workspace.memories[0].relatedIds = ["missing-memory-id"]
  const result = await f.json(root + "/import", "POST", bundle, cookie)
  expect(result.response.status).toBe(400)
  expect(result.error.code).toBe("invalid_argument")
  expect(result.error.message).toContain("missing-memory-id")
  expect(result.error.details.applied).toEqual({ memories: 0, domains: 0, wikiCreated: 0, wikiUpdated: 0 })
})
it("rejects unsupported bundle versions", async () => {
  const bundle = await exported()
  const result = await f.json(root + "/import", "POST", { ...bundle, bundleVersion: 99 }, cookie)
  expect(result.response.status).toBe(400)
  expect(result.error.code).toBe("invalid_argument")
  expect(result.error.message).toContain("Unsupported export bundle version")
})
