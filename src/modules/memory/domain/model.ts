export interface MemoryRecord {
  id: string
  title: string
  content: string
  category: string
  domainIds: string[]
  relatedIds: string[]
  createdAt: string
  updatedAt: string
}
const stringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string")
export function validateMemories(value: unknown): MemoryRecord[] {
  if (
    !Array.isArray(value) ||
    !value.every(
      (memory) =>
        memory &&
        [
          memory.id,
          memory.title,
          memory.content,
          memory.category,
          memory.createdAt,
          memory.updatedAt,
        ].every((item) => typeof item === "string") &&
        stringList(memory.domainIds) &&
        stringList(memory.relatedIds),
    ) ||
    new Set(value.map((memory) => memory.id)).size !== value.length
  )
    throw new Error("Invalid memory records")
  return value
}
export function removeMemoryRecord(memories: readonly MemoryRecord[], id: string): MemoryRecord[] {
  return memories
    .filter((memory) => memory.id !== id)
    .map((memory) => ({
      ...memory,
      relatedIds: memory.relatedIds.filter((related) => related !== id),
    }))
}
export function detachMemoryDomain(
  memories: readonly MemoryRecord[],
  domainId: string,
): MemoryRecord[] {
  return memories.map((memory) => ({
    ...memory,
    domainIds: memory.domainIds.filter((id) => id !== domainId),
  }))
}
