import { normalizeReviewTitle } from "./review-title"
export interface ReviewOption {
  label: string
  action: string // identifier for the action
}

export interface ReviewItem {
  id: string
  type: "contradiction" | "duplicate" | "missing-page" | "confirm" | "suggestion"
  title: string
  description: string
  sourcePath?: string
  affectedPages?: string[]
  searchQueries?: string[]
  options: ReviewOption[]
  resolved: boolean
  resolvedAction?: string
  createdAt: number
}

/**
 * Content-derived stable id. The SAME logical review (same type + same
 * normalized title) always gets the SAME id, so it survives ingest
 * regeneration, file moves, and reloads — and an external caller (the
 * resolve API) can target it reliably.
 *
 * Deliberately NOT counter-based (the old `review-N` scheme re-numbered
 * every review whenever the queue rebuilt, discarding resolved state)
 * and deliberately NOT keyed on sourcePath (mutable — a file rename
 * would re-id the review, the exact instability we're removing).
 *
 * "Collision" — two inputs sharing an id — is the intended behaviour:
 * identical content is the same review. Stability is bounded by
 * `normalizeReviewTitle` across LLM regenerations, the same ceiling the
 * previous dedup already accepted.
 */
export function reviewIdFor(item: Pick<ReviewItem, "type" | "title">): string {
  const key = `${item.type}::${normalizeReviewTitle(item.title)}`
  // FNV-1a (32-bit) — small, deterministic, dependency-free.
  let h = 0x811c9dc5
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return `review-${(h >>> 0).toString(16).padStart(8, "0")}`
}

/** Union two optional string arrays, dropping the field when empty. */
export function unionField(a?: string[], b?: string[]): string[] | undefined {
  const merged = Array.from(new Set([...(a ?? []), ...(b ?? [])]))
  return merged.length > 0 ? merged : undefined
}

export function mergeOptions(a: ReviewOption[], b: ReviewOption[]): ReviewOption[] {
  const byAction = new Map<string, ReviewOption>()
  for (const option of [...a, ...b]) {
    byAction.set(option.action, option)
  }
  return [...byAction.values()]
}

/**
 * Collapse two items that resolved to the same stable id. resolved
 * wins (if either was resolved, the survivor is), union the array
 * fields, keep the earliest createdAt, prefer a non-empty description.
 */
function mergeReviewItems(a: ReviewItem, b: ReviewItem): ReviewItem {
  const resolved = a.resolved || b.resolved
  const resolvedAction = resolved ? a.resolvedAction ?? b.resolvedAction : undefined
  return {
    ...a, // a.id is kept; both share it by construction
    resolved,
    resolvedAction,
    description: a.description || b.description,
    sourcePath: a.sourcePath ?? b.sourcePath,
    affectedPages: unionField(a.affectedPages, b.affectedPages),
    searchQueries: unionField(a.searchQueries, b.searchQueries),
    options: mergeOptions(a.options, b.options),
    createdAt: Math.min(a.createdAt, b.createdAt),
  }
}

export function normalizeReviewItems(items: ReviewItem[]): ReviewItem[] {
  const byId = new Map<string, ReviewItem>()
  for (const raw of items) {
    const remapped: ReviewItem = { ...raw, id: reviewIdFor(raw) }
    const existing = byId.get(remapped.id)
    byId.set(remapped.id, existing ? mergeReviewItems(existing, remapped) : remapped)
  }
  return [...byId.values()]
}
