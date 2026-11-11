import { describe, expect, it, vi } from "vitest"
import { createRemoteWorkspace } from "./remote-workspace"
import { createWebPlatform } from "./web"
import { createMemoryRecord } from "@/modules/memory/domain"
import type { createSharedClient } from "@/modules/service-api/application"

const record = createMemoryRecord({ id: "m", title: "Title", content: "Content", category: "fact", domainIds: [], relatedIds: [], createdAt: "2026-11-10T00:00:00Z", updatedAt: "2026-11-10T00:00:00Z" })
async function setup(existing = true) {
  const data = { version: 1 as const, domains: [], resourceDomains: {}, memories: existing ? [{ ...record, version: 3 }] : [] }
  const result = { data: { memory: { ...record, version: 4 }, revision: 8, replayed: false } }
  const api = {
    workspace: vi.fn().mockResolvedValue({ data: { data, revision: 7 } }),
    memorySummaries: vi.fn().mockResolvedValue({ data: { items: [], nextCursor: null } }),
    memory: vi.fn().mockResolvedValue(result),
    writeMemory: vi.fn().mockResolvedValue(result),
    memoryAction: vi.fn().mockResolvedValue(result),
    supersedeMemory: vi.fn().mockResolvedValue(result),
    saveWorkspace: vi.fn().mockImplementation(async (_id, saved) => ({ data: { data: saved, revision: 8 } })),
  }
  const workspace = createRemoteWorkspace(api as unknown as ReturnType<typeof createSharedClient>, "p")
  await workspace.load()
  return { api, workspace }
}
describe("remote memory conflicts", () => {
  const items = [{ a: "a", b: "b", relation: "contradicts", since: "2026-11-10T00:00:00Z" }]
  function setupConflicts(status = 200) {
    const payload = status === 200
      ? { data: { items }, meta: { requestId: "r" } }
      : { error: { code: "forbidden", message: "Access denied", requestId: "r" } }
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(JSON.stringify(payload), { status }))
    const { api } = createWebPlatform("https://service.test", "", fetch)
    return { fetch, workspace: createRemoteWorkspace(api, "p") }
  }
  it("fetches conflicts without a query and returns items", async () => {
    const { fetch, workspace } = setupConflicts()
    expect(await workspace.listMemoryConflicts()).toEqual(items)
    expect(fetch).toHaveBeenCalledExactlyOnceWith("https://service.test/api/v1/projects/p/memories/conflicts", expect.objectContaining({ method: "GET" }))
  })
  it("fetches conflicts with the requested limit", async () => {
    const { fetch, workspace } = setupConflicts()
    expect(await workspace.listMemoryConflicts({ limit: 5 })).toEqual(items)
    expect(fetch).toHaveBeenCalledExactlyOnceWith("https://service.test/api/v1/projects/p/memories/conflicts?limit=5", expect.objectContaining({ method: "GET" }))
  })
  it("rejects when the server returns a non-success status", async () => {
    const { workspace } = setupConflicts(403)
    await expect(workspace.listMemoryConflicts()).rejects.toMatchObject({ code: "forbidden", status: 403, message: "Access denied" })
  })
})
describe("remote memory writes", () => {
  it("loads the workspace with undefined options by default", async () => {
    const { api } = await setup()
    expect(api.workspace).toHaveBeenCalledWith("p", undefined)
  })
  it("forwards lightweight workspace options", async () => {
    const { api, workspace } = await setup()
    api.workspace.mockClear()
    await workspace.load({ memories: "none" })
    expect(api.workspace).toHaveBeenCalledExactlyOnceWith("p", { memories: "none" })
  })
  it("lists memory summaries with the requested options and returns the response data", async () => {
    const { api, workspace } = await setup()
    const summaries = { items: [{ id: "m", title: "Title" }], nextCursor: "2026-11-10T00:00:00Z|m" }
    api.memorySummaries.mockResolvedValue({ data: summaries })
    expect(await workspace.listMemorySummaries({ limit: 2 })).toBe(summaries)
    expect(api.memorySummaries).toHaveBeenCalledWith("p", { limit: 2 })
  })
  it("returns the cached memory without requesting it", async () => {
    const { api, workspace } = await setup()
    const cached = workspace.snapshot().data.memories[0]
    expect(await workspace.loadMemory("m")).toBe(cached)
    expect(api.memory).not.toHaveBeenCalled()
  })
  it("fetches a missing memory and merges it into the snapshot", async () => {
    const { api, workspace } = await setup()
    const cached = workspace.snapshot().data.memories[0]
    const fetched = { ...record, id: "x", version: 4 }
    api.memory.mockResolvedValue({ data: { memory: fetched, revision: 8 } })
    expect(await workspace.loadMemory("x")).toBe(fetched)
    expect(api.memory).toHaveBeenCalledWith("p", "x")
    expect(workspace.snapshot().data.memories).toEqual([cached, fetched])
    expect(workspace.snapshot().revision).toBe(8)
  })
  it("updates atomically with the cached record version and caches the response", async () => {
    const { api, workspace } = await setup()
    await workspace.saveMemory(record)
    expect(api.writeMemory).toHaveBeenCalledWith("p", "m", { input: { title: record.title, content: record.content, category: record.category, domainIds: [], relatedIds: [], access: undefined, importance: record.importance, credibility: record.credibility, validity: record.validity }, expectedVersion: 3 })
    expect(api.saveWorkspace).not.toHaveBeenCalled()
    expect(workspace.snapshot().revision).toBe(8)
    expect(workspace.snapshot().data.memories[0].version).toBe(4)
  })
  it("creates with a null expected version", async () => {
    const { api, workspace } = await setup(false)
    await workspace.saveMemory(record)
    expect(api.writeMemory.mock.calls[0][2].expectedVersion).toBeNull()
    expect(api.saveWorkspace).not.toHaveBeenCalled()
  })
  it("routes lifecycle changes through HTTP methods", async () => {
    const { api, workspace } = await setup()
    await workspace.promoteMemory("m")
    await workspace.archiveMemory("m")
    await workspace.supersedeMemory("m", "new")
    expect(api.memoryAction.mock.calls).toEqual([["p", "m", "promote"], ["p", "m", "archive"]])
    expect(api.supersedeMemory).toHaveBeenCalledWith("p", "m", "new")
    expect(api.saveWorkspace).not.toHaveBeenCalled()
  })
  it("retains whole-workspace saving for removal", async () => {
    const { api, workspace } = await setup()
    await workspace.removeMemory("m")
    expect(api.saveWorkspace).toHaveBeenCalledWith("p", expect.objectContaining({ memories: [] }), 7)
    expect(api.writeMemory).not.toHaveBeenCalled()
  })
})
