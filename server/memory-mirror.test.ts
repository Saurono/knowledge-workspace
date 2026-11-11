import { afterEach, beforeEach, expect, it } from "vitest"
import { DatabaseSync } from "node:sqlite"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SqliteRepository } from "./repository"

const now = "2026-11-10"
const memory = (id: string) => ({ id, version: 1, status: "active", title: id, content: `内容 ${id}`, createdAt: now, updatedAt: now,
  access: { ownerId: "owner" }, source: { actorId: "actor" }, transitions: [{ status: "candidate" }, { status: "active" }] })
let directory: string
let repository: SqliteRepository
let revision: number
async function save(memories: unknown[]) {
  const result = await repository.save("project", "workspace", "default", { memories }, revision, now)
  revision = result.revision
}
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "memory-mirror-"))
  repository = new SqliteRepository(directory)
  await repository.createProject({ id: "project", name: "Test", createdAt: now }, {})
  revision = 1
})
afterEach(() => { repository.close(); rmSync(directory, { recursive: true, force: true }) })

it("mirrors two records and verifies normalized fields", async () => {
  await save([memory("a"), memory("b")])
  expect(await repository.verifyMemoryMirror("project")).toEqual({ ok: true, jsonCount: 2, rowCount: 2, missingInRows: [], extraInRows: [], mismatched: [] })
})
it("updates content hash and version without changing another record", async () => {
  await save([memory("a"), memory("b")])
  const before = await repository.memoryRows("project")
  await save([{ ...memory("a"), content: "changed", version: 2 }, memory("b")])
  const after = await repository.memoryRows("project")
  expect(after[0].contentHash).not.toBe(before[0].contentHash)
  expect(after[0].version).toBe(2)
  expect(after[1]).toEqual(before[1])
  expect((await repository.verifyMemoryMirror("project")).ok).toBe(true)
})
it("deletes removed records and their transitions", async () => {
  await save([memory("a"), memory("b")])
  await save([memory("a")])
  expect(await repository.memoryRows("project")).toHaveLength(1)
  expect(await repository.memoryTransitionRows("project", "b")).toEqual([])
  expect((await repository.verifyMemoryMirror("project")).ok).toBe(true)
})
it("adds a record and preserves transition array order", async () => {
  await save([memory("a"), memory("b")])
  await save([memory("a")])
  const added = { ...memory("c"), transitions: [{ status: "active" }, { status: "candidate" }, { status: "active" }] }
  await save([memory("a"), added])
  expect(await repository.memoryRows("project")).toHaveLength(2)
  expect(await repository.memoryTransitionRows("project", "c")).toEqual(added.transitions.map((data, sequence) => ({ sequence, data })))
  expect((await repository.verifyMemoryMirror("project")).ok).toBe(true)
})
it("rolls back JSON, rows and transitions when a later mirror insert fails", async () => {
  await save([memory("a"), memory("b")])
  const before = await repository.memoryRows("project")
  const workspace = await repository.get("project", "workspace", "default")
  const transitions = await repository.memoryTransitionRows("project", "a")
  // JSON serialization succeeds; the later row fails the schema CHECK after a was updated.
  await expect(save([{ ...memory("a"), content: "changed", transitions: [] }, { ...memory("c"), version: -1 }])).rejects.toThrow(/Memory mirror write failed/)
  expect(await repository.memoryRows("project")).toEqual(before)
  expect(await repository.get("project", "workspace", "default")).toEqual(workspace)
  expect(await repository.memoryTransitionRows("project", "a")).toEqual(transitions)
  expect((await repository.verifyMemoryMirror("project")).ok).toBe(true)
})
it("saves identical data repeatedly without changing rows or transitions", async () => {
  const data = [memory("a"), memory("b")]
  await save(data)
  const before = await repository.memoryRows("project")
  const transitions = await repository.memoryTransitionRows("project", "a")
  await save(data)
  expect(await repository.memoryRows("project")).toEqual(before)
  expect(await repository.memoryTransitionRows("project", "a")).toEqual(transitions)
  expect((await repository.verifyMemoryMirror("project")).ok).toBe(true)
})
it("reports missing, extra and mismatched fields without relying on object key order", async () => {
  await save([memory("a"), memory("b")])
  const db = new DatabaseSync(join(directory, "service.sqlite"))
  try {
    db.prepare("UPDATE memories SET record_json=? WHERE project_id=? AND id=?").run(JSON.stringify(Object.fromEntries(Object.entries(memory("a")).reverse())), "project", "a")
    expect((await repository.verifyMemoryMirror("project")).ok).toBe(true)
    db.prepare("UPDATE memories SET version=9 WHERE project_id=? AND id=?").run("project", "a")
    db.prepare("DELETE FROM memory_transitions WHERE project_id=? AND memory_id=?").run("project", "b")
    db.prepare("UPDATE memories SET id='extra' WHERE project_id=? AND id=?").run("project", "b")
    expect(await repository.verifyMemoryMirror("project")).toEqual({ ok: false, jsonCount: 2, rowCount: 2, missingInRows: ["b"], extraInRows: ["extra"], mismatched: ["a:version"] })
  } finally { db.close() }
})
