import { create } from "zustand"
import { createLintState, type LintState } from "@/modules/quality/application"
export type { QualityItem as LintItem } from "@/modules/quality/domain"
export const useLintStore = create<LintState>((set) => createLintState(set, Date.now))
