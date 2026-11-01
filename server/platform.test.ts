import { afterEach, expect, it } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AddressInfo } from "node:net"
import { SqliteRepository } from "./repository"
import { createServiceHttp } from "./http"
import { DiskUploads } from "./uploads"
import { createWebPlatform } from "@/app/platform/web"
import { createRemoteWorkspace } from "@/app/platform/remote-workspace"
import { createSseParser } from "@/modules/platform/domain"
const cleanup: Array<() => Promise<void>> = [], token = "platform-integration-fixture-key"
async function fixture(maxUploadBytes = 1024) {
  const directory = mkdtempSync(join(tmpdir(), "kw-platform-")), repository = new SqliteRepository(directory)
  const storage = new DiskUploads(directory)
  const http = createServiceHttp({ repository, token, uploads: storage, maxUploadBytes })
  await new Promise<void>(resolve => http.server.listen(0, "127.0.0.1", resolve))
  const origin = `http://127.0.0.1:${(http.server.address() as AddressInfo).port}`
  const platform = createWebPlatform(origin, token)
  const project = (await platform.api.createProject("Platform fixture")).data
  cleanup.push(async () => { http.closeStreams(); http.server.closeAllConnections(); await new Promise<void>(resolve => http.server.close(() => resolve())); repository.close(); rmSync(directory, { recursive: true, force: true }) })
  return { platform, project, storage, request: (path: string, init: RequestInit = {}) => fetch(origin + `/api/v1/projects/${project.id}` + path, { ...init, headers: { Authorization: `Bearer ${token}`, ...init.headers } }) }
}
afterEach(async () => { for (const close of cleanup.splice(0)) await close() })
it("uploads bytes through the Web adapter with honest received state and downloads the exact content", async () => {
  const f = await fixture(), file = new File(["真实上传 UTF-8"], "资料.md", { type: "text/markdown" })
  const saved = (await f.platform.upload(f.project.id, file)).data
  expect(saved.data).toMatchObject({ name: "资料.md", status: "received", sourceIngestedAt: null, size: file.size, sha256: expect.stringMatching(/^[a-f0-9]{64}$/) })
  expect((await f.platform.api.documents(f.project.id)).data).toHaveLength(1)
  expect(await (await f.request(`/documents/${saved.key}/content`)).text()).toBe("真实上传 UTF-8")
  await expect(f.platform.shell()).rejects.toMatchObject({ code: "unsupported" })
  await expect(f.platform.configureVault()).rejects.toMatchObject({ code: "unsupported" })
})
it("rejects traversal filenames and over-limit uploads before publishing metadata", async () => {
  const f = await fixture(8)
  expect((await f.request("/documents", { method: "POST", headers: { "X-File-Name": encodeURIComponent("../outside.md") }, body: "body" })).status).toBe(400)
  expect((await f.request("/documents", { method: "POST", headers: { "X-File-Name": "large.md" }, body: "x".repeat(9) })).status).toBe(413)
  expect((await f.platform.api.documents(f.project.id)).data).toEqual([])
  expect((await f.platform.api.events(f.project.id)).data).toHaveLength(1)
})
it("replays SSE from a durable sequence and does not repeat consumed events", async () => {
  const f = await fixture()
  await f.platform.api.saveWiki(f.project.id, "wiki/a.md", "first", null)
  const read = async (after: number) => {
    const owner = new AbortController(), response = await f.request(`/events/stream?after=${after}`, { signal: owner.signal })
    const reader = response.body!.getReader(), parser = createSseParser(), decoder = new TextDecoder()
    try { while (true) { const chunk = await reader.read(); if (chunk.done) throw new Error("missing event"); const frames = parser.feed(decoder.decode(chunk.value, { stream: true })); if (frames.length) return JSON.parse(frames[0].data) } }
    finally { owner.abort(); await reader.cancel().catch(() => {}) }
  }
  const first = await read(1); expect(first.resource).toMatchObject({ key: "wiki/a.md", revision: 1 })
  await f.platform.api.saveWiki(f.project.id, "wiki/a.md", "second", 1)
  const second = await read(first.sequence); expect(second.sequence).toBeGreaterThan(first.sequence); expect(second.resource.revision).toBe(2)
})
it("uses conditional remote workspace repositories rather than silently rebasing stale edits", async () => {
  const f = await fixture(), one = createRemoteWorkspace(f.platform.api, f.project.id), two = createRemoteWorkspace(f.platform.api, f.project.id)
  await Promise.all([one.load(), two.load()])
  await one.addDomain({ id: "first", name: "First" })
  await expect(two.addDomain({ id: "second", name: "Second" })).rejects.toMatchObject({ code: "conflict" })
  expect((await f.platform.api.workspace(f.project.id)).data.data.domains.map(item => item.id)).toEqual(["first"])
})

it("never overwrites an existing upload directory when a document ID is reused", async () => {
  const f = await fixture()
  await f.storage.write(f.project.id, "fixed-id", new Uint8Array([1, 2]))
  await expect(f.storage.write(f.project.id, "fixed-id", new Uint8Array([3, 4]))).rejects.toMatchObject({ code: "EEXIST" })
  expect([...await f.storage.read(f.project.id, "fixed-id")]).toEqual([1, 2])
})
