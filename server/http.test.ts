import { afterEach, describe, expect, it } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AddressInfo } from "node:net"
import { createAccountAuthentication } from "./auth-http"
import { createServiceHttp } from "./http"
import { SqliteRepository } from "./repository"
import { createSharedClient } from "@/modules/service-api/application"
import { createMemoryRecord } from "@/modules/memory/domain"
const token = "integration-fixture-service-key-only"
const cleanups: Array<() => Promise<void>> = []
async function fixture(maxJsonBytes?: number) {
  const directory = mkdtempSync(join(tmpdir(), "kw-http-"))
  const uploadBytes = new Map<string, Uint8Array>()
  const uploads = {
    write: async (projectId: string, id: string, bytes: Uint8Array) => { uploadBytes.set(`${projectId}/${id}`, bytes.slice()) },
    read: async (projectId: string, id: string) => {
      const bytes = uploadBytes.get(`${projectId}/${id}`)
      if (!bytes) throw new Error("missing upload")
      return bytes.slice()
    },
    remove: async (projectId: string, id: string) => { uploadBytes.delete(`${projectId}/${id}`) },
  }
  let repository = new SqliteRepository(directory), authentication = createAccountAuthentication(repository, token), http = createServiceHttp({ repository, authentication, maxJsonBytes, uploads })
  await authentication.auth.bootstrap({ handle: "admin", displayName: "Admin", password: "Fixture-password-1234" })
  const cookie = `kw_session=${(await authentication.auth.login("admin", "Fixture-password-1234", "fixture")).secret}`
  let url = ""
  const listen = async () => { await new Promise<void>(resolve => http.server.listen(0, "127.0.0.1", resolve)); url = `http://127.0.0.1:${(http.server.address() as AddressInfo).port}` }
  const close = async () => { http.server.closeAllConnections(); await new Promise<void>((resolve, reject) => http.server.close(error => error ? reject(error) : resolve())); repository.close() }
  await listen()
  cleanups.push(async () => { await close(); rmSync(directory, { recursive: true, force: true }) })
  const request = (path: string, init: RequestInit = {}) => fetch(url + "/api/v1" + path, { ...init, headers: { Cookie: cookie, "X-KW-CSRF": "1", "Content-Type": "application/json", ...init.headers } })
  const create = async (name = "Project") => (await (await request("/projects", { method: "POST", body: JSON.stringify({ name }) })).json()).data as { id: string; name: string }
  return { request, create, anonymous: (path: string) => fetch(url + "/api/v1" + path), restart: async () => { await close(); repository = new SqliteRepository(directory); authentication = createAccountAuthentication(repository, token); http = createServiceHttp({ repository, authentication, maxJsonBytes, uploads }); await listen() }, client: createSharedClient({ request: (method, path, options) => fetch(url + path, { method, headers: { Cookie: cookie, "X-KW-CSRF": "1", "Content-Type": "application/json", ...options.headers }, ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }), signal: options.signal }) }) }
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
  it("uploads only a received checkpoint and serves its protected read-only summary with the resource ETag", async () => {
    const f = await fixture(), project = await f.create()
    const upload = await f.request(`/projects/${project.id}/documents`, { method: "POST", headers: { "Content-Type": "text/markdown", "X-File-Name": "note.md" }, body: new Uint8Array([97, 98, 99]) })
    expect(upload.status).toBe(201)
    const uploaded = (await upload.json()).data, path = `/projects/${project.id}/documents/${uploaded.data.id}/ingestion`
    const response = await f.request(path), value = await response.json()
    const viaSdk = await f.client.documentIngestion(project.id, uploaded.data.id)
    expect(viaSdk.data).toEqual(value.data)
    const receiptResponse = await f.request(`/projects/${project.id}/documents/${uploaded.data.id}/receipt`)
    const receipt = await receiptResponse.json()
    const receiptSdk = await f.client.documentReceipt(project.id, uploaded.data.id)
    expect(receipt.data).toMatchObject({ schemaVersion: 2, projectId: project.id, sourceId: uploaded.data.sourceId, sourceRevision: uploaded.data.sha256, summary: { status: "received" }, delivery: "pending" })
    expect(receiptSdk.data).toEqual(receipt.data)
    expect(receiptResponse.headers.get("etag")).toBe('"v1"')
    expect(response.headers.get("etag")).toBe('"v1"')
    expect(value.data.summary).toMatchObject({ status: "received", contentReady: false, knowledgeReady: false, feedbackDelivered: false, complete: false })
    expect(value.data.checkpoint.stages).toMatchObject({ receive: { status: "succeeded" }, parse: { status: "pending" }, compile: { status: "pending" }, index: { status: "pending" }, feedback: { status: "skipped" } })
    expect((await f.anonymous(path)).status).toBe(401)
    expect((await f.anonymous(`/projects/${project.id}/documents/${uploaded.data.id}/receipt`)).status).toBe(401)
    expect((await f.request(`/projects/${project.id}/documents/%ZZ/ingestion`)).status).toBe(400)
    await f.restart()
    expect((await (await f.request(path)).json()).data.checkpoint).toEqual(value.data.checkpoint)
  })
  it("replays an idempotent upload across HTTP restart and conflicts when its request binding changes", async () => {
    const f = await fixture(), project = await f.create(), path = `/projects/${project.id}/documents`
    const headers = { "Content-Type": "text/markdown", "X-File-Name": "note.md", "Idempotency-Key": "retry-1" }
    const firstResponse = await f.request(path, { method: "POST", headers, body: new Uint8Array([97, 98, 99]) })
    const first = (await firstResponse.json()).data
    expect(first.data).toMatchObject({ sourceId: expect.any(String), sourceRevision: first.data.sha256, byteSha256: first.data.sha256, revisionKind: "raw-bytes-sha256", parsedTextRevision: null, sourceIngestedAt: null })
    await f.restart()
    const replayResponse = await f.request(path, { method: "POST", headers, body: new Uint8Array([97, 98, 99]) })
    const replay = (await replayResponse.json()).data
    expect(replay.data.id).toBe(first.data.id)
    const documents = await f.request(`/projects/${project.id}/documents`)
    expect(documents.status).toBe(200)
    expect((await documents.json()).data).toHaveLength(1)
    const events = await (await f.request(`/projects/${project.id}/events`)).json()
    expect(events.data.filter((event: { resource: { kind: string } }) => event.resource.kind === "document")).toHaveLength(1)
    const conflict = await f.request(path, { method: "POST", headers, body: new Uint8Array([100, 101, 102]) })
    expect(conflict.status).toBe(409)
  })
  it("keeps a project source identity across byte revisions and deduplicates one revision across request keys", async () => {
    const f = await fixture(), project = await f.create(), path = `/projects/${project.id}/documents`
    const first = await f.request(path, { method: "POST", headers: { "Content-Type": "text/markdown", "X-File-Name": "note.md", "Idempotency-Key": "source-create", "X-Source-Id": "stable-source", "X-Create-Source": "1" }, body: new Uint8Array([97]) })
    expect(first.status).toBe(201)
    const firstData = (await first.json()).data.data
    const revision = await f.request(path, { method: "POST", headers: { "Content-Type": "text/markdown", "X-File-Name": "note.md", "Idempotency-Key": "source-revision", "X-Source-Id": "stable-source" }, body: new Uint8Array([98]) })
    expect(revision.status).toBe(201)
    const next = (await revision.json()).data.data
    expect(next.sourceId).toBe(firstData.sourceId)
    expect(next.id).not.toBe(firstData.id)
    const duplicate = await f.request(path, { method: "POST", headers: { "Content-Type": "text/markdown", "X-File-Name": "note.md", "Idempotency-Key": "alternate-key", "X-Source-Id": "stable-source" }, body: new Uint8Array([98]) })
    expect((await duplicate.json()).data.data.id).toBe(next.id)
    const mismatch = await f.request(path, { method: "POST", headers: { "Content-Type": "text/plain", "X-File-Name": "other.md", "Idempotency-Key": "source-revision", "X-Source-Id": "stable-source" }, body: new Uint8Array([99]) })
    expect(mismatch.status).toBe(409)
  })
  it("validates workspace references and refuses stale updates through the shared SDK", async () => {
    const f = await fixture(), project = await f.create(), initial = (await f.client.workspace(project.id)).data
    const value = { ...initial.data, domains: [{ id: "d", name: "Domain" }], memories: [createMemoryRecord({ id: "m", title: "Memory", content: "Content", category: "fact", relatedIds: [], domainIds: ["d"], createdAt: "time", updatedAt: "time" })] }
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
  it("filters shared Wiki lists and keyword evidence with ANY/ALL/unclassified and filter-scoped cursors", async () => {
    const f = await fixture(), project = await f.create()
    const pages = [
      ["wiki/a.md", "domain alpha common token"],
      ["wiki/b.md", "domain beta common token"],
      ["wiki/c.md", "domain alpha beta common token"],
      ["wiki/d.md", "unclassified common token"],
    ] as const
    for (const [path, content] of pages) await f.client.saveWiki(project.id, path, content, null)
    const workspace = (await f.client.workspace(project.id)).data
    const assigned = {
      ...workspace.data,
      domains: [{ id: "alpha", name: "Alpha" }, { id: "beta", name: "Beta" }],
      resourceDomains: {
        "wiki/a.md": ["alpha"], "wiki/b.md": ["beta"], "wiki/c.md": ["alpha", "beta"],
      },
    }
    await f.client.saveWorkspace(project.id, assigned, workspace.revision)
    const staleWrite = await f.request(`/projects/${project.id}/workspace`, { method: "PUT", headers: { "If-Match": `"v${workspace.revision}"` }, body: JSON.stringify(assigned) })
    expect(staleWrite.status).toBe(409)
    expect((await f.client.workspace(project.id)).data.data.resourceDomains).toMatchObject({ "wiki/a.md": ["alpha"], "wiki/c.md": ["alpha", "beta"] })

    const first = await f.client.wiki(project.id, "?limit=1", { domainIds: ["beta", "alpha", "alpha"], match: "any", unclassified: false })
    expect(first.data.map(value => value.key)).toHaveLength(1)
    const cursor = first.meta.page?.nextCursor
    expect(cursor).toBeTruthy()
    const seen = new Set(first.data.map(value => value.key))
    let next = cursor
    while (next) {
      const page = await f.client.wiki(project.id, `?limit=1&cursor=${encodeURIComponent(next)}`, { domainIds: ["alpha", "beta"], match: "any", unclassified: false })
      for (const value of page.data) seen.add(value.key)
      next = page.meta.page?.nextCursor ?? null
    }
    expect([...seen].sort()).toEqual(["wiki/a.md", "wiki/b.md", "wiki/c.md"])

    const all = await f.client.wiki(project.id, "", { domainIds: ["alpha", "beta"], match: "all", unclassified: false })
    expect(all.data.map(value => value.key)).toEqual(["wiki/c.md"])
    const unclassified = await f.client.wiki(project.id, "", { domainIds: [], match: "any", unclassified: true })
    expect(unclassified.data.map(value => value.key)).toEqual(["wiki/d.md"])
    const changedFilterCursor = await f.request(`/projects/${project.id}/wiki?limit=1&domainId=beta&cursor=${encodeURIComponent(cursor!)}`)
    expect(changedFilterCursor.status).toBe(400)

    for (const query of ["domainId=", "domainId=missing", "domainMatch=maybe", "domainMatch=any&domainMatch=all", "unclassified=2", "unclassified=1&domainId=alpha", "unclassified=0&unclassified=1"])
      expect((await f.request(`/projects/${project.id}/wiki?${query}`)).status).toBe(400)

    const search = await f.request(`/projects/${project.id}/retrieval`, { method: "POST", body: JSON.stringify({ query: "common token", domainFilter: { domainIds: ["alpha"], match: "any", unclassified: false } }) })
    expect((await search.json()).data.results.map((item: { path: string }) => item.path).sort()).toEqual(["wiki/a.md", "wiki/c.md"])
    const tool = await f.request(`/projects/${project.id}/mcp`, { method: "POST", body: JSON.stringify({ tool: "wiki.list", domainFilter: { domainIds: ["beta"], match: "any", unclassified: false } }) })
    expect((await tool.json()).data.items.map((item: { key: string }) => item.key).sort()).toEqual(["wiki/b.md", "wiki/c.md"])

    const latest = (await f.client.workspace(project.id)).data
    const deletedDomain = { ...latest.data, domains: [{ id: "beta", name: "Beta" }], resourceDomains: { "wiki/a.md": [], "wiki/b.md": ["beta"], "wiki/c.md": ["beta"] } }
    await f.client.saveWorkspace(project.id, deletedDomain, latest.revision)
    expect((await f.client.workspace(project.id)).data.data.resourceDomains["wiki/a.md"]).toEqual([])
  })
  it("shares a document classification across byte revisions and validates real targets without changing resource revisions", async () => {
    const f = await fixture(), project = await f.create(), uploadPath = `/projects/${project.id}/documents`
    const upload = async (body: number, key: string, create = false) => f.request(uploadPath, { method: "POST", headers: { "Content-Type": "text/plain", "X-File-Name": "source.txt", "Idempotency-Key": key, "X-Source-Id": "stable-source", ...(create ? { "X-Create-Source": "1" } : {}) }, body: new Uint8Array([body]) })
    const first = await upload(97, "first-revision", true), firstRecord = (await first.json()).data
    const second = await upload(98, "second-revision"), secondRecord = (await second.json()).data
    const workspace = (await f.client.workspace(project.id)).data
    const classified = { ...workspace.data, domains: [{ id: "research", name: "Research" }], resourceDomains: { "raw/documents/stable-source": ["research"] } }
    await f.client.saveWorkspace(project.id, classified, workspace.revision)
    const listed = await f.client.documents(project.id, "", { domainIds: ["research"], match: "any", unclassified: false })
    expect(listed.data.map(item => item.key).sort()).toEqual([firstRecord.data.id, secondRecord.data.id].sort())

    const currentWorkspace = (await f.client.workspace(project.id)).data
    const absentTarget = { ...currentWorkspace.data, resourceDomains: { ...currentWorkspace.data.resourceDomains, "raw/documents/not-uploaded": [] } }
    const rejected = await f.request(`/projects/${project.id}/workspace`, { method: "PUT", headers: { "If-Match": `"v${currentWorkspace.revision}"` }, body: JSON.stringify(absentTarget) })
    expect(rejected.status).toBe(404)
    expect((await f.client.workspace(project.id)).data.revision).toBe(currentWorkspace.revision)

    const otherProject = await f.create("Other project")
    const foreignUpload = await f.request(`/projects/${otherProject.id}/documents`, { method: "POST", headers: { "Content-Type": "text/plain", "X-File-Name": "foreign.txt", "Idempotency-Key": "foreign-source", "X-Source-Id": "foreign-source-id", "X-Create-Source": "1" }, body: new Uint8Array([99]) })
    expect(foreignUpload.status).toBe(201)
    const afterForeign = (await f.client.workspace(project.id)).data
    const crossProject = { ...afterForeign.data, resourceDomains: { ...afterForeign.data.resourceDomains, "raw/documents/foreign-source-id": ["research"] } }
    const crossProjectResponse = await f.request(`/projects/${project.id}/workspace`, { method: "PUT", headers: { "If-Match": `"v${afterForeign.revision}"` }, body: JSON.stringify(crossProject) })
    expect(crossProjectResponse.status).toBe(404)

    const search = await f.request(`/projects/${project.id}/wiki?domainId=research`)
    expect(search.status).toBe(200)
    expect(secondRecord.data.id).not.toBe(firstRecord.data.id)
  })
})
