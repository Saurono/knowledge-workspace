import { readFile, deleteFile } from "@/commands/fs"
import { withProjectLock } from "@/lib/project-mutex"
import { normalizePath } from "@/lib/path-utils"
import { createReviewFiles } from "@/modules/quality/application"
export const reviewFiles = createReviewFiles({ read: path => readFile(path), remove: path => deleteFile(path) })
export const deleteReviewedFile = (projectPath: string, path: string) =>
  withProjectLock(normalizePath(projectPath), () => reviewFiles.remove(projectPath, path))
