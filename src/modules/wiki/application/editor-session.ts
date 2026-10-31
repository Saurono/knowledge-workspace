import { WikiRevisionConflict } from "../domain/page"
import type { WikiTextPage } from "../domain/page"
export interface WikiEditorPort {
  save(input: { content: string; expectedRevision: string }): Promise<WikiTextPage>
}
/** One loaded version and its ordered edits; callers create a new session on reload. */
export function createWikiEditorSession(
  initial: Promise<WikiTextPage>,
  port: WikiEditorPort,
) {
  let page = initial
  let queue: Promise<unknown> = Promise.resolve()
  let closed = false
  let conflict: WikiRevisionConflict | null = null
  return {
    save(content: string): Promise<WikiTextPage> {
      const operation = queue.then(async () => {
        if (closed) throw new Error("Wiki editor session is closed")
        if (conflict) throw conflict
        const previous = await page
        if (content === previous.content) return previous
        try {
          const saved = await port.save({ content, expectedRevision: previous.revision })
          page = Promise.resolve(saved)
          return saved
        } catch (error) {
          if (error instanceof WikiRevisionConflict) conflict = error
          throw error
        }
      })
      queue = operation.catch(() => {})
      return operation
    },
    close() { closed = true },
  }
}
