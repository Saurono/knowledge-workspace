import {
  registerSource,
  normalizeSourceKey,
  type SourceCatalog,
  type DocumentRevision,
} from "../domain"
export interface DocumentRepository {
  read(projectPath: string): Promise<SourceCatalog>
  update(projectPath: string, change: (catalog: SourceCatalog) => SourceCatalog): Promise<void>
  revisions(projectPath: string, sourceId: string): Promise<DocumentRevision[]>
}
export function createDocumentService(
  repository: DocumentRepository,
  clock: { createId(): string; now(): string },
) {
  return {
    registerImportedSource: (projectPath: string, sourcePath: string, originalPath: string) =>
      repository.update(projectPath, (catalog) =>
        registerSource(catalog, sourcePath, originalPath, {
          createId: clock.createId,
          now: clock.now(),
        }),
      ),
    registerImportedSources: (
      projectPath: string,
      sources: readonly { sourcePath: string; originalPath: string }[],
    ) =>
      repository.update(projectPath, (catalog) => {
        const now = clock.now()
        return sources.reduce(
          (current, source) =>
            registerSource(current, source.sourcePath, source.originalPath, {
              createId: clock.createId,
              now,
            }),
          catalog,
        )
      }),
    list: (projectPath: string) => repository.read(projectPath),
    revisions: async (projectPath: string, sourcePath: string) => {
      const catalog = await repository.read(projectPath)
      const key = normalizeSourceKey(sourcePath)
      return Object.prototype.hasOwnProperty.call(catalog, key)
        ? repository.revisions(projectPath, catalog[key].id)
        : []
    },
  }
}
/** SHA-256 remains compatible with existing receipt revision keys. */
export async function hashContentRevision(content: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content))
  return [...new Uint8Array(hash)].map((n) => n.toString(16).padStart(2, "0")).join("")
}
