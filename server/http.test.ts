import { afterEach, describe, expect, it } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AddressInfo } from "node:net"
import { createServiceHttp } from "./http"
import { SqliteRepository } from "./repository"
import { createSharedClient } from "@/modules/service-api/application"
const token = "integration-fixture-service-key-only"
const cleanups: Array<() => Promise<void>> = []
async function fixture(maxJsonBytes?: number) {
  const directory = mkdtempSync(join(tmpdir(), "kw-http-"))
  let repository = new SqliteRepository(directory), http = createServiceHttp({ repository, token, maxJsonBytes })
  let url = ""
  const listen = async () => { await new Promise<void>(resolve => http.server.listen(0, "127.0.0.1", resolve)); url = `http://127.0.0.1:${(http.server.address() as AddressInfo).port}` }
  const close = async () => { http.server.closeAllConnections(); await new Promise<void>((resolve, reject) => http.server.close(error => error ? reject(error) : resolve())); repository.close() }
  await listen()
  cleanups.push(async () => { await close(); rmSync(directory, { recursive: true, force: true }) })
  const request = (path: string, init: RequestInit = {}) => fetch(url + "/api/v1" + path, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers } })
  const create = async (name = "Project") => (await (await request("/projects", { method: "POST", body: JSON.stringify({ name }) })).json()).data as { id: string; name: string }
  return { request, create, anonymous: (path: string) => fetch(url + "/api/v1" + path), restart: async () => { await close(); repository = new SqliteRepository(directory); http = createServiceHttp({ repository, token, maxJsonBytes }); await listen() }, client: createSharedClient({ request: (method, path, options) => fetch(url + path, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...options.headers }, ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }), signal: options.signal }) }) }
}
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup() })
describe("shared service HTTP and SQLite", () => {
  it("requires credentials for data and returns structured errors without echoing credentials", async () => {
    const f = await fixture()
    expect((await f.anonymous("/health")).status).toBe(200)
    const response = await f.anonymous("/projects"), text = await response.text()
    expect(response.status).toBe(401); expect(JSON.parse(text).error).toMatchObject({ code: "unauthenticated", requestId: expect.any(String) }); expect(text).not.toContain(token)
    const invalid = await f.request("/projects", { method: "POST", body: "null" }); expect(invalid.status).toBe(400)
  })
  it("paginates without duplicate projects and rejects cursor scope reuse", async () => {
    const f = await fixture(); const ids = await Promise.all([f.create("One"), f.create("Two"), f.create("Three")])
    const first = await (await f.request("/projects?limit=2")).json(), cursor = first.meta.page.nextCursor
    const second = await (await f.request("/projects?limit=2&cursor=" + encodeURIComponent(cursor))).json()
    expect(new Set([...first.data, ...second.data].map((project: { id: string }) => project.id)).size).toBe(3)
    expect(second.meta.page.nextCursor).toBeNull()
    expect((await f.request(`/projects/${ids[0].id}/wiki?cursor=${encodeURIComponent(cursor)}`)).status).toBe(400)
  })
  it("enforces conditional writes, retains tombstone versions and commits events with resources", async () => {
    const f = await fixture(), project = await f.create(), path = `/projects/${project.id}/wiki/page?path=wiki/concepts/a.md`
    expect((await f.request(path, { method: "PUT", body: JSON.stringify({ content: "missing precondition" }) })).status).toBe(428)
    const first = await f.request(path, { method: "PUT", headers: { "If-None-Match": "*" }, body: JSON.stringify({ content: "base" }) })
    expect(first.headers.get("etag")).toBe('"v1"')
    const results = await Promise.all(["first", "second"].map(content => f.request(path, { method: "PUT", headers: { "If-Match": '"v1"' }, body: JSON.stringify({ content }) })))
    expect(results.map(response => response.status).sort()).toEqual([200, 409])
    await f.request(path, { method: "DELETE", headers: { "If-Match": '"v2"' } })
    const recreated = await f.request(path, { method: "PUT", headers: { "If-None-Match": "*" }, body: JSON.stringify({ content: "new incarnation" }) })
    expect((await recreated.json()).data.revision).toBe(4)
    expect((await f.request(path, { method: "PUT", headers: { "If-Match": '"v2"' }, body: JSON.stringify({ content: "stale" }) })).status).toBe(409)
    const events = await (await f.request(`/projects/${project.id}/events`)).json()
    expect(events.data.map((event: { type: string }) => event.type)).toEqual(["project.created", "resource.updated", "resource.updated", "resource.deleted", "resource.updated"])
  })
  it("persists resources, revision and event cursors after closing and reopening the database", async () => {
    const f = await fixture(), project = await f.create()
    await f.client.saveWiki(project.id, "wiki/a.md", "persistent content", null)
    const before = await f.client.events(project.id)
    await f.restart()
    expect((await f.client.readWiki(project.id, "wiki/a.md")).data).toMatchObject({ revision: 1, data: { content: "persistent content" } })
    expect((await f.client.events(project.id)).data).toEqual(before.data)
  })
  it("validates workspace references and refuses stale updates through the shared SDK", async () => {
    const f = await fixture(), project = await f.create(), initial = (await f.client.workspace(project.id)).data
    const value = { ...initial.data, domains: [{ id: "d", name: "Domain" }], memories: [{ id: "m", title: "Memory", content: "Content", category: "fact", relatedIds: [], domainIds: ["d"], createdAt: "time", updatedAt: "time" }] }
    await f.client.saveWorkspace(project.id, value, initial.revision)
    await expect(f.client.saveWorkspace(project.id, value, initial.revision)).rejects.toMatchObject({ code: "conflict", status: 409 })
    await expect(f.client.saveWorkspace(project.id, { ...value, domains: [] }, 2)).rejects.toMatchObject({ code: "invalid_argument" })
  })
  it("rejects unsafe Wiki paths and oversized bodies without creating resources", async () => {
    const f = await fixture(512), project = await f.create()
    const root = `/projects/${project.id}/wiki/page?path=`
    expect((await f.request(root + encodeURIComponent("wiki/../outside.md"))).status).toBe(400)
    expect((await f.request(root + "wiki/a.md", { method: "PUT", headers: { "If-None-Match": "*" }, body: JSON.stringify({ content: "x".repeat(1024) }) })).status).toBe(413)
    expect((await f.client.wiki(project.id)).data).toEqual([])
    expect((await f.client.events(project.id)).data).toHaveLength(1)
  })
})
