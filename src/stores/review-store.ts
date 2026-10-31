import { create } from "zustand"
import { reviewIdFor, unionField, normalizeReviewItems } from "@/modules/quality/domain"
import type { ReviewItem } from "@/modules/quality/domain"
export { reviewIdFor, normalizeReviewItems } from "@/modules/quality/domain"
export type { ReviewItem, ReviewOption } from "@/modules/quality/domain"

interface ReviewState {
  items: ReviewItem[]
  addItem: (item: Omit<ReviewItem, "id" | "resolved" | "createdAt">) => void
  addItems: (items: Omit<ReviewItem, "id" | "resolved" | "createdAt">[]) => void
  setItems: (items: ReviewItem[]) => void
  resolveItem: (id: string, action: string) => void
  dismissItem: (id: string) => void
  clearResolved: () => void
}

export const useReviewStore = create<ReviewState>((set) => ({
  items: [],

  addItem: (item) =>
    set((state) => {
      const id = reviewIdFor(item)
      // Same-content item already present (possibly resolved) → keep it
      // as-is so resolved state survives. The stable id makes this a
      // simple identity check, no separate dedup key.
      if (state.items.some((it) => it.id === id)) {
        return { items: state.items }
      }
      return {
        items: [...state.items, { ...item, id, resolved: false, createdAt: Date.now() }],
      }
    }),

  addItems: (items) =>
    set((state) => {
      // Dedup on the content-stable id against ALL existing items —
      // including resolved ones. The previous scheme only deduped
      // against *pending* items, which is exactly why re-surfacing a
      // review during ingest discarded its resolved state. Now a
      // resolved review with the same content is preserved (resolved
      // wins), with array fields merged.
      const result = [...state.items]
      const indexById = new Map<string, number>()
      result.forEach((it, idx) => indexById.set(it.id, idx))

      for (const incoming of items) {
        const id = reviewIdFor(incoming)
        const existingIdx = indexById.get(id)

        if (existingIdx !== undefined) {
          const old = result[existingIdx]
          result[existingIdx] = {
            ...old, // preserves resolved / resolvedAction / createdAt / id
            description: incoming.description || old.description,
            sourcePath: incoming.sourcePath ?? old.sourcePath,
            affectedPages: unionField(old.affectedPages, incoming.affectedPages),
            searchQueries: unionField(old.searchQueries, incoming.searchQueries),
          }
        } else {
          result.push({ ...incoming, id, resolved: false, createdAt: Date.now() })
          indexById.set(id, result.length - 1)
        }
      }

      return { items: result }
    }),

  setItems: (items) => {
    // Migrate-on-load: remap every item to its content-stable id,
    // collapsing any that share one. Old counter ids (review-N) and
    // their resolved state are folded in here (resolved wins), so a
    // resolved review keeps its resolution across the id-scheme change.
    // Computing the id from content (not the old id) makes this
    // idempotent — no migration-version flag needed.
    set({ items: normalizeReviewItems(items) })
  },

  resolveItem: (id, action) =>
    set((state) => ({
      items: state.items.map((item) =>
        item.id === id ? { ...item, resolved: true, resolvedAction: action } : item
      ),
    })),

  dismissItem: (id) =>
    set((state) => ({
      items: state.items.filter((item) => item.id !== id),
    })),

  clearResolved: () =>
    set((state) => ({
      items: state.items.filter((item) => !item.resolved),
    })),
}))
