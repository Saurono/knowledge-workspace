import { createVaultConnector } from "./vault-connector"

const required = (name: string) => {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required environment setting: ${name}`)
  return value
}
const port = Number(process.env.KW_VAULT_CONNECTOR_PORT ?? "4319")
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Invalid connector port")
const connector = createVaultConnector({
  origin: required("KW_VAULT_CONNECTOR_ORIGIN"),
  serviceUrl: required("KW_API_URL"),
  serviceToken: required("KW_AGENT_TOKEN"),
  accessContext: process.env.KW_ACCESS_CONTEXT,
  projectId: required("KW_PROJECT_ID"),
  vaultPath: required("KW_VAULT_PATH"),
  port: process.argv.includes("--pull") ? 0 : port,
})
await connector.listen()
const address = connector.address()
const actualPort = address && typeof address === "object" ? address.port : port
if (process.argv.includes("--pull")) {
  const documentId = required("KW_DOCUMENT_ID")
  const endpoint = `http://127.0.0.1:${actualPort}`
  try {
    const origin = new URL(required("KW_VAULT_CONNECTOR_ORIGIN")).origin
    const paired = await fetch(`${endpoint}/pair`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ code: connector.pairingCode() }) })
    if (!paired.ok) throw new Error("Local pull pairing failed")
    const { token } = await paired.json() as { token: string }
    const synced = await fetch(`${endpoint}/sync`, { method: "POST", headers: { Origin: origin, Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ documentId }) })
    const result = await synced.json() as { delivered?: boolean; receiptId?: string; digest?: string }
    if (!synced.ok || !result.delivered || !result.receiptId || !result.digest) throw new Error("Local receipt pull failed")
    await fetch(`${endpoint}/revoke`, { method: "POST", headers: { Origin: origin, Authorization: `Bearer ${token}` } })
    process.stdout.write(`Vault receipt pulled and verified: ${result.receiptId} (${result.digest})\n`)
  } finally { await connector.close() }
  process.exit(0)
}
process.stdout.write(`Wiki Vault connector listening on http://127.0.0.1:${actualPort}\nPairing code (valid for 2 minutes): ${connector.pairingCode()}\n`)
const stop = () => { void connector.close().finally(() => process.exit(0)) }
process.once("SIGINT", stop)
process.once("SIGTERM", stop)
