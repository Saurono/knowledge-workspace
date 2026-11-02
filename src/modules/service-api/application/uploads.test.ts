import { expect, it, vi } from "vitest"
import { createHash } from "node:crypto"
import { createDocumentReceiver } from "./uploads"
import type { SharedRepository } from "./ports"
it("removes the stored binary if publishing its metadata fails and preserves the original failure", async () => {
  const failure = new Error("database unavailable"), write = vi.fn(async () => {}), remove = vi.fn(async () => { throw new Error("cleanup also failed") })
  const repository = { project: async () => ({ id: "project", name: "Project", createdAt: "time" }), save: vi.fn(async () => { throw failure }) } as unknown as SharedRepository
  const receiver = createDocumentReceiver(repository, { write, remove, read: vi.fn() }, { id: () => "document", now: () => "2026-10-01T10:00:00.000Z", hash: () => "hash" })
  await expect(receiver.receive("project", "note.md", "text/markdown", new Uint8Array([1, 2]))).rejects.toBe(failure)
  expect(write).toHaveBeenCalledOnce(); expect(remove).toHaveBeenCalledWith("project", "document")
})

it.each(["missing", "damaged"] as const)("refuses an idempotent replay with %s published bytes", async mode => {
  const objects = new Map<string, Uint8Array>()
  const rows = new Map<string, any>()
  let nextId = 0
  const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")
  const repository = { project: async () => ({ id: "project", name: "Project", createdAt: "time" }) } as unknown as SharedRepository
  const storage = {
    write: vi.fn(async (_project: string, id: string, bytes: Uint8Array) => { objects.set(id, bytes.slice()) }),
    read: vi.fn(async (_project: string, id: string) => {
      const bytes = objects.get(id)
      if (!bytes) throw new Error("missing bytes")
      return bytes.slice()
    }),
    remove: vi.fn(async (_project: string, id: string) => { objects.delete(id) }),
  }
  const registry = {
    register: vi.fn(async input => {
      const prior = rows.get(input.idempotencyHash)
      if (prior) return { status: "existing" as const, record: prior }
      const record = { projectId: input.projectId, kind: "document" as const, key: input.documentId, data: input.data, revision: 1, createdAt: input.now, updatedAt: input.now }
      rows.set(input.idempotencyHash, record)
      return { status: "created" as const, record }
    }),
    read: async (_project: string, id: string) => [...rows.values()].find(row => row.key === id) ?? null,
  }
  const receiver = createDocumentReceiver(repository, storage, {
    id: () => `document-${++nextId}`, now: () => "2026-10-01T10:00:00.000Z", hash,
  }, registry)
  const request = { idempotencyKey: "request-key" }
  const first = await receiver.receive("project", "note.md", "text/markdown", new Uint8Array([1, 2]), request)
  if (mode === "missing") objects.delete(first.key)
  else objects.set(first.key, new Uint8Array([9, 9]))

  await expect(receiver.receive("project", "note.md", "text/markdown", new Uint8Array([1, 2]), request))
    .rejects.toThrow(/bytes are missing or damaged/)
  expect(storage.write).toHaveBeenCalledTimes(2)
  expect(storage.remove).toHaveBeenCalledWith("project", storage.write.mock.calls[1][1])
  expect(objects.has(first.key)).toBe(mode === "damaged")
})
