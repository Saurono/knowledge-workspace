import { expect, it } from "vitest"
import { DatabaseSync } from "node:sqlite"
import { createHash } from "node:crypto"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SqliteRepository } from "./repository"

const memory = (id: string) => ({ id, version: 2, status: "active", title: id, content: `内容 ${id}`, createdAt: "2026-01-01", updatedAt: "2026-02-01", transitions: [{ status: "draft" }, { status: "active" }] })
async function fixture(memories: unknown[], check: (directory: string) => Promise<void>) {
  const directory = mkdtempSync(join(tmpdir(), "memory-table-"))
  try {
    const repository = new SqliteRepository(directory)
    try {
      await repository.createProject({ id: "project", name: "Test", createdAt: "2026-01-01" }, {})
      await repository.save("project", "workspace", "default", { memories, domains: [] }, 1, "2026-02-01")
    } finally { repository.close() }
    const db = new DatabaseSync(join(directory, "service.sqlite"))
    try { db.exec("DROP TABLE memory_transitions; DROP TABLE memories; PRAGMA user_version=14") } finally { db.close() }
    await check(directory)
  } finally { rmSync(directory, { recursive: true, force: true }) }
}
it("backfills records, owners, hashes and ordered transitions", async () => {
  const memories = [{ ...memory("a"), access: { ownerId: "owner" }, source: { actorId: "other" } }, { ...memory("b"), source: { actorId: "actor" } }]
  await fixture(memories, async directory => {
    const repository = new SqliteRepository(directory)
    try {
      expect(await repository.memoryRows("project")).toEqual(memories.map((m, i) => ({ id: m.id, version: m.version, status: m.status, owner: i === 0 ? "owner" : "actor", contentHash: createHash("sha256").update(m.content, "utf8").digest("hex"), title: m.title, content: m.content, record: m, createdAt: m.createdAt, updatedAt: m.updatedAt })))
      for (const m of memories) {
        expect((await repository.memoryRows("project"))[0].contentHash).toMatch(/^[a-f0-9]{64}$/)
        expect(await repository.memoryTransitionRows("project", m.id)).toEqual(m.transitions.map((data, sequence) => ({ sequence, data })))
      }
    } finally { repository.close() }
  })
})
it("preserves unknown owner as null", async () => fixture([memory("a")], async directory => {
  const repository = new SqliteRepository(directory)
  try { expect((await repository.memoryRows("project"))[0].owner).toBeNull() } finally { repository.close() }
}))
it("reopens schema 15 without repeating the backfill", async () => fixture([memory("a")], async directory => {
  for (let i = 0; i < 2; i++) {
    const repository = new SqliteRepository(directory)
    try { expect(await repository.memoryRows("project")).toHaveLength(1) } finally { repository.close() }
  }
}))
it("rolls back malformed records with project context", async () => {
  const directory = mkdtempSync(join(tmpdir(), "memory-table-bad-"))
  try {
    const repository = new SqliteRepository(directory)
    try { await repository.createProject({ id: "project", name: "Test", createdAt: "2026-01-01" }, {}) } finally { repository.close() }
    const db = new DatabaseSync(join(directory, "service.sqlite"))
    try {
      db.exec("DROP TABLE memory_transitions; DROP TABLE memories; PRAGMA user_version=14")
      db.prepare("UPDATE resources SET data=? WHERE project_id='project' AND kind='workspace' AND key='default'").run(JSON.stringify({ memories: [{ id: "bad" }], domains: [] }))
    } finally { db.close() }
    expect(() => new SqliteRepository(directory)).toThrow(/project/)
    const check = new DatabaseSync(join(directory, "service.sqlite"))
    try { expect(check.prepare("PRAGMA user_version").get()?.user_version).toBe(14) } finally { check.close() }
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
