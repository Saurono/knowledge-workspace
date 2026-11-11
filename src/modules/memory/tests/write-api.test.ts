import { expect, it } from "vitest"
import { createMemoryService, createMemoryIdempotencyStore, type MemoryRepository } from "../application"
import { createMemoryRecord, type MemoryRecord } from "../domain/model"
const record = () => createMemoryRecord({ id: "a", title: "A", content: "Content", category: "", domainIds: [], relatedIds: [], createdAt: "2026-11-10", updatedAt: "2026-11-10" })
function setup(injected = false) {
  let records: MemoryRecord[] = []
  const repository: MemoryRepository = {
    read: async () => structuredClone(records),
    update: async (_, change) => { records = change(structuredClone(records)); return structuredClone(records) },
  }
  return createMemoryService(repository, injected ? createMemoryIdempotencyStore() : undefined)
}
it("checks creation and update versions without modifying conflicts", async () => {
  const service = setup()
  await expect(service.write("p", record(), { expectedVersion: 1 })).rejects.toMatchObject({ code: "invalid_argument" })
  const first = await service.write("p", record(), { expectedVersion: null })
  const input = { ...first.record, content: "Changed" }
  await expect(service.write("p", input, { expectedVersion: 0 })).rejects.toMatchObject({ code: "version_conflict", currentVersion: 1 })
  expect(await service.list("p")).toEqual([first.record])
  expect((await service.write("p", input, { expectedVersion: 1 })).record.version).toBe(2)
})
for (const injected of [false, true]) it(`replays only successful writes (injected=${injected})`, async () => {
  const service = setup(injected)
  const input = record()
  const first = await service.write("p", input, { expectedVersion: null, idempotencyKey: "key" })
  expect(await service.write("p", input, { expectedVersion: null, idempotencyKey: "key" })).toEqual({ ...first, applied: false, replayed: true })
  await expect(service.write("p", { ...input, content: "Other" }, { expectedVersion: null, idempotencyKey: "key" })).rejects.toMatchObject({ code: "idempotency_conflict", replay: first })
  await expect(service.write("p", input, { expectedVersion: 0, idempotencyKey: "retry" })).rejects.toMatchObject({ code: "version_conflict" })
  expect(await service.write("p", input, { expectedVersion: 1, idempotencyKey: "retry" })).toMatchObject({ applied: true, replayed: false })
})
it("allows exactly one concurrent write at the same version", async () => {
  const service = setup()
  const first = await service.write("p", record(), { expectedVersion: null })
  const outcomes = await Promise.allSettled(["One", "Two"].map(content => service.write("p", { ...first.record, content }, { expectedVersion: 1 })))
  expect(outcomes.filter(item => item.status === "fulfilled")).toHaveLength(1)
  const rejected = outcomes.filter(item => item.status === "rejected")
  expect(rejected).toHaveLength(1)
  expect(rejected[0]).toMatchObject({ reason: { code: "version_conflict", currentVersion: 2 } })
})
