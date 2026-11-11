import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServer } from 'vite'

// The selected runtime supplies its existing verified index transport and filesystem ports.
const [projectPath, adapterPath] = process.argv.slice(2)
if (!projectPath || !adapterPath) {
  console.error('Usage: node scripts/rebuild-index.mjs <project-path> <adapter.mjs>')
  process.exitCode = 1
} else {
  const server = await createServer({ server: { middlewareMode: true } })
  try {
    const { rebuildIndex } = await server.ssrLoadModule('/src/lib/rebuild-index.ts')
    const { config, ports } = await (await import(pathToFileURL(resolve(adapterPath)).href)).createRebuildPorts(resolve(projectPath))
    const index = await rebuildIndex(resolve(projectPath), config, ports)
    console.log(`Index ${index.status()}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  } finally { await server.close() }
}
