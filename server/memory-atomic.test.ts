import { afterEach, beforeEach, expect, it } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SqliteRepository } from "./repository"

const now = "2026-11-10"
const memory = (id: string, version = 1) => ({ id, version, status: "active", title: `title${id}`, content: `body${id}`, createdAt: now, updatedAt: now, transitions: [{ status: "active" }] })
let directory: string, repo: SqliteRepository
const write = (id: string, version = 1) => repo.saveMemoryAtomic("p", memory(id, version), { memoryVersion: version === 1 ? null : version - 1 }, now)
const snapshot = async () => ({ rows: await repo.memoryRows("p"), json: await repo.get("p", "workspace", "default") })
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "memory-atomic-"))
  repo = new SqliteRepository(directory)
  await repo.createProject({ id: "p", name: "p", createdAt: now }, {})
})
afterEach(() => { repo.close(); rmSync(directory, { recursive: true, force: true }) })
it("creates and indexes one memory", async () => {
  expect((await write("a")).revision).toBe(2)
  expect(await repo.memoryRows("p")).toHaveLength(1)
  expect((await repo.verifyMemoryMirror("p")).ok).toBe(true)
  expect(await repo.searchMemories({ projectId: "p", query: "titlea" })).toHaveLength(1)
  expect(await repo.memoryTransitionRows("p", "a")).toEqual([{ sequence: 0, data: { status: "active" } }])
})
it("updates JSON and rows while preserving other memories and order", async () => {
  await write("a"); await write("b")
  const before = await repo.memoryRows("p")
  await repo.saveMemoryAtomic("p", { ...memory("a", 2), content: "changed" }, { memoryVersion: 1 }, now)
  const after = await repo.memoryRows("p")
  expect(after[0].version).toBe(2)
  expect(after[0].content).toBe("changed")
  expect(after[1]).toEqual(before[1])
  expect((await repo.get("p", "workspace", "default"))?.data).toEqual({ memories: [after[0].record, before[1].record] })
  expect((await repo.verifyMemoryMirror("p")).ok).toBe(true)
})
it("rejects stale versions without changes", async () => {
  await write("a"); await write("a", 2)
  const before = await snapshot()
  await expect(write("a", 2)).rejects.toThrow("conflict: memory version mismatch")
  expect(await snapshot()).toEqual(before)
})
it("rejects duplicate creation without changes", async () => {
  await write("a")
  const before = await snapshot()
  await expect(write("a")).rejects.toThrow("conflict: memory already exists")
  expect(await snapshot()).toEqual(before)
})
it("allows concurrent writes to different memories", async () => {
  await write("a"); await write("b")
  const results = await Promise.allSettled([write("a", 2), write("b", 2)])
  expect(results.map(result => result.status)).toEqual(["fulfilled", "fulfilled"])
  expect(await repo.memoryRows("p")).toHaveLength(2)
  expect((await repo.verifyMemoryMirror("p")).ok).toBe(true)
})
it("allows exactly one concurrent write to the same memory", async () => {
  await write("a")
  const results = await Promise.allSettled([write("a", 2), write("a", 2)])
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1)
  const rejected = results.filter(result => result.status === "rejected")
  expect(rejected).toHaveLength(1)
  expect(String(rejected[0].reason)).toContain("conflict")
  expect((await repo.memoryRows("p"))[0].version).toBe(2)
  expect((await repo.verifyMemoryMirror("p")).ok).toBe(true)
})
it("only changes the target FTS entry", async () => {
  await write("a"); await write("b")
  const before = await repo.searchMemories({ projectId: "p", query: "bodyb" })
  await repo.saveMemoryAtomic("p", { ...memory("a", 2), content: "replacement" }, { memoryVersion: 1 }, now)
  const hits = await repo.searchMemories({ projectId: "p", query: "bodyb" })
  expect(hits.map(({ memoryId, title, snippet }) => ({ memoryId, title, snippet }))).toEqual(before.map(({ memoryId, title, snippet }) => ({ memoryId, title, snippet })))
  expect(await repo.searchMemories({ projectId: "p", query: "bodya" })).toEqual([])
  expect(await repo.searchMemories({ projectId: "p", query: "replacement" })).toHaveLength(1)
})
