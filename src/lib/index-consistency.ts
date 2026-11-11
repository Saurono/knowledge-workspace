import type { VerifiedPageIndexCommit, VerifiedPageIndexPort } from "@/modules/retrieval/application"
import type { EmbeddingConfig } from "@/modules/retrieval/domain"

export interface IndexPage { relativePath: string; content: string; revision: string }
export interface IndexConsistencyPorts<T> {
  pages(): Promise<IndexPage[]>
  readEvidence(): Promise<Record<string, VerifiedPageIndexCommit>>
  saveEvidence(evidence: Record<string, VerifiedPageIndexCommit>): Promise<void>
  index: VerifiedPageIndexPort
  search(query: string): Promise<T[]>
  fallback(query: string, pages: IndexPage[]): Promise<T[]>
}

/** Own one instance per project/config. Startup must finish before exposing queries. */
export function createIndexConsistency<T>(projectPath: string, config: EmbeddingConfig, ports: IndexConsistencyPorts<T>) {
  let state: "unknown" | "stale" | "ready" = "unknown"
  let evidence: Record<string, VerifiedPageIndexCommit> = {}
  const pending = new Set<string>()
  let running: Promise<void> | undefined
  let generation = 0
  const input = (relativePath: string) => ({ projectPath, relativePath, config })
  async function valid(page: IndexPage): Promise<boolean> {
    const proof = evidence[page.relativePath]
    return !!proof && proof.projectPath === projectPath && proof.contentRevision === page.revision &&
      (await ports.index.verifyPage({ ...input(page.relativePath), expected: proof })).status === "verified"
  }
  async function startup() {
    state = "stale"
    generation++
    pending.clear()
    const pages = await ports.pages()
    try {
      const stored = await ports.readEvidence()
      evidence = stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {}
    } catch { evidence = {} }
    for (const page of pages) {
      try { if (await valid(page)) continue } catch { /* Missing/corrupt derived data requires rebuild. */ }
      pending.add(page.relativePath)
    }
    const paths = new Set(pages.map(page => page.relativePath))
    if (Object.keys(evidence).some(path => !paths.has(path))) {
      // Removing orphan vectors requires the adapter's full rebuild, never report ready.
      throw new Error("Orphan index evidence requires adapter cleanup")
    }
    if (!pending.size) state = "ready"
    return { status: state, queued: [...pending] }
  }
  function rebuild(): Promise<void> {
    if (running) return running
    state = "stale"
    running = (async () => {
      if (generation === 0) await startup()
      const token = generation
      const errors: unknown[] = []
      for (const page of await ports.pages()) {
        if (!pending.has(page.relativePath)) continue
        try {
          const proof = await ports.index.commitPage({ ...input(page.relativePath), force: true })
          const previous = evidence[page.relativePath]
          evidence[page.relativePath] = proof
          try {
            if (!await valid(page)) throw new Error(`Unverified index commit: ${page.relativePath}`)
            await ports.saveEvidence({ ...evidence })
          } catch (error) {
            if (previous) evidence[page.relativePath] = previous
            else delete evidence[page.relativePath]
            throw error
          }
          if (generation === token) pending.delete(page.relativePath)
        } catch (error) { errors.push(error) }
      }
      if (errors.length) throw new Error(`Index rebuild failed (${errors.length} page(s)): ${errors.map(String).join("; ")}`)
      if (generation === token && !pending.size) state = "ready"
    })().finally(() => { running = undefined })
    return running
  }
  async function query(query: string) {
    if (state === "ready") {
      try { return { status: "ready" as const, results: await ports.search(query) } }
      catch { await startup(); state = "stale" }
    }
    return { status: "stale" as const, results: await ports.fallback(query, await ports.pages()) }
  }
  return { startup, rebuild, query, status: () => state, queued: () => [...pending] }
}
