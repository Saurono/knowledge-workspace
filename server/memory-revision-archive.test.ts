import { afterEach, beforeEach, expect, it } from "vitest"
import { DatabaseSync } from "node:sqlite"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SERVICE_SCHEMA_VERSION, SqliteRepository } from "./repository"

let directory: string, repository: SqliteRepository, db: DatabaseSync
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "kw-memory-archive-"))
  repository = new SqliteRepository(directory)
  await repository.createProject({ id: "project", name: "Archive", createdAt: new Date().toISOString() }, {})
  db = new DatabaseSync(join(directory, "service.sqlite"))
})
afterEach(() => { db.close(); repository.close(); rmSync(directory, { recursive: true, force: true }) })
const revisions = [{ version: 1, data: { content: "first" } }, { version: 2, data: { content: "second" } }]
const rows = () => db.prepare("SELECT version,data,archived_at FROM memory_revision_archive ORDER BY version").all()

it("archives two revisions as JSON strings", async () => {
  await repository.archiveMemoryRevisions("project", "memory", revisions)
  expect(rows()).toEqual(revisions.map(revision => ({ version: revision.version, data: JSON.stringify(revision.data), archived_at: expect.any(String) })))
  expect(rows().every(row => Number.isFinite(Date.parse(String(row.archived_at))))).toBe(true)
})
it("ignores duplicate versions without overwriting", async () => {
  await repository.archiveMemoryRevisions("project", "memory", revisions)
  const original = rows()
  await repository.archiveMemoryRevisions("project", "memory", revisions.map(revision => ({ ...revision, data: { content: "changed" } })))
  expect(rows()).toEqual(original)
  expect(rows()).toHaveLength(2)
})
it("accepts an empty array without writing", async () => {
  await expect(repository.archiveMemoryRevisions("project", "memory", [])).resolves.toBeUndefined()
  expect(rows()).toEqual([])
})
it("rejects an empty memory id", async () => {
  await expect(repository.archiveMemoryRevisions("project", "", revisions)).rejects.toThrow("Memory id is required")
  expect(rows()).toEqual([])
})
it("reopens the migrated directory without losing archives", async () => {
  await repository.archiveMemoryRevisions("project", "memory", revisions)
  repository.close()
  repository = new SqliteRepository(directory)
  expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: SERVICE_SCHEMA_VERSION })
  expect(rows()).toHaveLength(2)
})
