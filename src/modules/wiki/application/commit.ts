import { canonicalWikiStoragePath } from "../domain/page"

/** Unlocked storage supplied only while the repository owns the project lock. */
export interface WikiCommitStorage {
  read(path: string): Promise<string>
  exists(path: string): Promise<boolean>
  write(path: string, content: string): Promise<void>
}
export interface WikiCommitRepository {
  run<T>(projectPath: string, operation: (storage: WikiCommitStorage) => Promise<T>): Promise<T>
}
export interface WikiCommitContext extends WikiCommitStorage {
  readonly projectPath: string
}

/** A scoped commit, not a multi-file rollback transaction. */
export function createWikiCommitService(repository: WikiCommitRepository) {
  return {
    run<T>(projectPath: string, operation: (context: WikiCommitContext) => Promise<T>) {
      return repository.run(projectPath, async (storage) => {
        let open = true
        const pending = new Set<Promise<unknown>>()
        const perform = <Value>(
          path: string,
          action: (canonical: string) => Promise<Value>,
        ): Promise<Value> => {
          try {
            if (!open) throw new Error("Wiki commit context is closed")
            const canonical = canonicalWikiStoragePath(path)
            const promise = Promise.resolve(action(canonical))
            pending.add(promise)
            void promise.then(
              () => pending.delete(promise),
              () => pending.delete(promise),
            )
            return promise
          } catch (error) {
            return Promise.reject(error)
          }
        }
        const context: WikiCommitContext = Object.freeze({
          projectPath,
          read: (path: string) => perform(path, (canonical) => storage.read(canonical)),
          exists: (path: string) => perform(path, (canonical) => storage.exists(canonical)),
          write: (path: string, content: string) =>
            perform(path, (canonical) => storage.write(canonical, content)),
        })
        let result!: T
        let failed = false
        let failure: unknown
        try {
          result = await operation(context)
        } catch (error) {
          failed = true
          failure = error
        } finally {
          open = false
        }
        // Retain the lock until already-started I/O finishes, even when the
        // callback fails. Callers still await/handle each operation as before.
        const outstanding = await Promise.allSettled([...pending])
        if (failed) throw failure
        const rejected = outstanding.find((item) => item.status === "rejected")
        if (rejected?.status === "rejected") throw rejected.reason
        return result
      })
    },
  }
}
