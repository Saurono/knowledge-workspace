import { afterEach, expect, it, vi } from "vitest"
import { request as nodeRequest } from "node:http"
import { createHash } from "node:crypto"
import type { AddressInfo } from "node:net"
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createVaultConnector } from "./vault-connector"
import { accountFixture } from "./testing"

const closers: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of closers.splice(0)) await close() })
async function fixture() {
  const vault = await mkdtemp(join(tmpdir(), "kw-vault-"))
  await mkdir(join(vault, ".obsidian"))
  await mkdir(join(vault, "raw"))
  const sourcePath = join(vault, "raw", "source.md"), source = "original note body"
  await writeFile(sourcePath, source)
  const service = await accountFixture()
  await service.bootstrap()
  const admin = await service.login()
  const project = (await service.json("/projects", "POST", { name: "Connector test" }, admin.cookie)).data
  const agent = await service.createAccount(admin.cookie, "vault-connector", "agent")
  let catalog = await service.authentication.catalog.read()
  catalog = await service.authentication.catalog.saveMembership(catalog.revision, { accountId: agent.id, projectId: project.id, permissionRole: "editor", workRoleIds: [] })
  const token = await service.json("/auth/tokens", "POST", { accountId: agent.id, projectId: project.id, label: "Vault connector", workRoleId: null, permissions: ["project.read", "documents.read"], expiresAt: "2026-11-07T00:00:00.000Z" }, admin.cookie)
  if (token.response.status !== 201) throw new Error("Failed to issue fixture token")
  const upload = await fetch(`${service.origin}/api/v1/projects/${project.id}/documents`, { method: "POST", headers: { Cookie: admin.cookie, "X-KW-CSRF": "1", "Content-Type": "text/markdown", "X-File-Name": "source.md" }, body: new Uint8Array([97, 98, 99]) })
  const uploaded = await upload.json()
  const documentId = uploaded.data.data.id as string
  const sourceId = uploaded.data.data.sourceId as string
  const revision = uploaded.data.data.sha256 as string
  let now = Date.now()
  const connector = createVaultConnector({ origin: "https://wiki.example", serviceUrl: service.origin, serviceToken: token.data.secret, projectId: project.id, vaultPath: vault, now: () => now })
  await connector.listen()
  const address = connector.address() as AddressInfo, base = `http://127.0.0.1:${address.port}`
  const close = async () => {
    connector.server.closeAllConnections()
    await connector.close().catch(() => {})
    await service.close()
    await rm(vault, { recursive: true, force: true })
  }
  closers.push(close)
  const request = (path: string, init: RequestInit = {}, origin = "https://wiki.example") => fetch(`${base}${path}`, { ...init, headers: { Origin: origin, "Content-Type": "application/json", ...init.headers } })
  return { vault, sourcePath, source, connector, request, projectId: project.id, documentId, sourceId, revision, tokenId: token.data.token.id, service, admin, serviceToken: token.data.secret, advance: (ms: number) => { now += ms } }
}
async function pair(f: Awaited<ReturnType<typeof fixture>>) {
  const response = await f.request("/pair", { method: "POST", body: JSON.stringify({ code: f.connector.pairingCode() }) })
  return (await response.json()).token as string
}

it("pairs only the configured Origin/loopback Host, then syncs a protected receipt without touching source notes", async () => {
  const f = await fixture()
  expect((await f.request("/pair", { method: "POST", body: JSON.stringify({ code: f.connector.pairingCode() }) }, "https://evil.example")).status).toBe(403)
  const badHost = await new Promise<number>((resolve, reject) => {
    const address = f.connector.address() as AddressInfo
    const req = nodeRequest({ host: "127.0.0.1", port: address.port, path: "/pair", method: "POST", headers: { Host: "evil.example", Origin: "https://wiki.example", "Content-Type": "application/json" } }, res => { res.resume(); resolve(res.statusCode ?? 0) })
    req.on("error", reject); req.end(JSON.stringify({ code: f.connector.pairingCode() }))
  })
  expect(badHost).toBe(403)
  const token = await pair(f)
  f.advance(510)
  expect((await f.request("/pair", { method: "POST", body: JSON.stringify({ code: "" }) })).status).toBe(410)
  const synced = await f.request("/sync", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ documentId: f.documentId }) })
  expect(await synced.json()).toMatchObject({ delivered: true })
  const written = JSON.parse(await readFile(join(f.vault, "kb-ingest-records", `${f.sourceId}-${f.revision}.json`), "utf8"))
  expect(written).toMatchObject({ sourceId: f.documentId, projectId: f.projectId })
  const sourceBytes = await readFile(f.sourcePath)
  expect(sourceBytes.toString("utf8")).toBe(f.source)
  expect(createHash("sha256").update(sourceBytes).digest("hex")).toBe(createHash("sha256").update(f.source).digest("hex"))
  expect((await f.request("/sync", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ documentId: "../other" }) })).status).toBe(400)
})

it("rejects invalid pair codes, expires and revokes sessions, and rechecks service authorization", async () => {
  const f = await fixture()
  const token = await pair(f)
  await f.service.request(`/auth/tokens/${f.tokenId}`, "DELETE", undefined, f.admin.cookie)
  expect((await f.request("/sync", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ documentId: f.documentId }) })).status).toBe(403)
  expect((await f.request("/revoke", { method: "POST", headers: { Authorization: `Bearer ${token}` } })).status).toBe(200)
  expect((await f.request("/status", { headers: { Authorization: `Bearer ${token}` } })).status).toBe(401)
  const expired = await fixture()
  const expiredToken = await pair(expired)
  expired.advance(31 * 60_000)
  expect((await expired.request("/status", { headers: { Authorization: `Bearer ${expiredToken}` } })).status).toBe(401)
  const wrong = await fixture()
  expect((await wrong.request("/pair", { method: "POST", body: JSON.stringify({ code: "wrong" }) })).status).toBe(401)
  const cross = await fixture()
  const wrongProject = createVaultConnector({ origin: "https://wiki.example", serviceUrl: cross.service.origin, serviceToken: cross.serviceToken, projectId: "other-project", vaultPath: cross.vault })
  await wrongProject.listen()
  const wrongPort = wrongProject.address() as AddressInfo
  const wrongRequest = (path: string, init: RequestInit = {}) => fetch(`http://127.0.0.1:${wrongPort.port}${path}`, { ...init, headers: { Origin: "https://wiki.example", "Content-Type": "application/json", ...init.headers } })
  const wrongPair = await wrongRequest("/pair", { method: "POST", body: JSON.stringify({ code: wrongProject.pairingCode() }) })
  const wrongToken = (await wrongPair.json()).token
  expect((await wrongRequest("/sync", { method: "POST", headers: { Authorization: `Bearer ${wrongToken}` }, body: JSON.stringify({ documentId: cross.documentId }) })).status).toBe(403)
  wrongProject.server.closeAllConnections(); await wrongProject.close()
  const expiredCode = await fixture()
  expiredCode.advance(3 * 60_000)
  expect((await expiredCode.request("/pair", { method: "POST", body: JSON.stringify({ code: expiredCode.connector.pairingCode() }) })).status).toBe(410)
  const invalidCode = await fixture()
  expect((await invalidCode.request("/pair", { method: "POST", body: JSON.stringify({ code: "wrong" }) })).status).toBe(401)
})

it("does not recreate a moved configured Vault or report a false delivery", async () => {
  const f = await fixture(), token = await pair(f)
  const moved = `${f.vault}-moved`
  await import("node:fs/promises").then(fs => fs.rename(f.vault, moved))
  const response = await f.request("/sync", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ documentId: f.documentId }) })
  expect(response.status).toBe(503)
  expect(await import("node:fs/promises").then(fs => fs.stat(f.vault).then(() => true, () => false))).toBe(false)
  await import("node:fs/promises").then(fs => fs.rename(moved, f.vault))
})

it("bounds streamed receipt responses before parsing or writing", async () => {
  const f = await fixture(), token = await pair(f), originalFetch = globalThis.fetch
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes("/receipt")) return new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(512 * 1024 + 1)); controller.close() } }), { status: 200 })
    return originalFetch(input, init)
  })
  try {
    const response = await f.request("/sync", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ documentId: f.documentId }) })
    expect(response.status).toBe(502)
    expect(await access(join(f.vault, "kb-ingest-records")).then(() => true, () => false)).toBe(false)
  } finally { vi.unstubAllGlobals() }
})

it("waits for a pre-revoke commit before acknowledging revoke and rejects later commits", async () => {
  let release!: () => void, started!: () => void
  const gate = new Promise<void>(resolve => { release = resolve }), entered = new Promise<void>(resolve => { started = resolve })
  const vault = await mkdtemp(join(tmpdir(), "kw-vault-gate-")); await mkdir(join(vault, ".obsidian"))
  const service = await accountFixture(); await service.bootstrap(); const admin = await service.login()
  const project = (await service.json("/projects", "POST", { name: "Commit gate" }, admin.cookie)).data
  const agent = await service.createAccount(admin.cookie, "vault-gate", "agent")
  let catalog = await service.authentication.catalog.read(); catalog = await service.authentication.catalog.saveMembership(catalog.revision, { accountId: agent.id, projectId: project.id, permissionRole: "editor", workRoleIds: [] })
  const token = await service.json("/auth/tokens", "POST", { accountId: agent.id, projectId: project.id, label: "gate", workRoleId: null, permissions: ["project.read", "documents.read"], expiresAt: "2026-11-09T00:00:00.000Z" }, admin.cookie)
  const upload = await fetch(`${service.origin}/api/v1/projects/${project.id}/documents`, { method: "POST", headers: { Cookie: admin.cookie, "X-KW-CSRF": "1", "Content-Type": "text/markdown", "X-File-Name": "gate.md" }, body: "gate" })
  const doc = (await upload.json()).data.data
  const connector = createVaultConnector({ origin: "https://wiki.example", serviceUrl: service.origin, serviceToken: token.data.secret, projectId: project.id, vaultPath: vault, beforeCommit: async () => { started(); await gate } })
  await connector.listen(); const addr = connector.address() as AddressInfo, base = `http://127.0.0.1:${addr.port}`
  const request = (path: string, init: RequestInit = {}) => fetch(base + path, { ...init, headers: { Origin: "https://wiki.example", "Content-Type": "application/json", ...init.headers } })
  closers.push(async () => { release(); connector.server.closeAllConnections(); await connector.close().catch(() => {}); await service.close(); await rm(vault, { recursive: true, force: true }) })
  const paired = await request("/pair", { method: "POST", body: JSON.stringify({ code: connector.pairingCode() }) }), sessionToken = (await paired.json()).token as string
  const syncing = request("/sync", { method: "POST", headers: { Authorization: `Bearer ${sessionToken}` }, body: JSON.stringify({ documentId: doc.id }) })
  await entered
  let revokeDone = false
  const revoking = request("/revoke", { method: "POST", headers: { Authorization: `Bearer ${sessionToken}` } }).then(response => { revokeDone = true; return response })
  await new Promise(resolve => setTimeout(resolve, 20))
  expect(revokeDone).toBe(false)
  release()
  const [synced, revoked] = await Promise.all([syncing, revoking])
  expect((await synced.json()).error).toBe("session revoked")
  expect(revoked.status).toBe(200)
  expect((await request("/sync", { method: "POST", headers: { Authorization: `Bearer ${sessionToken}` }, body: JSON.stringify({ documentId: doc.id }) })).status).toBe(401)
  await expect((await import("node:fs/promises")).readFile(join(vault, "kb-ingest-records", `${doc.sourceId}-${doc.sha256}.json`), "utf8")).rejects.toMatchObject({ code: "ENOENT" })
})
