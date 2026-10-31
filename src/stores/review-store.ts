import { create } from "zustand"
import { createReviewState, type ReviewState } from "@/modules/quality/application"
export { reviewIdFor, normalizeReviewItems } from "@/modules/quality/domain"
export type { ReviewItem, ReviewOption } from "@/modules/quality/domain"
export const useReviewStore = create<ReviewState>((set) => createReviewState(set, Date.now))
