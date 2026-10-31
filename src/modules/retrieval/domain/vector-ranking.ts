import type { ChunkSearchResult, PageSearchResult } from "./model"
export function rankChunkMatches(rawChunks: readonly ChunkSearchResult[], topK: number): PageSearchResult[] {
  // Group by page; keep every matched chunk's score so we can compute
  // a blended per-page score.
  const byPage = new Map<string, ChunkSearchResult[]>()
  for (const c of rawChunks) {
    const bucket = byPage.get(c.page_id)
    if (bucket) bucket.push(c)
    else byPage.set(c.page_id, [c])
  }

  const ranked: PageSearchResult[] = []
  for (const [pageId, chunks] of byPage.entries()) {
    chunks.sort((a, b) => b.score - a.score)
    const top = chunks[0].score
    const tail = chunks.slice(1).reduce((sum, c) => sum + c.score, 0)
    // Cap the tail contribution so many-weak-chunks can't drown a
    // single-strong-chunk page. 0.3 weight is empirical; adjust later
    // with real data.
    const blended = top + Math.min(tail * 0.3, Math.max(0, 1 - top))
    ranked.push({
      id: pageId,
      score: blended,
      matchedChunks: chunks.slice(0, 3).map((c) => ({
        text: c.chunk_text,
        headingPath: c.heading_path,
        score: c.score,
      })),
    })
  }
  ranked.sort((a, b) => b.score - a.score)
  return ranked.slice(0, topK)
}
