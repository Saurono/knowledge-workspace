import { expect, it, vi } from "vitest"
import { createDocumentReceiver } from "./uploads"
import type { SharedRepository } from "./ports"
it("removes the stored binary if publishing its metadata fails and preserves the original failure", async () => {
  const failure = new Error("database unavailable"), write = vi.fn(async () => {}), remove = vi.fn(async () => { throw new Error("cleanup also failed") })
  const repository = { project: async () => ({ id: "project", name: "Project", createdAt: "time" }), save: vi.fn(async () => { throw failure }) } as unknown as SharedRepository
  const receiver = createDocumentReceiver(repository, { write, remove, read: vi.fn() }, { id: () => "document", now: () => "2026-10-01T10:00:00.000Z", hash: () => "hash" })
  await expect(receiver.receive("project", "note.md", "text/markdown", new Uint8Array([1, 2]))).rejects.toBe(failure)
  expect(write).toHaveBeenCalledOnce(); expect(remove).toHaveBeenCalledWith("project", "document")
})
