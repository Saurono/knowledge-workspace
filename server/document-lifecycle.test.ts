import { mkdtempSync, existsSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, it } from "vitest"
import { SqliteRepository } from "./repository"
import { DiskUploads } from "./uploads"
import { removeDocumentCascade } from "./document-lifecycle"

const now = "2026-11-11T00:00:00.000Z"
const key = "document1"
const domainKey = "raw/documents/source1"
const cleanups: (() => void)[] = []
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup() })
async function fixture(links: Record<string, string[]> = { [domainKey]: ["a", "b"] }, bytes = true, document = true) {
  const directory = mkdtempSync(join(tmpdir(), "document-cascade-"))
  const repository = new SqliteRepository(directory)
  const uploads = new DiskUploads(directory)
  cleanups.push(() => { repository.close(); rmSync(directory, { recursive: true, force: true }) })
  await repository.createProject({ id: "project1", name: "Test", createdAt: now }, { resourceDomains: links })
  if (document) await repository.save("project1", "document", key, { sourceId: "source1" }, null, now)
  if (bytes) await uploads.write("project1", "source1", new Uint8Array([1, 2]))
  return { directory, repository, uploads, projectId: "project1", key, expectedRevision: 1, now }
}

it("deletes resource, upload directory and two domain links", async () => {
  const f = await fixture()
  const result = await removeDocumentCascade(f)
  expect(await f.repository.get(f.projectId, "document", key)).toBeNull()
  expect(existsSync(join(f.directory, "uploads", f.projectId, "source1"))).toBe(false)
  const workspace = await f.repository.get(f.projectId, "workspace", "default")
  expect(workspace?.data).toEqual({ resourceDomains: {} })
  expect(result).toEqual({ removed: true, removedUpload: true, clearedDomainLinks: 2, revision: 2 })
})
it("deletes a document without upload bytes", async () => {
  expect(await removeDocumentCascade(await fixture({}, false))).toMatchObject({ removed: true, removedUpload: false })
})
it("preserves repository not_found semantics", async () => {
  await expect(removeDocumentCascade(await fixture({}, false, false))).rejects.toMatchObject({ code: "not_found" })
})
it("does not save workspace when the key is absent", async () => {
  const f = await fixture({ other: ["a"] })
  expect(await removeDocumentCascade(f)).toMatchObject({ clearedDomainLinks: 0, revision: 1 })
  expect((await f.repository.get(f.projectId, "workspace", "default"))?.revision).toBe(1)
})
it.each([key, `raw/documents/${key}`])("normalizes %s equivalently", async input => {
  const f = await fixture()
  expect(await removeDocumentCascade({ ...f, key: input })).toMatchObject({ removed: true, clearedDomainLinks: 2 })
  expect(await f.repository.get(f.projectId, "document", key)).toBeNull()
})
it("preserves conflict semantics and leaves bytes and links intact", async () => {
  const f = await fixture()
  await expect(removeDocumentCascade({ ...f, expectedRevision: 9 })).rejects.toMatchObject({ code: "conflict" })
  expect(Array.from(await f.uploads.read(f.projectId, "source1"))).toEqual([1, 2])
  expect((await f.repository.get(f.projectId, "workspace", "default"))?.revision).toBe(1)
})
it("counts an empty link entry as one cleared entry", async () => {
  expect(await removeDocumentCascade(await fixture({ [domainKey]: [] }))).toMatchObject({ clearedDomainLinks: 1 })
})
it("continues link cleanup when byte deletion fails", async () => {
  const f = await fixture()
  expect(await removeDocumentCascade({ ...f, uploads: { read: f.uploads.read.bind(f.uploads), remove: async () => { throw new Error("failed") } } })).toMatchObject({ removed: true, removedUpload: false, clearedDomainLinks: 2 })
  expect(await f.repository.get(f.projectId, "document", key)).toBeNull()
})
