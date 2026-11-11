import { afterEach, beforeEach, expect, it } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { performance } from "node:perf_hooks"
import { SqliteRepository, type MemorySummaryCursor } from "./repository"

const at = "2026-11-10T00:00:00.000Z"
const memory = (id: string, updatedAt = at) => ({ id, title: id, content: "body".repeat(1500), category: "fact", status: "active", version: 1, createdAt: at, updatedAt })
let directory: string, repo: SqliteRepository
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "memory-summaries-"))
  repo = new SqliteRepository(directory)
})
afterEach(() => { repo.close(); rmSync(directory, { recursive: true, force: true }) })
it("pages 1000 memories without duplicates or omissions and measures projection reads", async () => {
  const memories = Array.from({ length: 1000 }, (_, i) => memory(`m${String(i).padStart(4, "0")}`, i < 500 ? at : "2026-11-11T00:00:00.000Z"))
  await repo.createProject({ id: "p", name: "p", createdAt: at }, { memories })
  const first = await repo.memorySummaries("p", { limit: 200 })
  expect(first.items).toHaveLength(200)
  expect(first.nextCursor).not.toBeNull()
  const ids: string[] = []
  let after: MemorySummaryCursor | null = null
  do {
    const page = await repo.memorySummaries("p", { limit: 200, after })
    ids.push(...page.items.map(item => item.id))
    after = page.nextCursor
  } while (after)
  expect(ids).toHaveLength(1000)
  expect(new Set(ids)).toEqual(new Set(memories.map(item => item.id)))
  expect(ids).toEqual([...memories.slice(500), ...memories.slice(0, 500)].map(item => item.id))
  const measure = async (read: () => Promise<unknown>) => {
    await read()
    const start = performance.now()
    for (let i = 0; i < 20; i++) await read()
    return (performance.now() - start) / 20
  }
  const summariesMs = await measure(() => repo.memorySummaries("p", { limit: 200 }))
  const rowsMs = await measure(() => repo.memoryRows("p"))
  console.log(`BENCH ${JSON.stringify({ count: 1000, limit: 200, summariesMs, rowsMs, ratio: summariesMs / rowsMs })}`)
})
it("pages tied timestamps, projects only summary fields, and isolates projects", async () => {
  await repo.createProject({ id: "p", name: "p", createdAt: at }, { memories: [memory("b"), memory("a")] })
  await repo.createProject({ id: "other", name: "other", createdAt: at }, { memories: [memory("foreign")] })
  const first = await repo.memorySummaries("p", { limit: 1 })
  expect(first.items[0]).toEqual({ id: "a", title: "a", status: "active", version: 1, updatedAt: at, owner: null, category: "fact", access: null, source: null, validityUntil: null })
  expect(Object.keys(first.items[0]).sort()).toEqual(["access", "category", "id", "owner", "source", "status", "title", "updatedAt", "validityUntil", "version"].sort())
  expect(first.nextCursor).toEqual({ updatedAt: at, id: "a" })
  const second = await repo.memorySummaries("p", { limit: 1, after: first.nextCursor })
  expect(second.items.map(item => item.id)).toEqual(["b"])
  expect(second.nextCursor).toBeNull()
  expect(await repo.memorySummaries("empty", { limit: 200 })).toEqual({ items: [], nextCursor: null })
})
it.each([0, 201, 1.5])("rejects invalid limit %s", async limit => {
  await expect(repo.memorySummaries("p", { limit })).rejects.toMatchObject({ code: "invalid_argument" })
})
