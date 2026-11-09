import type { IngestRecords } from "./snapshot"
import type { SourceProvenance } from "@/modules/documents/domain"
import { normalizePath, isAbsolutePath, getRelativePath } from "@/lib/path-utils"
import { withRecordsLock, loadIngestRecords, saveRecords } from "./repository"
import { fileExists } from "@/commands/fs"
import { getProjectPathById } from "@/lib/project-identity"
import { useWikiStore } from "@/stores/wiki-store"
import { enqueueIngest } from "@/app/ingestion/queue"

export interface GeneratedWikiIngestInput { projectId: string; projectPath: string; filePath: string }
export interface GeneratedWikiIngestPorts {
  loadRecords(path: string): Promise<IngestRecords>
  saveRecords(path: string, records: IngestRecords): Promise<void>
  withLock<T>(path: string, operation: () => Promise<T>): Promise<T>
  fileExists(path: string): Promise<boolean>
  resolveProjectPath(projectId: string): Promise<string | null>
  getActiveProject(): { id: string; path: string } | null
  enqueue(projectId: string, filePath: string, folderContext: string, identity: { sourceId: string }): Promise<string>
  createId(): string
  now(): string
}

export class GeneratedWikiIngestError extends Error {
  constructor(message: string, public readonly savedFilePath?: string) {
    super(message)
    this.name = "GeneratedWikiIngestError"
  }
}

function safeGeneratedQueryPath(projectPath: string, filePath: string): { absolutePath: string; relativePath: string } {
  const absolutePath = normalizePath(filePath)
  if (!isAbsolutePath(absolutePath) || /[\u0000-\u001f\u007f]/.test(absolutePath))
    throw new GeneratedWikiIngestError("Generated Wiki path must be a canonical absolute path")
  const relativePath = getRelativePath(absolutePath, projectPath)
  if (relativePath === absolutePath || !relativePath.startsWith("wiki/queries/") || !relativePath.toLowerCase().endsWith(".md") ||
      relativePath.split("/").some(part => !part || part === "." || part === ".."))
    throw new GeneratedWikiIngestError("Generated Wiki path must be inside project/wiki/queries")
  return { absolutePath, relativePath }
}

export function createGeneratedWikiIngestService(ports: GeneratedWikiIngestPorts) {
  return {
    async enqueueSavedQuery(input: GeneratedWikiIngestInput): Promise<{ sourceId: string; taskId: string }> {
      const projectPath = normalizePath(input.projectPath).replace(/\/+$/, "")
      const current = ports.getActiveProject()
      const registeredPath = await ports.resolveProjectPath(input.projectId)
      if (!current || current.id !== input.projectId || normalizePath(current.path).replace(/\/+$/, "") !== projectPath ||
          !registeredPath || normalizePath(registeredPath).replace(/\/+$/, "") !== projectPath)
        throw new GeneratedWikiIngestError("Cannot enqueue generated Wiki content because its project is no longer active", input.filePath)
      const target = safeGeneratedQueryPath(projectPath, input.filePath)
      if (!(await ports.fileExists(target.absolutePath))) throw new GeneratedWikiIngestError("Saved generated Wiki page does not exist", target.absolutePath)

      const sourceId = await ports.withLock(projectPath, async () => {
        const records = await ports.loadRecords(projectPath)
        const existing = records.sources[target.absolutePath]
        if (existing) {
          // Preserve the first observed time and stable identity. A known raw or
          // explicitly unknown classification must not be overwritten.
          if (!existing.sourceKind) {
            records.sources[target.absolutePath] = { ...existing, sourceKind: "generated-wiki" }
            await ports.saveRecords(projectPath, records)
          }
          return existing.id
        }
        const created: SourceProvenance = {
          id: ports.createId(), sourceKind: "generated-wiki", originalPath: null,
          receivedAt: ports.now(), ingestedAt: null, contentRevision: null,
        }
        records.sources[target.absolutePath] = created
        await ports.saveRecords(projectPath, records)
        return created.id
      })

      try {
        const stillActive = ports.getActiveProject()
        if (!stillActive || stillActive.id !== input.projectId || normalizePath(stillActive.path).replace(/\/+$/, "") !== projectPath)
          throw new Error("Project changed before queue insertion")
        const taskId = await ports.enqueue(input.projectId, target.absolutePath, "", { sourceId })
        return { sourceId, taskId }
      } catch (cause) {
        const detail = cause instanceof Error ? ` Queue error: ${cause.message}` : ""
        throw new GeneratedWikiIngestError(`The Wiki page was saved and its source record was kept, but ingestion could not be queued. Retry ingestion from this saved page.${detail}`, target.absolutePath)
      }
    },
  }
}

const generatedWikiIngest = createGeneratedWikiIngestService({
  loadRecords: loadIngestRecords,
  saveRecords,
  withLock: withRecordsLock,
  fileExists,
  resolveProjectPath: getProjectPathById,
  getActiveProject: () => {
    const project = useWikiStore.getState().project
    return project ? { id: project.id, path: project.path } : null
  },
  enqueue: enqueueIngest,
  createId: () => crypto.randomUUID(),
  now: () => new Date().toISOString(),
})

export const enqueueSavedGeneratedWikiQuery = generatedWikiIngest.enqueueSavedQuery
