import { readFile, writeFile, writeFileAtomic, fileExists, listFileHistory, restoreFileHistory } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
/** Shared desktop storage adapter. Native write commands record the existing history format. */
export const wikiStorage = {
  read: (...args: Parameters<typeof readFile>) => readFile(...args),
  exists: (...args: Parameters<typeof fileExists>) => fileExists(...args),
  write: (...args: Parameters<typeof writeFile>) => writeFile(...args),
  writeAtomic: (...args: Parameters<typeof writeFileAtomic>) => writeFileAtomic(...args),
  listHistory: (...args: Parameters<typeof listFileHistory>) => listFileHistory(...args),
  restoreHistory: (...args: Parameters<typeof restoreFileHistory>) => restoreFileHistory(...args),
}
export const wikiStoragePath = (projectPath: string, path: string) =>
  `${normalizePath(projectPath).replace(/\/+$/, "")}/${path}`
