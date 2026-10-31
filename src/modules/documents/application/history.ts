import { canonicalDocumentPath, type FileHistoryEntry } from "../domain/history"
export interface FileHistoryRepository {
  list(projectPath: string, path: string): Promise<FileHistoryEntry[]>
  restore(projectPath: string, path: string, entryId: string): Promise<string>
}
export function createFileHistoryService(repository: FileHistoryRepository) {
  return {
    list: (projectPath: string, path: string) =>
      repository.list(projectPath, canonicalDocumentPath(path)),
    restore: (projectPath: string, path: string, entryId: string) => {
      const canonical = canonicalDocumentPath(path)
      if (!entryId.trim()) throw new Error("Select a file history entry")
      return repository.restore(projectPath, canonical, entryId)
    },
  }
}
