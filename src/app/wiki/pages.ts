import { wikiStorage } from "./storage"
import { normalizePath } from "@/lib/path-utils"
import { withProjectLock } from "@/lib/project-mutex"
import { createWikiPageService, type WikiPageRepository } from "@/modules/wiki/application"
import { hashContentRevision } from "@/modules/documents/application"
import { recordCompletedWikiWrite } from "./provenance"
const fullPath = (projectPath: string, path: string) =>
  `${normalizePath(projectPath).replace(/\/+$/, "")}/${path}`
export const localWikiPages: WikiPageRepository = {
  read: (projectPath, path) => wikiStorage.read(fullPath(projectPath, path)),
  update: (projectPath, path, change) =>
    withProjectLock(normalizePath(projectPath), async () => {
      const file = fullPath(projectPath, path)
      const previous = (await wikiStorage.exists(file)) ? await wikiStorage.read(file) : null
      const page = await change(previous)
      if (page.content !== previous) {
        await wikiStorage.writeAtomic(file, page.content)
        await recordCompletedWikiWrite({ projectPath, relativePath: path, existed: previous !== null })
      }
      return page
    }),
}
export const wikiPages = createWikiPageService(localWikiPages, hashContentRevision)
function relativePath(projectPath: string, path: string): string | null {
  const prefix = `${normalizePath(projectPath).replace(/\/+$/, "")}/`
  const normalized = normalizePath(path)
  return normalized.startsWith(prefix) ? normalized.slice(prefix.length) : null
}
export function isWikiTextPath(projectPath: string, path: string): boolean {
  const relative = relativePath(projectPath, path)
  return !!relative && relative.startsWith("wiki/") && /\.md$/i.test(relative)
}
export async function readWikiEditorPage(projectPath: string, path: string): Promise<string> {
  const relative = relativePath(projectPath, path)
  if (!relative) throw new Error("Wiki page is outside the selected project")
  return (await wikiPages.read(projectPath, relative)).content
}
/** Compatibility for the current editor; explicit revision conflicts are available to new callers. */
export async function writeWikiEditorPage(
  projectPath: string,
  path: string,
  content: string,
): Promise<void> {
  const relative = relativePath(projectPath, path)
  if (!relative) throw new Error("Wiki page is outside the selected project")
  await wikiPages.save({ projectPath, path: relative, content })
}

export async function transformWikiPage(
  projectPath: string,
  path: string,
  change: (previous: string) => string,
) {
  const relative = relativePath(projectPath, path)
  if (!relative) throw new Error("Wiki page is outside the selected project")
  return wikiPages.transform(projectPath, relative, change)
}
