import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { AddressInfo } from "node:net"
import { SqliteRepository } from "./repository"
import { createServiceHttp } from "./http"
import { createAccountAuthentication } from "./auth-http"
import type { ExecutionGateway } from "./resource-tools"
import { DiskUploads } from "./uploads"
export const fixturePassword = "Only-for-tests-4917!"
export async function accountFixture(executions?: ExecutionGateway) {
  const directory = mkdtempSync(join(tmpdir(), "kw-accounts-")), setupKey = "fixture-initialization-key-not-production"
  let now = "2026-11-01T00:00:00.000Z", origin = "", repository = new SqliteRepository(directory)
  let authentication = createAccountAuthentication(repository, setupKey, false, () => now)
  const makeHttp = () => createServiceHttp({ repository, authentication, executions, uploads: new DiskUploads(directory) })
  let http = makeHttp()
  const listen = async () => {
    // 关掉 keep-alive 空闲超时：慢用例（例如写 200 页再导出）会让客户端连接闲置超过 Node 默认 5s，
    // undici 复用到已被服务端关掉的 socket 就报 ECONNRESET（Windows runner 上稳定复现）。
    http.server.keepAliveTimeout = 0
    await new Promise<void>(resolve => http.server.listen(0, "127.0.0.1", resolve)); origin = `http://127.0.0.1:${(http.server.address() as AddressInfo).port}`
  }
  const closeHttp = async () => { http.closeStreams(); http.server.closeAllConnections(); await new Promise<void>(resolve => http.server.close(() => resolve())); repository.close() }
  await listen()
  const request = (path: string, method = "GET", body?: unknown, cookie = "", extra: Record<string, string> = {}) => fetch(origin + "/api/v1" + path, { method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie, "X-KW-CSRF": "1" } : {}), ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const json = async (path: string, method = "GET", body?: unknown, cookie = "", extra: Record<string, string> = {}) => { const response = await request(path, method, body, cookie, extra); return { response, ...(await response.json()) } }
  const bootstrap = async () => json("/auth/bootstrap", "POST", { handle: "admin", displayName: "Admin", password: fixturePassword }, "", { "X-KW-Setup-Key": setupKey })
  const login = async (handle = "admin", password = fixturePassword) => { const response = await request("/auth/login", "POST", { handle, password }); return { response, cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "", data: (await response.json()).data } }
  const createAccount = async (cookie: string, handle: string, kind = "user") => {
    const state = (await json("/admin/accounts", "GET", undefined, cookie)).data
    const result = await json("/admin/accounts", "POST", { revision: state.revision, handle, displayName: handle, kind, password: fixturePassword }, cookie)
    if (result.response.status !== 201) throw new Error("Fixture account creation failed")
    return result.data.catalog.accounts.find((account: { handle: string }) => account.handle === handle)
  }
  return { get repository() { return repository }, get authentication() { return authentication }, get origin() { return origin }, request, json, bootstrap, login, createAccount, setupKey, clock: (value: string) => { now = value }, restart: async () => { await closeHttp(); repository = new SqliteRepository(directory); authentication = createAccountAuthentication(repository, setupKey, false, () => now); http = makeHttp(); await listen() }, close: async () => { await closeHttp(); rmSync(directory, { recursive: true, force: true }) }, directory }
}
