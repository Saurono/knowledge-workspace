import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AccessContext, MemoryGrant } from "@/modules/identity/domain"
import { createAuthorizedRepository } from "@/modules/service-api/application/authorized-repository"
import { createSharedService } from "@/modules/service-api/application/service"
import { SqliteRepository } from "./repository"

const at = "2026-11-10T00:00:00.000Z"
let directory: string, repository: SqliteRepository
let context: AccessContext
const grants: MemoryGrant[] = []
const memory = (id: string, extra: Record<string, unknown> = {}) => ({
  id, title: id, content: "body", category: "fact", status: "active", version: 1,
  createdAt: at, updatedAt: at, source: { kind: "user", actorId: "alice" },
  access: { visibility: "project", ownerId: "alice" }, ...extra,
})
const seed = (memories: ReturnType<typeof memory>[]) => repository.createProject({ id: "p", name: "p", createdAt: at }, { memories })
const authorized = () => createAuthorizedRepository(repository, async () => context, async () => grants, () => at)
const read = () => authorized().memorySummaries("p", { limit: 50, after: null })
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "memory-summaries-auth-"))
  repository = new SqliteRepository(directory)
  context = {
    id: "context", actorKind: "user", entrypoint: "test", actorId: "bob", effectiveAccountId: "bob",
    projectId: "p", workRoleId: null, credential: { channel: "session", id: "session" },
    permissions: ["memory.read"], basis: { membershipId: "membership", catalogRevision: 1, tokenId: null, delegationId: null }, capturedAt: at,
  }
})
afterEach(() => { repository.close(); rmSync(directory, { recursive: true, force: true }) })

it("includes active project memories", async () => {
  await seed([memory("public")])
  expect((await read()).items.map(row => row.id)).toEqual(["public"])
})
it("hides private memories from others and permits only the actual owner", async () => {
  await seed([memory("private", { access: { visibility: "private", ownerId: "alice" } })])
  expect((await read()).items).toEqual([])
  context = { ...context, actorId: "alice" }
  expect((await read()).items).toEqual([])
  context = { ...context, effectiveAccountId: "alice" }
  expect((await read()).items.map(row => row.id)).toEqual(["private"])
})
it("requires a matching work role for role memories", async () => {
  await seed([memory("role", { access: { visibility: "role", ownerId: "alice", workRoleIds: ["editor"] } })])
  context = { ...context, workRoleId: "reader" }
  expect((await read()).items).toEqual([])
  context = { ...context, workRoleId: "editor" }
  expect((await read()).items.map(row => row.id)).toEqual(["role"])
})
it("excludes expired validity even while status remains active", async () => {
  await seed([memory("expired", { validity: { until: "2026-11-09T00:00:00.000Z" } })])
  expect((await read()).items).toEqual([])
})
it("shows candidates only to their creator", async () => {
  await seed([memory("candidate", { status: "candidate" })])
  expect((await read()).items).toEqual([])
  context = { ...context, actorId: "alice", effectiveAccountId: "alice" }
  expect((await read()).items.map(row => row.id)).toEqual(["candidate"])
})
it("fills a page through hidden rows and continues without duplicates", async () => {
  await seed(Array.from({ length: 10 }, (_, i) => memory(`m${i}`, i < 7 ? { access: { visibility: "private", ownerId: "alice" } } : {})))
  const spy = vi.spyOn(repository, "memorySummaries")
  const repo = authorized()
  const first = await repo.memorySummaries("p", { limit: 3, after: null })
  expect(first.items.map(row => row.id)).toEqual(["m7", "m8", "m9"])
  expect(first.nextCursor).toEqual({ updatedAt: at, id: "m9" })
  expect(spy).toHaveBeenCalledTimes(4)
  expect(spy.mock.calls.every(([, options]) => options.limit >= 3 && options.limit <= 200)).toBe(true)
  const next = await repo.memorySummaries("p", { limit: 3, after: first.nextCursor })
  expect(next).toEqual({ items: [], nextCursor: null })
  expect(new Set([...first.items, ...next.items].map(row => row.id)).size).toBe(3)
})
it("strips authorization projection fields from returned summaries", async () => {
  await seed([memory("public", { validity: { until: "2027-01-01T00:00:00.000Z" } })])
  expect(Object.keys((await read()).items[0]).sort()).toEqual(["id", "title", "status", "version", "updatedAt", "owner", "category"].sort())
})

it("validates service limits and cursors and encodes continuation cursors", async () => {
  await seed([memory("a"), memory("b")])
  const service = createSharedService(authorized(), { id: () => "id", now: () => at })
  expect((await service.readMemorySummaries("p")).items).toHaveLength(2)
  for (const limit of ["0", "201", "1.5", "no", " "]) {
    await expect(service.readMemorySummaries("p", limit)).rejects.toMatchObject({ code: "invalid_argument", message: "Invalid limit" })
  }
  for (const cursor of ["bad|a", at, `${at}|a|extra`]) {
    await expect(service.readMemorySummaries("p", "1", cursor)).rejects.toMatchObject({ code: "invalid_argument" })
  }
  const first = await service.readMemorySummaries("p", "1")
  expect(first.nextCursor).toBe(`${at}|a`)
  expect((await service.readMemorySummaries("p", "1", first.nextCursor)).items.map(row => row.id)).toEqual(["b"])
  context = { ...context, projectId: "missing" }
  await expect(service.readMemorySummaries("missing")).rejects.toMatchObject({ code: "not_found" })
})
