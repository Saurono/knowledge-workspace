import type * as HostFs from "@/commands/fs"
import { createIndexConsistency } from "@/lib/index-consistency"
import { normalizePath, isAbsolutePath } from "@/lib/path-utils"
import { withProjectLock } from "@/lib/project-mutex"
import type { VerifiedPageIndexPort } from "@/modules/retrieval/application"
import type { EmbeddingConfig } from "@/modules/retrieval/domain"
import type { FileNode } from "@/types/wiki"
import { verifiedPageIndexPort } from "./verified-index"
import { retrievalService } from "./search"

type Deps = { index?: VerifiedPageIndexPort; fs?: Pick<typeof HostFs, "createDirectory" | "fileExists" | "hashFileSha256" | "readFile" | "writeFileAtomic">; fileTree?: () => FileNode[] }
export function createProjectIndexConsistency(projectPath: string, config: EmbeddingConfig, deps: Deps = {}) {
  const root = normalizePath(projectPath).replace(/\/$/, "")
  if (!isAbsolutePath(root)) throw new Error("Project path must be absolute")
  const fs = async () => deps.fs ?? await import("@/commands/fs")
  const path = `${root}/.llm-wiki/index-evidence.json`
  // Preserve corrupt evidence and refuse overwriting it; startup queues pages as stale.
  let corrupt = false
  const search = async (query: string, localOnly = false) =>
    (await retrievalService.search(root, query, { localOnly, embeddingConfig: localOnly ? null : config })).results
  return createIndexConsistency(root, config, {
    async pages() {
      const files: string[] = []
      const walk = (nodes: FileNode[]) => { for (const node of nodes) {
        if (node.is_dir) walk(node.children ?? [])
        else if (node.path.endsWith(".md")) files.push(normalizePath(node.path))
      } }
      walk(deps.fileTree?.() ?? [])
      if (!files.length) return []
      const { readFile, hashFileSha256 } = await fs()
      return Promise.all(files.sort().map(async file => {
        if (!file.startsWith(`${root}/wiki/`)) throw new Error("Page outside wiki")
        return { relativePath: file.slice(root.length + 1), content: await readFile(file), revision: await hashFileSha256(file) }
      }))
    },
    async readEvidence() {
      const { fileExists, readFile } = await fs()
      if (!await fileExists(path)) { corrupt = false; return {} }
      try {
        const value = JSON.parse(await readFile(path))
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid evidence")
        corrupt = false
        return value
      } catch (error) { corrupt = true; throw error }
    },
    saveEvidence: evidence => withProjectLock(root, async () => {
      if (corrupt) throw new Error("Corrupt index evidence preserved; repair required")
      const { createDirectory, writeFileAtomic } = await fs()
      await createDirectory(`${root}/.llm-wiki`)
      await writeFileAtomic(path, JSON.stringify(evidence))
    }),
    index: deps.index ?? verifiedPageIndexPort,
    search: query => search(query),
    fallback: query => search(query, true),
  })
}
function instances() { return instanceCache ??= new Map<string, ReturnType<typeof createProjectIndexConsistency>>() }
var instanceCache: Map<string, ReturnType<typeof createProjectIndexConsistency>> | undefined
function canonical(value: unknown): unknown { return value && typeof value === "object"
  ? Array.isArray(value) ? value.map(canonical) : Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])) : value }
export function startProjectIndexConsistency(projectPath: string, config: EmbeddingConfig, deps?: Deps) {
  const key = JSON.stringify([normalizePath(projectPath).replace(/\/$/, ""), canonical(config)])
  let instance = instances().get(key)
  if (!instance) { instance = createProjectIndexConsistency(projectPath, config, deps); instances().set(key, instance) }
  return instance.startup()
}
