import { build } from "rolldown"
import path from "node:path"
import { fileURLToPath } from "node:url"
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
await build({ input: path.join(root, "server/main.ts"), platform: "node", resolve: { alias: { "@": path.join(root, "src") } }, external: [/^node:/], output: { file: path.join(root, "dist-service/server.mjs"), format: "esm", sourcemap: true } })

await build({ input: path.join(root, "server/cli-main.ts"), platform: "node", resolve: { alias: { "@": path.join(root, "src") } }, external: [/^node:/], output: { file: path.join(root, "dist-service/cli.mjs"), format: "esm" } })
await build({ input: path.join(root, "server/vault-connector-main.ts"), platform: "node", resolve: { alias: { "@": path.join(root, "src") } }, external: [/^node:/], output: { file: path.join(root, "dist-service/vault-connector.mjs"), format: "esm" } })
