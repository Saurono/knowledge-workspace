import { readFile, writeFile, fileExists } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import { withProjectLock } from "@/lib/project-mutex"
import { createWikiCommitService, type WikiCommitRepository } from "@/modules/wiki/application"

const full = (projectPath: string, path: string) =>
  `${normalizePath(projectPath).replace(/\/+$/, "")}/${path}`
export const localWikiCommits: WikiCommitRepository = {
  run: (projectPath, operation) =>
    withProjectLock(normalizePath(projectPath), () =>
      operation({
        read: (path) => readFile(full(projectPath, path)),
        exists: (path) => fileExists(full(projectPath, path)),
        // Preserve the existing native generation/history behavior. The module
        // controls scope/locking; the platform adapter chooses its write primitive.
        write: (path, content) => writeFile(full(projectPath, path), content),
      }),
    ),
}
export const wikiCommits = createWikiCommitService(localWikiCommits)
/** Absolute-path adapter for legacy generation helpers; no extra locks inside. */
export interface ProjectWikiCommit {
  readonly projectPath: string
  read(path: string): Promise<string>
  exists(path: string): Promise<boolean>
  write(path: string, content: string): Promise<void>
}
export function withWikiProjectCommit<T>(
  projectPath: string,
  operation: (context: ProjectWikiCommit) => Promise<T>,
): Promise<T> {
  const prefix = `${normalizePath(projectPath).replace(/\/+$/, "")}/`
  const relative = (path: string) => {
    const normalized = normalizePath(path)
    if (!normalized.startsWith(prefix)) throw new Error("Wiki commit path is outside its project")
    return normalized.slice(prefix.length)
  }
  return wikiCommits.run(projectPath, (context) =>
    operation(
      Object.freeze({
        projectPath,
        read: async (path: string) => context.read(relative(path)),
        exists: async (path: string) => context.exists(relative(path)),
        write: async (path: string, content: string) => context.write(relative(path), content),
      }),
    ),
  )
}
