import {
  registerSource,
  reserveSource,
  confirmSourceReceived,
  normalizeSourceKey,
  setSourceContentRevision,
  sourcePathForOrigin,
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
    reserveImportedSource: (projectPath: string, sourcePath: string, originalPath: string) =>
      repository.update(projectPath, (catalog) => reserveSource(catalog, sourcePath, originalPath, { createId: clock.createId })),
    confirmImportedSource: (projectPath: string, sourcePath: string) =>
      repository.update(projectPath, (catalog) => confirmSourceReceived(catalog, sourcePath, clock.now())),
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
    pathForOriginalSource: async (projectPath: string, originalPath: string) =>
      sourcePathForOrigin(await repository.read(projectPath), originalPath),
    recordContentRevision: (projectPath: string, sourcePath: string, revision: string) =>
      repository.update(projectPath, (catalog) => setSourceContentRevision(catalog, sourcePath, revision)),
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

/** SHA-256 of original uploaded bytes; distinct from parser-text revisions. */
export async function hashSourceBytes(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))
  return [...new Uint8Array(hash)].map((n) => n.toString(16).padStart(2, "0")).join("")
}
