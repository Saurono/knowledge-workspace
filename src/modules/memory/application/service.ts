import { removeMemoryRecord, validateMemories, type MemoryRecord } from "../domain/model"
export interface MemoryRepository {
  read(projectPath: string): Promise<MemoryRecord[]>
  update(
    projectPath: string,
    change: (memories: MemoryRecord[]) => MemoryRecord[],
  ): Promise<MemoryRecord[]>
}
export function createMemoryService(repository: MemoryRepository) {
  return {
    list: (projectPath: string) => repository.read(projectPath),
    save: (projectPath: string, record: MemoryRecord) =>
      repository.update(projectPath, (memories) => {
        validateMemories([record])
        if (!record.id.trim() || !record.title.trim() || !record.content.trim())
          throw new Error("Memory title and content are required")
        const previous = memories.find((memory) => memory.id === record.id)
        const saved = {
          ...record,
          title: record.title.trim(),
          createdAt: previous?.createdAt ?? record.createdAt,
          domainIds: [...new Set(record.domainIds)],
          relatedIds: [...new Set(record.relatedIds)].filter((id) => id !== record.id),
        }
        return validateMemories([...memories.filter((memory) => memory.id !== record.id), saved])
      }),
    remove: (projectPath: string, id: string) =>
      repository.update(projectPath, (memories) => removeMemoryRecord(memories, id)),
  }
}
export type MemoryService = ReturnType<typeof createMemoryService>
