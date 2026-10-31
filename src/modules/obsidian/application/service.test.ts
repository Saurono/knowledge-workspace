import { expect, it, vi } from "vitest"
import { createObsidianService, type ObsidianRecords } from "./service"
import { makeIngestReceipt } from "../domain"
function fixture() {
  const receipt = makeIngestReceipt({ id: "source-revision", taskId: "task", source: { id: "source", originalPath: "/vault/note.md", ingestedAt: "time" }, sourcePath: "/p/raw/note.md", revision: "revision", cacheHit: false, recordedAt: "time", vaultPath: "/vault", wikiResults: [{ path: "wiki/a.md", wikiCreatedAt: "time" }] })
  const records: ObsidianRecords = { vaultPath: "/vault", receipts: { [receipt.id]: receipt } }
  const writeReceipt = vi.fn(async () => {}), saved = vi.fn()
  const service = createObsidianService({ update: async (_project, change) => { if (await change(records)) saved() } }, { isAbsolute: path => path.startsWith("/"), exists: async () => true, writeReceipt })
  return { records, receipt, writeReceipt, saved, service }
}
it("keeps failed delivery pending, retries to a stable independent record and skips already delivered receipts", async () => {
  const f = fixture()
  f.writeReceipt.mockRejectedValueOnce(new Error("vault unavailable"))
  await f.service.deliver("/p", f.receipt.id)
  expect(f.receipt).toMatchObject({ delivery: "pending", error: "Error: vault unavailable" })
  await f.service.deliver("/p", f.receipt.id)
  await f.service.deliver("/p", f.receipt.id)
  expect(f.writeReceipt).toHaveBeenCalledTimes(2)
  expect(f.writeReceipt).toHaveBeenLastCalledWith("/vault", "source-revision.json", expect.objectContaining({ originalPath: "/vault/note.md", sourceRevision: "revision" }))
  expect(f.receipt.delivery).toBe("delivered")
})
it("does not send another vault's note paths after reconnection", async () => {
  const f = fixture()
  await f.service.configure("/p", "/other-vault/")
  await f.service.deliver("/p", f.receipt.id)
  expect(f.records.vaultPath).toBe("/other-vault")
  expect(f.writeReceipt).not.toHaveBeenCalled()
  expect(f.saved).toHaveBeenCalledOnce()
})
