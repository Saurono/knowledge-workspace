import { wikiPages, transformWikiPage } from "@/app/wiki/pages"
import { WikiRevisionConflict } from "@/modules/wiki/domain"
import { createStubService, createQualityRepairs } from "@/modules/quality/application"
import type { QualityItem } from "@/modules/quality/domain"
import { createDirectory, fileExists } from "@/commands/fs"
import { qualityScope } from "./scope"
export const { ensureBrokenLinkStub, stubRelativePathFromBrokenTarget } = createStubService({
  exists: path => fileExists(path), mkdir: path => createDirectory(path),
  today: () => new Date().toISOString().slice(0, 10),
  create: async (projectPath, path, content) => {
    try { await wikiPages.save({ projectPath, path, content, expectedRevision: null }); return true }
    catch (error) { if (error instanceof WikiRevisionConflict) return false; throw error }
  },
})
export function repairLintItems(projectPath: string, items: readonly QualityItem[], callbacks: {
  review(item: QualityItem): void; remove(ids: string[]): void; changed(): void
}) {
  return createQualityRepairs({
    ...callbacks, isCurrent: qualityScope(projectPath),
    transform: (path, change) => transformWikiPage(projectPath, `${projectPath}/wiki/${path}`, change),
    stub: target => ensureBrokenLinkStub(projectPath, target),
  }).repair(items)
}
