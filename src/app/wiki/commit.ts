import { wikiStorage } from "./storage"
import { normalizePath } from "@/lib/path-utils"
import { withProjectLock } from "@/lib/project-mutex"
import { createWikiCommitService, type WikiCommitRepository } from "@/modules/wiki/application"
import { preserveWikiCreatedFrontmatter } from "@/modules/wiki/domain"
import { recordCompletedWikiWrite } from "./provenance"
import type { WikiWriteAttribution } from "@/modules/wiki/domain"

const full = (projectPath: string, path: string) =>
  `${normalizePath(projectPath).replace(/\/+$/, "")}/${path}`
export const localWikiCommits: WikiCommitRepository = {
  run: (projectPath, operation, attribution) =>
    withProjectLock(normalizePath(projectPath), () =>
      operation({
        read: (path) => wikiStorage.read(full(projectPath, path)),
        exists: (path) => wikiStorage.exists(full(projectPath, path)),
        // Preserve the existing native generation/history behavior. The module
        // controls scope/locking; the platform adapter chooses its write primitive.
        write: async (path, content) => {
          const target = full(projectPath, path)
          const existed = await wikiStorage.exists(target)
          const previous = existed && /^wiki\/.*\.md$/i.test(path) ? await wikiStorage.read(target) : ""
          const protectedContent = existed && /^wiki\/.*\.md$/i.test(path)
            ? preserveWikiCreatedFrontmatter(previous, content)
            : content
          await wikiStorage.write(target, protectedContent)
          await recordCompletedWikiWrite({ projectPath, relativePath: path, existed, content: protectedContent, attribution })
        },
      }),
    ),
}
export const wikiCommits = createWikiCommitService(localWikiCommits)
/** Absolute-path adapter for legacy generation helpers; no extra locks inside. */
export interface ProjectWikiCommit {
  readonly projectPath: string
  readonly attribution?: WikiWriteAttribution
  read(path: string): Promise<string>
  exists(path: string): Promise<boolean>
  write(path: string, content: string): Promise<void>
}
export function withWikiProjectCommit<T>(
  projectPath: string,
  operation: (context: ProjectWikiCommit) => Promise<T>,
  attribution?: WikiWriteAttribution,
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
        attribution: context.attribution,
        read: async (path: string) => context.read(relative(path)),
        exists: async (path: string) => context.exists(relative(path)),
        write: async (path: string, content: string) => context.write(relative(path), content),
      }),
    ), attribution,
  )
}
