import { afterEach, expect, it } from "vitest"
import { accountFixture } from "./testing"
import type { ProjectPermission } from "@/modules/identity/domain"

const closers: (() => Promise<void>)[] = []
afterEach(async () => { for (const close of closers.splice(0)) await close() })

async function fixture(permissions: ProjectPermission[] = ["project.read", "memory.read", "wiki.read", "wiki.write"]) {
  const f = await accountFixture()
  closers.push(f.close)
  await f.bootstrap()
  const admin = await f.login()
  const project = (await f.json("/projects", "POST", { name: "CLI proposals" }, admin.cookie)).data
  const root = `/projects/${project.id}`
  for (const memoryId of ["a", "b", "c"]) {
    const created = await f.json(root + "/memories", "POST", { memoryId, input: { title: memoryId, content: memoryId, category: "fact", domainIds: [], relatedIds: [] }, expectedVersion: null }, admin.cookie)
    expect(created.response.status).toBe(200)
  }
  const agent = await f.createAccount(admin.cookie, "cli-proposer", "agent")
  const state = await f.authentication.catalog.read()
  await f.authentication.catalog.saveMembership(state.revision, { accountId: agent.id, projectId: project.id, permissionRole: "editor", workRoleIds: [] })
  const issued = await f.json("/auth/tokens", "POST", { accountId: agent.id, projectId: project.id, label: "CLI fixture", workRoleId: null, permissions, expiresAt: "2026-11-02T00:00:00.000Z" }, admin.cookie)
  expect(issued.response.status).toBeLessThan(400)
  const headers = { Authorization: `Bearer ${issued.data.secret}` }
  return { post: (body: Record<string, unknown>) => f.json(root + "/cli", "POST", body, "", headers) }
}

const body = {
  tool: "proposal.submit",
  target: { kind: "memory", memoryId: null, payload: { title: "T", content: "C" } },
  idempotencyKey: "k1",
  evidence: [{ source: "doc", ref: "r1" }],
}

it("submits a pending memory proposal through CLI with status 200", async () => {
  const f = await fixture()
  const result = await f.post(body)
  expect(result.response.status).toBe(200)
  expect(result.data).toMatchObject({ created: true, proposal: { status: "pending", target: body.target, evidence: body.evidence } })
})

it("keeps proposed memory invisible in summaries before approval", async () => {
  const f = await fixture()
  expect((await f.post(body)).response.status).toBe(200)
  const result = await f.post({ tool: "memory.summaries" })
  expect(result.response.status).toBe(200)
  expect(result.data.items).toHaveLength(3)
  expect(result.data.items).not.toEqual(expect.arrayContaining([expect.objectContaining({ title: "T" })]))
})

it("returns the same proposal for an identical idempotent submission", async () => {
  const f = await fixture()
  const first = await f.post(body)
  expect(first.response.status).toBe(200)
  const result = await f.post(body)
  expect(result.response.status).toBe(200)
  expect(result.data).toMatchObject({ created: false, proposal: { id: first.data.proposal.id } })
})

it("rejects changed evidence for the same idempotency key", async () => {
  const f = await fixture()
  expect((await f.post(body)).response.status).toBe(200)
  const result = await f.post({ ...body, evidence: [{ source: "doc", ref: "r2" }] })
  expect(result.response.status).toBe(409)
  expect(result.error.code).toBe("conflict")
})

it("requires nonempty proposal evidence", async () => {
  const f = await fixture()
  const result = await f.post({ ...body, evidence: [] })
  expect(result.response.status).toBe(400)
  expect(result.error.code).toBe("invalid_argument")
})

it("rejects unexpected proposal submission fields", async () => {
  const f = await fixture()
  const result = await f.post({ ...body, foo: true })
  expect(result.response.status).toBe(400)
  expect(result.error.code).toBe("invalid_argument")
})

it("lists the submitted proposal through CLI", async () => {
  const f = await fixture()
  const first = await f.post(body)
  expect(first.response.status).toBe(200)
  const result = await f.post({ tool: "proposal.list" })
  expect(result.response.status).toBe(200)
  expect(result.data).toEqual(expect.arrayContaining([expect.objectContaining({ id: first.data.proposal.id, status: "pending" })]))
})

it("requires wiki.write to submit a proposal", async () => {
  const f = await fixture(["project.read", "memory.read", "wiki.read"])
  const result = await f.post(body)
  expect(result.response.status).toBe(403)
  expect(result.error.code).toBe("forbidden")
})
