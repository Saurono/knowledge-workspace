import { canonicalWikiPagePath, WikiRevisionConflict, type WikiTextPage } from "../domain/page"
export interface WikiPageRepository {
  read(projectPath: string, path: string): Promise<string>
  /** Adapter serializes read/check/write with the project commit lock. */
  update(
    projectPath: string,
    path: string,
    change: (previous: string | null) => Promise<WikiTextPage>,
  ): Promise<WikiTextPage>
}
export function createWikiPageService(
  repository: WikiPageRepository,
  revision: (content: string) => Promise<string>,
) {
  return {
    read: async (projectPath: string, path: string): Promise<WikiTextPage> => {
      const canonical = canonicalWikiPagePath(path)
      const content = await repository.read(projectPath, canonical)
      return { path: canonical, content, revision: await revision(content) }
    },
    transform: async (projectPath: string, path: string, change: (previous: string) => string) => {
      const canonical = canonicalWikiPagePath(path)
      let changed = false
      const page = await repository.update(projectPath, canonical, async (previous) => {
        if (previous === null) throw new Error(`Wiki page is missing: ${canonical}`)
        const content = change(previous)
        changed = content !== previous
        return { path: canonical, content, revision: await revision(content) }
      })
      return { page, changed }
    },
    save: async (input: {
      projectPath: string
      path: string
      content: string
      expectedRevision?: string | null
    }) => {
      const path = canonicalWikiPagePath(input.path)
      return repository.update(input.projectPath, path, async (previous) => {
        const actual = previous === null ? null : await revision(previous)
        if (input.expectedRevision !== undefined && input.expectedRevision !== actual)
          throw new WikiRevisionConflict(path, input.expectedRevision, actual)
        return { path, content: input.content, revision: await revision(input.content) }
      })
    },
  }
}
