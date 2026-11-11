import { expect, it } from "vitest"
import { accountFixture } from "./testing"
import { createMemoryRecord } from "@/modules/memory/domain"

it("atomically writes different memories and rejects concurrent writes to one memory", async () => {
  const f = await accountFixture()
  try {
    await f.bootstrap()
    const admin = await f.login()
    const project = (await f.json("/projects", "POST", { name: "atomic writes" }, admin.cookie)).data
    const root = `/projects/${project.id}`
    const post = (memoryId: string, content: string, expectedVersion: number | null) => f.json(root + "/memories", "POST", { memoryId, input: { title: memoryId, content, category: "fact", domainIds: [], relatedIds: [] }, expectedVersion }, admin.cookie)
    const a = await post("a", "initial a", null), b = await post("b", "initial b", null)
    const different = await Promise.all([post("a", "updated a", a.data.memory.version), post("b", "updated b", b.data.memory.version)])
    expect(different.map(value => value.response.status)).toEqual([200, 200])
    const same = await Promise.all([post("a", "winner one", different[0].data.memory.version), post("a", "winner two", different[0].data.memory.version)])
    expect(same.map(value => value.response.status).sort()).toEqual([200, 409])
    expect(same.find(value => value.response.status === 409)!.error.details).toHaveProperty("currentVersion")
    const workspace = await f.json(root + "/workspace", "GET", undefined, admin.cookie)
    expect(workspace.data.data.memories).toContainEqual(expect.objectContaining({ id: "b", content: "updated b" }))
    expect(workspace.data.data.memories).toContainEqual(expect.objectContaining({ id: "a", content: same.find(value => value.response.status === 200)!.data.memory.content }))
  } finally { await f.close() }
})

it("explicitly expires due memories without redundant saves and requires memory.write", async () => {
  const f = await accountFixture()
  try {
    await f.bootstrap()
    const admin = await f.login()
    const project = (await f.json("/projects", "POST", { name: "explicit expiry" }, admin.cookie)).data
    const root = `/projects/${project.id}`
    const workspace = (await f.repository.governanceWorkspace(project.id))!
    const make = (id: string, until: string) => createMemoryRecord({ id, title: id, content: id, category: "fact", domainIds: [], relatedIds: [], createdAt: "2020-01-01T00:00:00Z", updatedAt: "2020-01-01T00:00:00Z", status: "active", validity: { until } })
    const original = [make("due-a", "2020-02-01T00:00:00Z"), make("due-b", "2020-03-01T00:00:00Z"), make("future", "2099-01-01T00:00:00Z")]
    await f.repository.governanceSaveWorkspace(project.id, { ...workspace.data, memories: original }, workspace.revision)
    const first = await f.json(root + "/memories/expire", "POST", undefined, admin.cookie)
    expect(first.response.status).toBe(200)
    expect(first.data.expired).toBe(2)
    const saved = (await f.repository.governanceWorkspace(project.id))!
    expect(saved.revision).toBe(first.data.revision)
    for (const previous of original.slice(0, 2)) {
      const memory = saved.data.memories.find(item => item.id === previous.id)!
      expect(memory.status).toBe("expired")
      expect(memory.transitions).toHaveLength(previous.transitions.length + 1)
    }
    expect(saved.data.memories.find(item => item.id === "future")).toEqual(original[2])
    const second = await f.json(root + "/memories/expire", "POST", undefined, admin.cookie)
    expect(second.response.status).toBe(200)
    expect(second.data).toEqual({ expired: 0, revision: first.data.revision })
    expect((await f.repository.governanceWorkspace(project.id))!.revision).toBe(saved.revision)
    const reader = await f.createAccount(admin.cookie, "expiry-reader")
    const state = await f.authentication.catalog.read()
    await f.authentication.catalog.saveMembership(state.revision, { accountId: reader.id, projectId: project.id, permissionRole: "viewer", workRoleIds: [] })
    const other = await f.login("expiry-reader")
    expect((await f.request(root + "/memories/expire", "POST", undefined, other.cookie)).status).toBe(403)
  } finally { await f.close() }
})

it("deduplicates normalized content and enforces memory size and count limits", async () => {
  const f = await accountFixture()
  try {
    await f.bootstrap()
    const admin = await f.login()
    const project = (await f.json("/projects", "POST", { name: "limits" }, admin.cookie)).data
    const root = `/projects/${project.id}`
    const write = (memoryId: string, content: string) => f.json(root + "/memories", "POST", {
      memoryId, input: { title: "title", content, category: "fact", domainIds: [], relatedIds: [] }, expectedVersion: null,
    }, admin.cookie)
    expect((await write("first", "one two")).response.status).toBe(200)
    for (const [id, content] of [["duplicate", "one two"], ["normalized", "one  \n two"]]) {
      const result = await write(id, content)
      expect(result.response.status).toBe(409)
      expect(result.error.details.duplicateOf).toBe("first")
    }
    expect((await write("different", "different")).response.status).toBe(200)
    expect((await write("large", "x".repeat(32769))).response.status).toBe(413)
    const workspace = (await f.repository.governanceWorkspace(project.id))!
    const sample = workspace.data.memories[0]
    await f.repository.governanceSaveWorkspace(project.id, { ...workspace.data,
      memories: Array.from({ length: 2001 }, (_, index) => ({ ...sample, id: `quota-${index}` })),
    }, workspace.revision)
    expect((await write("quota", "new quota content")).response.status).toBe(429)
  } finally { await f.close() }
}, 10000)

it("archives HTTP revision history before compacting and keeps ordinary writes intact", async () => {
  const f = await accountFixture()
  try {
    await f.bootstrap()
    const admin = await f.login()
    const project = (await f.json("/projects", "POST", { name: "compaction" }, admin.cookie)).data
    const root = `/projects/${project.id}`
    let version: number | null = null
    for (let i = 0; i < 12; i++) {
      const written = await f.json(root + "/memories", "POST", { memoryId: "history", input: { title: "history", content: `content ${i}`, category: "fact", domainIds: [], relatedIds: [] }, expectedVersion: version }, admin.cookie)
      expect(written.response.status).toBe(200)
      version = written.data.memory.version
      if (i === 0) expect(written.data.memory.revisionCompaction).toBeUndefined()
    }
    const read = async () => (await f.json(root + "/memories/history", "GET", undefined, admin.cookie)).data.memory
    const before = await read()
    expect(before.revisions.length).toBeLessThanOrEqual(8)
    expect(before.revisions.length).toBe(8)
    expect(before.revisionCompaction).toBeDefined()
    expect(before.revisionCompaction.keptFrom).toBe(before.revisions[0].version)
    expect(before.revisionCompaction.digest).toMatch(/^[0-9a-f]{16}$/i)
    expect(before.revisions[0].version).toBeGreaterThan(1)
    console.info("12 writes:", JSON.stringify({ revisionsLength: before.revisions.length, revisionCompaction: before.revisionCompaction }))
    const db = (f.repository as unknown as { db: { prepare(sql: string): { get(...args: string[]): unknown } } }).db
    expect(Number((db.prepare("SELECT count(*) AS count FROM memory_revision_archive WHERE project_id = ? AND memory_id = ?").get(project.id, "history") as { count: number }).count)).toBeGreaterThan(0)
    expect((await f.json(root + "/memories", "POST", { memoryId: "history", input: { content: "content 12" }, expectedVersion: version }, admin.cookie)).response.status).toBe(200)
    const after = await read()
    expect(after.revisions.length).toBeLessThanOrEqual(6)
    // The thirteenth revision exceeds the threshold and compacts again.
    expect(after.revisionCompaction.keptFrom).toBeGreaterThan(before.revisionCompaction.keptFrom)
  } finally { await f.close() }
})

it("persists due expiry with an unrelated write and leaves GET revisions stable", async () => {
  const f = await accountFixture()
  try {
    await f.bootstrap()
    const admin = await f.login()
    const project = (await f.json("/projects", "POST", { name: "expiry" }, admin.cookie)).data
    const root = `/projects/${project.id}`, path = root + "/workspace"
    const base = (await f.json(path, "GET", undefined, admin.cookie)).data
    const make = (id: string, until: string) => createMemoryRecord({ id, title: id, content: id, category: "fact", domainIds: [], relatedIds: [], createdAt: "2020-01-01T00:00:00Z", updatedAt: "2020-01-01T00:00:00Z", status: "active", validity: { until } })
    const due = make("due", "2020-02-01T00:00:00Z"), future = make("future", "2099-01-01T00:00:00Z")
    expect((await f.request(path, "PUT", { ...base.data, memories: [due, future] }, admin.cookie, { "If-Match": `"v${base.revision}"` })).status).toBe(200)
    const first = (await f.json(path, "GET", undefined, admin.cookie)).data
    expect((await f.json(path, "GET", undefined, admin.cookie)).data.revision).toBe(first.revision)
    expect((await f.repository.governanceWorkspace(project.id))?.data.memories.find(m => m.id === "due")?.status).toBe("active")
    const written = await f.json(root + "/memories", "POST", { memoryId: "other", input: { title: "other", content: "other", category: "fact", domainIds: [], relatedIds: [] }, expectedVersion: null }, admin.cookie)
    expect(written.response.status).toBe(200)
    const memories = (await f.repository.governanceWorkspace(project.id))!.data.memories
    const expired = memories.find(m => m.id === "due")!
    expect(expired.status).toBe("expired")
    expect(expired.transitions.length - due.transitions.length).toBe(1)
    expect(expired.transitions[expired.transitions.length - 1]).toMatchObject({ to: "expired", at: expect.any(String) })
    expect(Number.isFinite(Date.parse(expired.transitions[expired.transitions.length - 1].at))).toBe(true)
    expect(memories.find(m => m.id === "future")!.transitions.length - future.transitions.length).toBe(0)
  } finally { await f.close() }
})

it("memory lifecycle and versioned HTTP writes", async () => {
  const f = await accountFixture()
  try {
    await f.bootstrap()
    const admin = await f.login()
    const project = (await f.json("/projects", "POST", { name: "routes" }, admin.cookie)).data
    const root = `/projects/${project.id}`, path = root + "/workspace"
    const base = (await f.json(path, "GET", undefined, admin.cookie)).data
    const make = (id: string, status: "candidate" | "active" | "archived") => createMemoryRecord({ id, title: id, content: id, category: "fact", domainIds: [], relatedIds: [], createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z", status })
    const a = createMemoryRecord({ ...make("a", "candidate"), source: { kind: "user", actorId: admin.data.account.id } }), b = make("b", "active"), c = make("c", "archived")
    expect((await f.request(path, "PUT", { ...base.data, memories: [a, b, c] }, admin.cookie, { "If-Match": `"v${base.revision}"` })).status).toBe(200)
    const post = (suffix: string, body?: unknown) => f.json(root + suffix, "POST", body, admin.cookie)
    const get = (id: string) => f.json(root + "/memories/" + id, "GET", undefined, admin.cookie)
    const attack = await post("/memories", { memoryId: "a", input: { status: "active" }, expectedVersion: a.version })
    expect(attack.response.status).toBe(400)
    expect((await get("a")).data.memory).toMatchObject({ status: "candidate", transitions: a.transitions, version: a.version })
    const updated = await post("/memories", { memoryId: "a", input: { content: "updated" }, expectedVersion: a.version })
    expect(updated.response.status).toBe(200)
    expect(updated.data.memory).toMatchObject({ status: "candidate", version: a.version + 1 })
    const created = await post("/memories", { memoryId: "new", input: { title: "new", content: "new", category: "fact", domainIds: [], relatedIds: [] }, expectedVersion: null })
    expect(created.response.status).toBe(200)
    expect(created.data.memory.status).toBe("active")
    expect((await post("/memories/a/promote")).response.status).toBe(200)
    expect((await get("a")).data.memory).toMatchObject({ status: "active", transitions: expect.any(Array) })
    expect((await post("/memories/a/resolve", { withId: "b", decision: "invalid" })).response.status).toBe(400)
    const resolved = await post("/memories/b/resolve", { withId: "a", decision: "both-intentional" })
    expect(resolved.response.status).toBe(200)
    expect(resolved.data.memories.find((m: { id: string }) => m.id === "a").resolutions).toEqual([expect.objectContaining({ ofConflictWith: "b", by: admin.data.account.id })])
    expect((await post("/memories/c/promote")).response.status).toBe(409)
    expect((await get("c")).response.status).toBe(404)
    expect(((await f.repository.governanceWorkspace(project.id))?.data.memories.find(m => m.id === "c"))?.status).toBe("archived")
    expect((await post("/memories/c/archive")).response.status).toBe(200)
    const old = (await get("a")).data.memory, next = (await get("b")).data.memory
    expect((await post("/memories/a/supersede", { newId: "b" })).response.status).toBe(200)
    expect((await f.repository.governanceWorkspace(project.id))?.data.memories.find(m => m.id === "a")).toMatchObject({ supersededById: "b", transitions: expect.arrayContaining(old.transitions) })
    expect((await get("b")).data.memory.transitions).toHaveLength(next.transitions.length + 1)
    expect((await get("b")).data.memory.supersedesId).toBe("a")
    const body = { memoryId: "b", input: { content: "changed" }, expectedVersion: next.version, idempotencyKey: "write-1" }
    expect((await post("/memories", { ...body, expectedVersion: 999 })).response.status).toBe(409)
    expect((await get("b")).data.memory.content).toBe("b")
    const written = await post("/memories", body)
    expect(written.response.status).toBe(200)
    expect(written.data.memory.version).toBe(next.version + 1)
    const replay = await post("/memories", body)
    expect(replay.response.status).toBe(200)
    expect(replay.data.replayed).toBe(true)
    expect(replay.data.memory).toEqual(written.data.memory)
    expect((await get("b")).data.memory.version).toBe(written.data.memory.version)
    expect((await post("/memories", { ...body, input: { content: "different" } })).response.status).toBe(409)
    expect((await get("missing")).response.status).toBe(404)
    expect((await post("/memories/b/archive")).response.status).toBe(200)
    expect((await post("/memories/a/archive")).response.status).toBe(200)
    expect((await f.json(path, "GET", undefined, admin.cookie)).data.data.memories).toContainEqual(expect.objectContaining({ id: "a", status: "archived" }))
    expect((await get("b")).response.status).toBe(200)
    const reader = await f.createAccount(admin.cookie, "reader")
    const state = await f.authentication.catalog.read()
    await f.authentication.catalog.saveMembership(state.revision, { accountId: reader.id, projectId: project.id, permissionRole: "viewer", workRoleIds: [] })
    const other = await f.login("reader")
    const view = await f.json(path, "GET", undefined, other.cookie)
    expect(view.response.status).toBe(200)
    expect(view.data.data.memories.some((memory: { id: string }) => memory.id === "b")).toBe(false)
    expect(view.data.data.memories.some((memory: { id: string }) => memory.id === "a")).toBe(false)
    for (const suffix of ["/memories/a/promote", "/memories/a/archive", "/memories/a/supersede", "/memories"]) {
      expect((await f.request(root + suffix, "POST", { newId: "b", ...body }, other.cookie)).status).toBe(403)
    }
  } finally { await f.close() }
})
