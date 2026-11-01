import { createAccountAuthentication } from "./auth-http"
import { DiskUploads } from "./uploads"
import { resolve } from "node:path"
import { SqliteRepository } from "./repository"
import { createServiceHttp } from "./http"
const token = process.env.KW_SERVICE_TOKEN ?? ""
if (token.length < 24) throw new Error("Set KW_SERVICE_TOKEN to a service access key of at least 24 characters")
const directory = resolve(process.env.KW_SERVICE_DATA ?? ".knowledge-workspace-service")
const repository = new SqliteRepository(directory)
const { server, closeStreams } = createServiceHttp({ repository, token, authentication: createAccountAuthentication(repository, token, process.env.KW_SECURE_COOKIE === "1"), uploads: new DiskUploads(directory), webRoot: resolve(process.env.KW_SERVICE_WEB_ROOT ?? "dist-web") })
const port = Number(process.env.KW_SERVICE_PORT ?? 4317), host = process.env.KW_SERVICE_HOST ?? "127.0.0.1"
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid KW_SERVICE_PORT")
server.listen(port, host, () => console.log(`Knowledge Workspace service listening on ${host}:${port}`))
let closing = false
const shutdown = () => { if (closing) return; closing = true; closeStreams(); server.close(() => { repository.close(); process.exit(0) }); server.closeIdleConnections() }
process.on("SIGTERM", shutdown); process.on("SIGINT", shutdown)
