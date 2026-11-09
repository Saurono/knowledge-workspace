import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { randomBytes, createHash, timingSafeEqual } from "node:crypto"
import { mkdir, readFile, rename, rm, writeFile, realpath, lstat } from "node:fs/promises"
import { dirname, relative, isAbsolute } from "node:path"
import { summarizeIngestion, validateCheckpoint } from "@/modules/ingestion/domain"

export interface VaultConnectorConfig {
  origin: string; serviceUrl: string; serviceToken: string; accessContext?: string
  projectId: string; vaultPath: string; port?: number; now?: () => number; beforeCommit?: () => Promise<void>
}
const LIMIT = 2048, RESPONSE_LIMIT = 512 * 1024, SESSION_MS = 30 * 60_000, CODE_MS = 2 * 60_000
const hash = (text: string) => createHash("sha256").update(text).digest("hex")
function atomicWrite(path: string, data: string, beforeCommit?: () => Promise<void>) {
  return mkdir(dirname(path), { recursive: true }).then(async () => {
    const temp = `${path}.tmp-${randomBytes(8).toString("hex")}`
    await writeFile(temp, data, { flag: "wx", mode: 0o600 })
    let committed = false
    try { await beforeCommit?.(); await rename(temp, path); committed = true }
    finally { if (!committed) await rm(temp, { force: true }).catch(() => {}) }
  })
}
function safeReceipt(value: unknown, projectId: string) {
  if (!value || typeof value !== "object") throw new Error("Invalid receipt")
  const receipt = value as Record<string, unknown>
  if (receipt.schemaVersion !== 2 || receipt.projectId !== projectId || typeof receipt.sourceId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(receipt.sourceId) ||
    !(receipt.sourceRevision === null || typeof receipt.sourceRevision === "string" && /^[a-f0-9]{64}$/.test(receipt.sourceRevision)) ||
    !["raw-bytes-sha256", "parsed-text-sha256", "unknown"].includes(receipt.revisionKind as string) ||
    (receipt.revisionKind === "unknown") !== (receipt.sourceRevision === null) ||
    !(receipt.id === `${receipt.sourceId}-${receipt.revisionKind}-${receipt.sourceRevision ?? receipt.runId}` ||
      receipt.revisionKind === "raw-bytes-sha256" && typeof receipt.sourceRevision === "string" && receipt.id === `${receipt.sourceId}-${receipt.sourceRevision}`) ||
    !receipt.checkpoint || !receipt.summary || !receipt.stages || !receipt.times) throw new Error("Invalid receipt identity or schema")
  validateCheckpoint(receipt.checkpoint)
  const checkpoint = receipt.checkpoint as { projectId: string; documentId: string; stages: unknown }
  if (checkpoint.projectId !== projectId || typeof checkpoint.documentId !== "string" || !checkpoint.documentId ||
    JSON.stringify(summarizeIngestion(receipt.checkpoint as never)) !== JSON.stringify(receipt.summary) ||
    JSON.stringify(checkpoint.stages) !== JSON.stringify(receipt.stages)) throw new Error("Invalid receipt checkpoint projection")
  return receipt
}
export function createVaultConnector(config: VaultConnectorConfig) {
  const now = config.now ?? Date.now
  const expectedOrigin = new URL(config.origin).origin
  const service = new URL(config.serviceUrl)
  if (!/^https?:$/.test(service.protocol) || !config.serviceToken || !config.projectId || !config.vaultPath) throw new Error("Connector configuration is incomplete")
  const vault = config.vaultPath.replace(/\\/g, "/").replace(/\/+$/, "")
  let code = randomBytes(24).toString("base64url"), codeExpires = now() + CODE_MS, codeAttempts = 0
  let session: { token: string; expires: number; origin: string; revoked: boolean } | null = null
  let lastPairAt = 0, generation = 0, activeSyncs = 0, commits = Promise.resolve(), revoking = false
  if (!isAbsolute(vault)) throw new Error("Vault path must be absolute")
  let vaultRealPath: string | null = null
  const server = createServer((req, res) => { void handle(req, res).catch(() => { if (!res.headersSent) send(res, 500, { error: "connector failure" }); else res.destroy() }) })
  const hostOK = (host: string | undefined) => !!host && /^(?:127\.0\.0\.1|localhost)(?::\d{1,5})?$/.test(host)
  const send = (res: ServerResponse, status: number, data: unknown, origin = expectedOrigin) => {
    res.setHeader("Access-Control-Allow-Origin", origin); res.setHeader("Vary", "Origin"); res.setHeader("Cache-Control", "no-store")
    res.setHeader("Content-Type", "application/json; charset=utf-8"); res.writeHead(status); res.end(JSON.stringify(data))
  }
  async function body(req: IncomingMessage) {
    const chunks: Buffer[] = []; let size = 0
    for await (const chunk of req) { size += chunk.length; if (size > LIMIT) throw new Error("Request too large"); chunks.push(chunk) }
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid request")
    return value as Record<string, unknown>
  }
  function authorized(req: IncomingMessage) {
    if (!session || session.revoked || session.expires <= now() || req.headers.origin !== session.origin) return false
    return req.headers.authorization === `Bearer ${session.token}`
  }
  async function handle(req: IncomingMessage, res: ServerResponse) {
    if (!hostOK(req.headers.host)) return send(res, 403, { error: "host denied" })
    if (req.headers.origin !== expectedOrigin) return send(res, 403, { error: "origin denied" })
    if (req.method === "OPTIONS") { res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS"); res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization"); return send(res, 204, {}) }
    const path = req.url ?? "/"
    if (path === "/pair" && req.method === "POST") {
      if (now() - lastPairAt < 500) return send(res, 429, { error: "pair rate limited" })
      lastPairAt = now()
      if (now() > codeExpires || codeAttempts >= 5) return send(res, 410, { error: "pair code expired" })
      codeAttempts++
      let input: Record<string, unknown>
      try { input = await body(req) } catch { return send(res, 400, { error: "invalid request" }) }
      if (Object.keys(input).length !== 1 || typeof input.code !== "string") return send(res, 400, { error: "invalid request" })
      const submitted = Buffer.from(input.code), expected = Buffer.from(code)
      if (!code || submitted.length !== expected.length || !timingSafeEqual(submitted, expected)) return send(res, 401, { error: "pair denied" })
      code = ""; codeExpires = 0; codeAttempts = 5
      session = { token: randomBytes(32).toString("base64url"), expires: now() + SESSION_MS, origin: expectedOrigin, revoked: false }; generation++
      return send(res, 200, { token: session.token, expiresAt: new Date(session.expires).toISOString(), projectId: config.projectId })
    }
    if (!authorized(req)) return send(res, 401, { error: "session unavailable" })
    if (path === "/status" && req.method === "GET") return send(res, 200, { connected: true, projectId: config.projectId, expiresAt: new Date(session!.expires).toISOString() })
    if (path === "/revoke" && req.method === "POST") { revoking = true; session!.revoked = true; generation++; await commits; return send(res, 200, { revoked: true }) }
    if (path !== "/sync" || req.method !== "POST") return send(res, 404, { error: "not found" })
    if (activeSyncs >= 2) return send(res, 429, { error: "sync concurrency limit" })
    let input: Record<string, unknown>
    try { input = await body(req) } catch { return send(res, 400, { error: "invalid request" }) }
    if (Object.keys(input).length !== 1 || typeof input.documentId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(input.documentId)) return send(res, 400, { error: "invalid document" })
    const sessionAtStart = session, generationAtStart = generation
    activeSyncs++
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 10_000)
    try {
      if (!vaultRealPath || await realpath(vault).catch(() => null) !== vaultRealPath || !(await lstat(`${vault}/.obsidian`).then(stat => stat.isDirectory()).catch(() => false))) return send(res, 503, { error: "configured Vault unavailable" })
      const endpoint = new URL(`/api/v1/projects/${encodeURIComponent(config.projectId)}/documents/${encodeURIComponent(input.documentId)}/receipt`, service)
      const response = await fetch(endpoint, { redirect: "error", headers: { Authorization: `Bearer ${config.serviceToken}`, ...(config.accessContext ? { "X-KW-Context": config.accessContext } : {}) }, signal: controller.signal })
      if (!response.ok) return send(res, response.status === 401 || response.status === 403 ? 403 : 502, { error: "authorized receipt fetch failed" })
      if (!response.body) return send(res, 502, { error: "empty receipt response" })
      const reader = response.body.getReader(), chunks: Uint8Array[] = []; let byteLength = 0
      try { while (true) { const part = await reader.read(); if (part.done) break; byteLength += part.value.byteLength; if (byteLength > RESPONSE_LIMIT) { await reader.cancel(); return send(res, 502, { error: "receipt response too large" }) } chunks.push(part.value) } } finally { reader.releaseLock() }
      const bytes = new Uint8Array(byteLength); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
      const envelope = JSON.parse(new TextDecoder().decode(bytes)) as { data?: unknown }
      const receipt = safeReceipt(envelope?.data, config.projectId)
      if (generation !== generationAtStart || session !== sessionAtStart || !authorized(req)) return send(res, 401, { error: "session revoked" })
      if (receipt.sourceRevision === null) return send(res, 409, { error: "verified source revision required" })
      const payload = JSON.stringify(receipt, null, 2), filename = `${encodeURIComponent(receipt.sourceId as string)}-${encodeURIComponent(receipt.sourceRevision as string)}.json`
      const target = `${vault}/kb-ingest-records/${filename}`
      const outputDirectory = dirname(target)
      const existingOutput = await lstat(outputDirectory).catch(() => null)
      if (existingOutput?.isSymbolicLink()) return send(res, 403, { error: "Vault output path is not a safe child" })
      await mkdir(outputDirectory, { recursive: true })
      const directoryRealPath = await realpath(outputDirectory)
      const rel = relative(vaultRealPath, directoryRealPath)
      if (rel !== "kb-ingest-records" || await realpath(vault) !== vaultRealPath) return send(res, 403, { error: "Vault output path is not a safe child" })
      if (revoking || generation !== generationAtStart || session !== sessionAtStart || !authorized(req)) return send(res, 401, { error: "session revoked" })
      const commit = commits.then(() => atomicWrite(target, payload, async () => {
        // Recheck inside the serialized commit immediately before rename. A
        // revoke can arrive while this write waits behind another commit or
        // while the host hook is running.
        await config.beforeCommit?.()
        if (revoking || generation !== generationAtStart || session !== sessionAtStart || !authorized(req)) {
          throw Object.assign(new Error("session revoked"), { code: "session_revoked" })
        }
      }))
      commits = commit.catch(() => {})
      await commit
      if (generation !== generationAtStart || session !== sessionAtStart || !authorized(req)) return send(res, 401, { error: "session revoked" })
      const written = await readFile(target, "utf8")
      if (hash(written) !== hash(payload)) return send(res, 500, { error: "receipt verification failed" })
      return send(res, 200, { delivered: true, receiptId: receipt.id, digest: hash(payload) })
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : undefined
      return send(res, code === "session_revoked" ? 401 : 502, { error: code === "session_revoked" ? "session revoked" : error instanceof Error && error.name === "AbortError" ? "service timeout" : "receipt sync failed" })
    }
    finally { clearTimeout(timeout); activeSyncs-- }
  }
  return { server, pairingCode: () => code, listen: async () => {
    if (!(await lstat(`${vault}/.obsidian`).then(stat => stat.isDirectory()).catch(() => false))) throw new Error("Configured Vault must contain .obsidian")
    vaultRealPath = await realpath(vault)
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(config.port ?? 0, "127.0.0.1", resolve) })
  }, close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())), address: () => server.address(), revoke: async () => { revoking = true; if (session) session.revoked = true; generation++; await commits } }
}
