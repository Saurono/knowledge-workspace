import { afterEach, expect, it } from "vitest"
import { mkdir, writeFile, access } from "node:fs/promises"
import { join } from "node:path"
import type { AddressInfo } from "node:net"
import { accountFixture } from "./testing"
import { createServiceHttp } from "./http"
import { DiskUploads } from "./uploads"

const closers: (() => Promise<void>)[] = []
afterEach(async () => { for (const close of closers.splice(0).reverse()) await close() })

async function fixture() {
  const f = await accountFixture()
  closers.push(f.close)
  await f.bootstrap()
  const admin = await f.login()
  const project = await f.json("/projects", "POST", { name: "Orphan uploads" }, admin.cookie)
  expect(project.response.status).toBe(201)
  const projectId: string = project.data.id
  const http = createServiceHttp({ repository: f.repository, authentication: f.authentication, uploads: new DiskUploads(f.directory), dataRoot: f.directory })
  await new Promise<void>(resolve => http.server.listen(0, "127.0.0.1", resolve))
  closers.push(async () => { http.closeStreams(); http.server.closeAllConnections(); await new Promise<void>(resolve => http.server.close(() => resolve())) })
  const origin = `http://127.0.0.1:${(http.server.address() as AddressInfo).port}`
  const request = async (method = "GET", query = "", cookie = admin.cookie) => {
    const response = await fetch(`${origin}/api/v1/projects/${projectId}/orphans${query}`, { method, headers: { Cookie: cookie, "X-KW-CSRF": "1" } })
    const text = await response.text()
    expect(text).not.toContain(f.directory)
    expect(text).not.toContain(JSON.stringify(f.directory).slice(1, -1))
    return { status: response.status, ...JSON.parse(text) }
  }
  const stray = async (id = projectId) => {
    const directory = join(f.directory, "uploads", id, "stray-id")
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, "source.bin"), "orphan bytes", "utf8")
    return directory
  }
  return { f, admin, projectId, request, stray }
}

it("does not classify an uploaded document as an orphan", async () => {
  const { f, admin, projectId, request } = await fixture()
  const upload = await f.json(`/projects/${projectId}/documents`, "POST", "document bytes", admin.cookie, { "x-file-name": "known.txt" })
  expect(upload.response.status).toBe(201)
  expect(await request()).toMatchObject({ status: 200, data: { orphans: [], totalBytes: 0, scannedUploads: 1 } })
})

it("reports exactly one stray upload with its byte count", async () => {
  const { request, stray, projectId } = await fixture()
  await stray()
  const result = await request()
  expect(result.status).toBe(200)
  expect(result.data.orphans).toHaveLength(1)
  expect(result.data.orphans[0]).toMatchObject({ projectId, sourceId: "stray-id" })
  expect(result.data.orphans[0].bytes).toBeGreaterThan(0)
  expect(result.data.totalBytes).toBe(result.data.orphans[0].bytes)
})

it("requires confirm=1 before deletion", async () => {
  const { request, stray } = await fixture()
  const directory = await stray()
  for (const query of ["", "?confirm=0"]) {
    expect(await request("DELETE", query)).toMatchObject({ status: 400, error: { code: "invalid_argument", message: "Deleting orphan uploads requires confirm=1" } })
  }
  await expect(access(directory)).resolves.toBeUndefined()
})

it("deletes confirmed orphans without If-Match and removes their directories", async () => {
  const { request, stray } = await fixture()
  const directory = await stray()
  expect(await request("DELETE", "?confirm=1")).toMatchObject({ status: 200, data: { requested: 1, removed: 1, failed: [] } })
  expect(await request()).toMatchObject({ status: 200, data: { orphans: [], totalBytes: 0 } })
  await expect(access(directory)).rejects.toMatchObject({ code: "ENOENT" })
})

it("denies both routes without documents.write", async () => {
  const { f, admin, projectId, request, stray } = await fixture()
  const directory = await stray()
  const reader = await f.createAccount(admin.cookie, "reader")
  const state = await f.authentication.catalog.read()
  await f.authentication.catalog.saveMembership(state.revision, { accountId: reader.id, projectId, permissionRole: "viewer", workRoleIds: [] })
  const login = await f.login("reader")
  for (const method of ["GET", "DELETE"]) expect(await request(method, "?confirm=1", login.cookie)).toMatchObject({ status: 403, error: { code: "forbidden" } })
  await expect(access(directory)).resolves.toBeUndefined()
})

it("omits server paths from scan and cleanup responses", async () => {
  const { request, stray } = await fixture()
  await stray()
  expect((await request()).data).not.toHaveProperty("root")
  expect((await request("DELETE", "?confirm=1")).data).not.toHaveProperty("root")
})

it("returns and deletes only the selected project's orphans", async () => {
  const { f, admin, request, stray, projectId } = await fixture()
  const other = await f.json("/projects", "POST", { name: "Other project" }, admin.cookie)
  const otherDirectory = await stray(other.data.id)
  await stray()
  const result = await request()
  expect(result.data.orphans).toHaveLength(1)
  expect(result.data.orphans[0].projectId).toBe(projectId)
  expect(result.data.totalBytes).toBe(Buffer.byteLength("orphan bytes"))
  expect((await request("DELETE", "?confirm=1")).data).toEqual({ requested: 1, removed: 1, failed: [] })
  await expect(access(otherDirectory)).resolves.toBeUndefined()
})

it("returns unsupported when no data root is configured", async () => {
  const { f, admin, projectId } = await fixture()
  for (const method of ["GET", "DELETE"]) {
    const result = await f.json(`/projects/${projectId}/orphans?confirm=1`, method, undefined, admin.cookie)
    expect(result.error.code).toBe("unsupported")
    expect(JSON.stringify(result)).not.toContain(JSON.stringify(f.directory).slice(1, -1))
  }
})
