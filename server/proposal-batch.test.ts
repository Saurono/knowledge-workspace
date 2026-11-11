import { afterEach, expect, it } from "vitest"
import { accountFixture } from "./testing"

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanup.splice(0)) await close() })
async function fixture(conflict = false) {
  const f = await accountFixture(); cleanup.push(f.close)
  await f.bootstrap()
  const { cookie } = await f.login()
  const project = await f.json("/projects", "POST", { name: "Batch" }, cookie)
  const base = `/projects/${project.data.id}`
  const call = (path: string, method = "GET", body?: unknown) => f.json(base + path, method, body, cookie)
  const ids: string[] = []
  for (let i = 0; i < 3; i++) {
    const result = await call("/proposals", "POST", { idempotencyKey: `wiki-${i}`, evidence: [{ source: "test", ref: "source" }], target: { kind: "wiki", path: `wiki/page-${i}.md`, content: `page ${i}`, expectedRevision: conflict && i === 1 ? 99 : null } })
    ids.push(result.data.proposal.id)
  }
  return { call, ids }
}
it("dry-run leaves all three wiki proposals and pages untouched", async () => {
  const { call, ids } = await fixture()
  const result = await call("/proposals/approve-batch", "POST", { dryRun: true })
  expect(result.data).toEqual({ eligible: expect.arrayContaining(ids), approved: [], failed: [] })
  expect(result.data.eligible).toHaveLength(3)
  for (let i = 0; i < 3; i++) expect((await call(`/wiki/page?path=wiki/page-${i}.md`)).response.status).toBe(404)
  expect((await call("/proposals")).data.every((p: { status: string }) => p.status === "pending")).toBe(true)
})
it("approves all three and makes pages readable", async () => {
  const { call, ids } = await fixture()
  const result = await call("/proposals/approve-batch", "POST", { dryRun: false })
  expect(result.data.approved.sort()).toEqual(ids.sort())
  for (let i = 0; i < 3; i++) expect((await call(`/wiki/page?path=wiki/page-${i}.md`)).response.status).toBe(200)
})
it("retains a conflicting proposal pending while approving the others", async () => {
  const { call, ids } = await fixture(true)
  const result = await call("/proposals/approve-batch", "POST", {})
  expect(result.data.failed).toEqual([{ id: ids[1], code: "conflict" }])
  expect(result.data.approved.sort()).toEqual([ids[0], ids[2]].sort())
  expect((await call("/proposals")).data.find((p: { id: string }) => p.id === ids[1]).status).toBe("pending")
})
it("filters mixed proposals by memory kind", async () => {
  const { call } = await fixture()
  const memory = await call("/proposals", "POST", { idempotencyKey: "memory", evidence: [{ source: "test", ref: "source" }], target: { kind: "memory", memoryId: null, payload: { title: "Memory", content: "remember", category: "general" } } })
  const result = await call("/proposals/approve-batch", "POST", { kind: "memory" })
  expect(result.data).toEqual({ eligible: [memory.data.proposal.id], approved: [memory.data.proposal.id], failed: [] })
  expect((await call("/proposals")).data.filter((p: { status: string }) => p.status === "pending")).toHaveLength(3)
})
it("reports decided and absent ids and rejects empty ids", async () => {
  const { call, ids } = await fixture()
  await call("/proposals/approve-batch", "POST", { ids: [ids[0]] })
  expect((await call("/proposals/approve-batch", "POST", { ids: [ids[0], "missing"] })).data.failed).toEqual([{ id: ids[0], code: "not_pending" }, { id: "missing", code: "not_found" }])
  expect((await call("/proposals/approve-batch", "POST", { ids: [""] })).response.status).toBe(400)
})
