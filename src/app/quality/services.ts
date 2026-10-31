import { readFile, listDirectory } from "@/commands/fs"
import { useActivityStore } from "@/stores/activity-store"
import { useReviewStore } from "@/stores/review-store"
import { type LlmConfig } from "@/stores/wiki-store"
import { streamChat } from "@/lib/llm-client"
import { normalizePath, getFileName, getRelativePath } from "@/lib/path-utils"
import { buildLanguageDirective } from "@/lib/output-language"
import { hasUsableLlm } from "@/lib/has-usable-llm"
import { getTaskLlmConfig } from "@/lib/llm-task-routing"
import { parseFrontmatter } from "@/lib/frontmatter"
import { createLintService, createReviewSweep, type QualityCommonPorts } from "@/modules/quality/application"
import { qualityScope } from "./scope"
import { runStructuralWorker } from "./structural-worker"
const common: QualityCommonPorts<LlmConfig> = {
  files: { read: path => readFile(path), list: path => listDirectory(path) },
  paths: { normalizePath, getFileName, getRelativePath },
  activity: () => useActivityStore.getState(),
  stream: (...args) => streamChat(...args),
}
export const { runStructuralLint, runSemanticLint } = createLintService({
  ...common, languageDirective: buildLanguageDirective, structural: runStructuralWorker,
})
export const { buildWikiIndex, extractJsonObject, sweepResolvedReviews } = createReviewSweep({
  ...common, reviews: () => useReviewStore.getState(),
  modelConfig: () => getTaskLlmConfig("ingest"), usable: hasUsableLlm, parseFrontmatter,
  scope: path => qualityScope(path),
})
