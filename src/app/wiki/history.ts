import { wikiStorage } from "./storage"
import { normalizePath } from "@/lib/path-utils"
import { withProjectLock } from "@/lib/project-mutex"
import { createFileHistoryService } from "@/modules/documents/application"
import { recordCompletedWikiWrite } from "./provenance"
const full = (projectPath: string, path: string) =>
  `${normalizePath(projectPath).replace(/\/+$/, "")}/${path}`
const history = createFileHistoryService({
  list: (projectPath, path) => wikiStorage.listHistory(projectPath, full(projectPath, path)),
  restore: (projectPath, path, id) =>
    withProjectLock(normalizePath(projectPath), async () => {
      const target = full(projectPath, path)
      const restored = await wikiStorage.restoreHistory(projectPath, target, id)
      // Restoring a historical page does not prove it was created now.
      await recordCompletedWikiWrite({ projectPath, relativePath: path, existed: true })
      return restored
    }),
})
const relative = (projectPath: string, path: string) => {
  const prefix = `${normalizePath(projectPath).replace(/\/+$/, "")}/`
  const normalized = normalizePath(path)
  if (!normalized.startsWith(prefix))
    throw new Error("File history is outside the selected project")
  return normalized.slice(prefix.length)
}
export const readProjectFileHistory = (projectPath: string, path: string) =>
  history.list(projectPath, relative(projectPath, path))
export const restoreProjectFileHistory = (projectPath: string, path: string, id: string) =>
  history.restore(projectPath, relative(projectPath, path), id)
