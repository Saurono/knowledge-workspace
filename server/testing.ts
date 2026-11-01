import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { AddressInfo } from "node:net"
import { SqliteRepository } from "./repository"
import { createServiceHttp } from "./http"
import { createAccountAuthentication } from "./auth-http"
import { DiskUploads } from "./uploads"
export const fixturePassword = "Only-for-tests-4917!"
export async function accountFixture() {
  const directory = mkdtempSync(join(tmpdir(), "kw-accounts-")), setupKey = "fixture-initialization-key-not-production"
  let now = "2026-11-01T00:00:00.000Z"
  const repository = new SqliteRepository(directory), authentication = createAccountAuthentication(repository, setupKey, false, () => now)
  const http = createServiceHttp({ repository, token: setupKey, authentication, uploads: new DiskUploads(directory) })
  await new Promise<void>(resolve => http.server.listen(0, "127.0.0.1", resolve))
  const origin = `http://127.0.0.1:${(http.server.address() as AddressInfo).port}`
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
  return { repository, authentication, request, json, bootstrap, login, createAccount, origin, setupKey, clock: (value: string) => { now = value }, close: async () => { http.closeStreams(); http.server.closeAllConnections(); await new Promise<void>(resolve => http.server.close(() => resolve())); repository.close(); rmSync(directory, { recursive: true, force: true }) }, directory }
}
