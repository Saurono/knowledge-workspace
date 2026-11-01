import { readFileSync } from "node:fs"
import { createRemoteCli } from "@/modules/cli/application"
async function main() {
  const base = new URL(process.env.KW_API_URL ?? "http://127.0.0.1:4317"), token = process.env.KW_AGENT_TOKEN ?? ""
  if (base.pathname !== "/" || base.search || base.hash || base.username || base.password || (base.protocol !== "https:" && !(base.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)))) throw new Error("Use an HTTPS service origin, or a loopback HTTP origin")
  if (!/^kwt_[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("Set KW_AGENT_TOKEN in the process environment")
  const cli = createRemoteCli({ async request(path, body, contextId) {
    const response = await fetch(base.origin + path, { method: "POST", redirect: "error", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(contextId ? { "X-KW-Context": contextId } : {}) }, body: JSON.stringify(body) })
    const value = await response.json()
    if (!response.ok) throw new Error(value.error?.message ?? `Request failed (${response.status})`)
    return value.data
  } })
  const raw = readFileSync(0, "utf8")
  if (raw.length > 1024 * 1024) throw new Error("JSON input exceeds 1 MiB")
  const input = raw.trim() ? JSON.parse(raw) : {}
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Expected a JSON object on stdin")
  console.log(JSON.stringify(await cli.execute(process.argv[2] ?? "", process.argv[3] ?? "", input, process.env.KW_ACCESS_CONTEXT)))
}
void main().catch(error => { console.error(error instanceof Error ? error.message : "Shared CLI failed"); process.exitCode = 1 })
