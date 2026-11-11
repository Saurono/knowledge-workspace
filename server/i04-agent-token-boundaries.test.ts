import { afterEach, expect, it } from "vitest"
import { accountFixture } from "./testing"
import type { ProjectPermission } from "@/modules/identity/domain"
import { createMemoryRecord } from "@/modules/memory/domain"

const closers: (() => Promise<void>)[] = []
afterEach(async () => { for (const close of closers.splice(0)) await close() })

async function fixture(permissions: ProjectPermission[] = ["project.read", "memory.read"]) {
  const f = await accountFixture()
  closers.push(f.close)
  await f.bootstrap()
  const admin = await f.login()
  const project = (await f.json("/projects", "POST", { name: "I04 boundaries" }, admin.cookie)).data
  const root = `/projects/${project.id}`
  const agent = await f.createAccount(admin.cookie, "i04-agent", "agent")
  const state = await f.authentication.catalog.read()
  await f.authentication.catalog.saveMembership(state.revision, { accountId: agent.id, projectId: project.id, permissionRole: "editor", workRoleIds: [] })
  const issue = async (workRoleId: string | null = null) => {
    const result = await f.json("/auth/tokens", "POST", { accountId: agent.id, projectId: project.id, label: "I04", workRoleId, permissions, expiresAt: "2026-11-02T00:00:00.000Z" }, admin.cookie)
    expect(result.response.status).toBeLessThan(400)
    return result.data
  }
  const issued = await issue()
  const headers = { Authorization: `Bearer ${issued.secret}` }
  const cli = (tool = "memory.summaries", extra: Record<string, string> = {}) => f.json(root + "/cli", "POST", { tool }, "", { ...headers, ...extra })
  const revoke = async () => {
    const response = await f.request(`/auth/tokens/${issued.token.id}`, "DELETE", undefined, admin.cookie)
    expect(response.ok).toBe(true)
  }
  return { ...f, admin, project, root, agent, issue, issued, headers, cli, revoke }
}

it("immediately rejects shared CLI with 401 after agent token revocation", async () => {
  const f = await fixture()
  expect((await f.cli()).response.status).toBe(200)
  await f.revoke()
  expect((await f.cli()).response.status).toBe(401)
})

it("accepts an unexpired agent token then rejects it with 401 after clock advancement", async () => {
  const f = await fixture()
  expect((await f.cli()).response.status).toBe(200)
  f.clock("2026-11-03T00:00:00.000Z")
  expect((await f.cli()).response.status).toBe(401)
})

it("returns 403 forbidden for missing memory and proposal-write permissions, while proposal.list returns 200", async () => {
  const f = await fixture(["project.read", "wiki.read"])
  const summaries = await f.cli()
  expect(summaries.response.status).toBe(403)
  expect(summaries.error.code).toBe("forbidden")
  const submission = await f.json(f.root + "/cli", "POST", { tool: "proposal.submit", target: { kind: "memory", memoryId: null, payload: { title: "T", content: "C" } }, idempotencyKey: "i04", evidence: [{ source: "doc", ref: "r1" }] }, "", f.headers)
  expect(submission.response.status).toBe(403)
  expect(submission.error.code).toBe("forbidden")
  expect((await f.cli("proposal.list")).response.status).toBe(200)
})

it("requires selected context for an unbound token; a role-bound token defaults to its scoped role by design", async () => {
  const f = await fixture(["project.read", "memory.read", "memory.write"])
  let state = await f.authentication.catalog.read()
  state = await f.authentication.catalog.saveWorkRole(state.revision, { projectId: f.project.id, name: "I04 role", permissionRole: "editor", permissions: ["project.read", "memory.read", "memory.write"] })
  const role = state.catalog.workRoles.find(item => item.projectId === f.project.id && item.name === "I04 role")!
  await f.authentication.catalog.saveMembership(state.revision, { accountId: f.agent.id, projectId: f.project.id, permissionRole: "editor", workRoleIds: [role.id] })
  const selected = await f.json(f.root + "/contexts", "POST", { workRoleId: role.id }, "", f.headers)
  expect(selected.response.status).toBeLessThan(400)
  const headers = { ...f.headers, "X-KW-Context": selected.data.id }
  const base = await f.json(f.root + "/workspace", "GET", undefined, "", headers)
  expect(base.response.status).toBe(200)
  const memory = createMemoryRecord({ id: "i04-role-memory", title: "I04-ROLE-SECRET", content: "I04-ROLE-SECRET", category: "fact", domainIds: [], relatedIds: [], createdAt: "time", updatedAt: "time", access: { visibility: "role", ownerId: f.agent.id, workRoleIds: [role.id] } })
  const written = await f.json(f.root + "/workspace", "PUT", { ...base.data.data, memories: [...base.data.data.memories, memory] }, "", { ...headers, "If-Match": `"v${base.data.revision}"` })
  expect(written.response.status).toBe(200)
  const hidden = await f.cli()
  expect(hidden.response.status).toBe(200)
  expect(hidden.data.items).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: memory.id })]))
  const visible = await f.cli("memory.summaries", { "X-KW-Context": selected.data.id })
  expect(visible.response.status).toBe(200)
  expect(visible.data.items).toEqual(expect.arrayContaining([expect.objectContaining({ id: memory.id })]))
  const bound = await f.issue(role.id)
  const defaultRole = await f.json(f.root + "/cli", "POST", { tool: "memory.summaries" }, "", { Authorization: `Bearer ${bound.secret}` })
  expect(defaultRole.response.status).toBe(200)
  expect(defaultRole.data.items).toEqual(expect.arrayContaining([expect.objectContaining({ id: memory.id })]))
})

it("rejects agent token access to another project's shared CLI with 403", async () => {
  const f = await fixture()
  const other = await f.json("/projects", "POST", { name: "Other project" }, f.admin.cookie)
  expect(other.response.status).toBe(201)
  const result = await f.json(`/projects/${other.data.id}/cli`, "POST", { tool: "memory.summaries" }, "", f.headers)
  expect(result.response.status).toBe(403)
})

it("closes an established Bearer event stream within three seconds after token revocation", async () => {
  const f = await fixture(), controller = new AbortController()
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  const timeout = setTimeout(() => controller.abort(), 3000)
  try {
    const response = await fetch(f.origin + "/api/v1" + f.root + "/events/stream", { signal: controller.signal, headers: f.headers })
    expect(response.status).toBe(200)
    reader = response.body!.getReader()
    expect((await reader.read()).done).toBe(false)
    await f.revoke()
    for (;;) { if ((await reader.read()).done) break }
    expect(controller.signal.aborted).toBe(false)
  } finally {
    clearTimeout(timeout)
    controller.abort()
    await reader?.cancel().catch(() => {})
    reader?.releaseLock()
  }
})

it("honestly degrades with 501 unsupported when no execution backend is configured (does not verify cancellation)", async () => {
  const f = await fixture(["project.read", "tasks.manage"])
  const result = await f.json(f.root + "/tasks", "POST", {}, "", f.headers)
  expect(result.response.status).toBe(501)
  expect(result.error).toMatchObject({ code: "unsupported", message: "A shared execution backend is not configured" })
})
