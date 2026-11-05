import {
  copyFile,
  createDirectory,
  deleteFile,
  fileExists,
  getFileSize,
  listDirectory,
  readFile,
  writeFile,
} from "@/commands/fs"
import type { WikiProject, FileNode } from "@/types/wiki"
import type { LlmConfig } from "@/stores/wiki-store"
import { enqueueBatch } from "@/lib/ingest-queue"
import { hasUsableLlm } from "@/lib/has-usable-llm"
import { getTaskLlmConfig } from "@/lib/llm-task-routing"
import { getFileName, getFileStem, getRelativePath, isAbsolutePath, normalizePath } from "@/lib/path-utils"
import { moveSourceKey } from "@/modules/documents/domain"
import {
  sourceIdentityForPath,
  sourceReferenceIdentity,
  sourceSummarySlugFromIdentity,
} from "@/lib/source-identity"
import {
  parseFrontmatterArray,
  parseSources,
  writeFrontmatterArray,
  writeSources,
} from "@/lib/sources-merge"
import { moveIngestCacheEntry, removeFromIngestCache } from "@/lib/ingest-cache"
import { removePageEmbedding, wikiPageIdFromPath } from "@/lib/embedding"
import {
  buildDeletedKeys,
  cleanIndexListing,
  normalizeWikiRefKey,
  stripDeletedWikilinks,
} from "@/lib/wiki-cleanup"
import { collectAllFilesIncludingDot } from "@/lib/sources-tree-delete"
import { isPathAllowedBySourceWatch, normalizeSourceWatchConfig } from "@/lib/source-watch-config"
import { isSensitiveConfigSourceFile } from "@/lib/source-filter"
import { naturalCompare } from "@/lib/natural-sort"
import type { SourceWatchConfig } from "@/stores/wiki-store"
import { useWikiStore } from "@/stores/wiki-store"
import { useActivityStore } from "@/stores/activity-store"
import { reserveImportedSource, confirmImportedSource, registerObservedSourcePaths, migrateSourceMetadata, documents } from "@/lib/ingest-receipts"
import { preprocessSourceFiles } from "@/lib/source-preprocess"
import { moveParsedMarkdown, removeParsedMarkdown } from "@/lib/parsed-source-output"
import { withProjectLock } from "@/lib/project-mutex"
import { validateSourceDomainMove } from "@/app/document-records/source-paths"

export const INGESTABLE_SOURCE_EXTENSIONS = new Set([
  "md",
  "mdx",
  "txt",
  "pdf",
  "doc",
  "docx",
  "docm",
  "ppt",
  "pps",
  "pot",
  "pptx",
  "pptm",
  "ppsx",
  "ppsm",
  "xlsx",
  "xlsm",
  "xlsb",
  "odt",
  "odp",
  "ods",
  "xls",
  "csv",
  "json",
  "html",
  "htm",
  "rtf",
  "xml",
  "yaml",
  "yml",
  "epub",
  "mobi",
  "org",
  "png",
  "jpg",
  "jpeg",
])

function flattenFiles(nodes: FileNode[]): FileNode[] {
  const files: FileNode[] = []
  for (const node of nodes) {
    if (node.is_dir) {
      files.push(...flattenFiles(node.children ?? []))
    } else {
      files.push(node)
    }
  }
  return files
}

function parentPath(path: string): string {
  const normalized = normalizePath(path)
  const index = normalized.lastIndexOf("/")
  return index > 0 ? normalized.slice(0, index) : ""
}

function stripTrailingSlash(path: string): string {
  return normalizePath(path).replace(/\/+$/, "")
}

function isSameOrInside(path: string, parent: string): boolean {
  const p = stripTrailingSlash(path).toLowerCase()
  const base = stripTrailingSlash(parent).toLowerCase()
  return p === base || p.startsWith(`${base}/`)
}

function isProjectScopedImport(projectPath: string, selectedFolder: string): boolean {
  const pp = stripTrailingSlash(projectPath)
  const sourceRoot = stripTrailingSlash(selectedFolder)
  return isSameOrInside(pp, sourceRoot) || isSameOrInside(sourceRoot, pp)
}

export interface DeleteSourceResult {
  deletedWikiPaths: string[]
  rewrittenSourcePages: number
}

export interface DeleteSourceFolderResult {
  deletedWikiPaths: string[]
}

export interface DeleteSourcesResult {
  deletedWikiPaths: string[]
  rewrittenSourcePages: number
  skippedPages: number
}

/**
 * Preserve source ownership when a watcher proves that a delete/create pair
 * is an unchanged file move. The caller must establish content identity from
 * watcher hashes; this function intentionally does not infer moves by name.
 */
export function migrateSourcePath(
  projectPath: string,
  oldSourcePath: string,
  newSourcePath: string,
): Promise<number> {
  const pp = normalizePath(projectPath)
  return withProjectLock(`source-import\0${pp}`, async () => {
    const oldKey = isAbsolutePath(oldSourcePath) ? normalizePath(oldSourcePath) : `${pp}/${normalizePath(oldSourcePath)}`
    const source = (await documents.list(pp))[oldKey]
    const migrate = () => migrateSourcePathUnlocked(pp, oldSourcePath, newSourcePath)
    return source
      ? withProjectLock(`ingest-source\0${pp}\0${source.id}`, migrate)
      : migrate()
  })
}

async function migrateSourcePathUnlocked(
  projectPath: string,
  oldSourcePath: string,
  newSourcePath: string,
): Promise<number> {
  const pp = normalizePath(projectPath)
  const oldIdentity = sourceIdentityForPath(pp, oldSourcePath)
  const newIdentity = sourceIdentityForPath(pp, newSourcePath)
  // Cache keys preserve spelling, so case-only renames still require a
  // migration even on case-insensitive filesystems.
  if (oldIdentity === newIdentity) return 0

  const oldKey = isAbsolutePath(oldSourcePath) ? normalizePath(oldSourcePath) : `${pp}/${normalizePath(oldSourcePath)}`
  const newKey = isAbsolutePath(newSourcePath) ? normalizePath(newSourcePath) : `${pp}/${normalizePath(newSourcePath)}`
  const sourceCatalog = await documents.list(pp)
  const oldSource = sourceCatalog[oldKey]
  const destinationSource = sourceCatalog[newKey]
  if (oldSource && destinationSource && oldSource.id !== destinationSource.id) {
    const destinationHasReceipt = (await documents.revisions(pp, newKey)).length > 0
    if (destinationSource.originalPath?.replace(/\\/g, "/") !== newKey ||
        destinationSource.ingestedAt !== null || destinationHasReceipt) {
      throw new Error("Cannot migrate a source over an independently registered destination")
    }
  }
  // Run the identity collision rule before touching summary pages, cache keys,
  // parsed output, or page frontmatter.
  const moveCandidate = { ...sourceCatalog }
  if (oldSource && destinationSource && oldSource.id !== destinationSource.id) delete moveCandidate[newKey]
  moveSourceKey(moveCandidate, oldKey, newKey)
  await validateSourceDomainMove(pp, oldKey, newKey, oldSource?.id, destinationSource?.id)

  const allMd = flattenMd(await listDirectory(`${pp}/wiki`))
  const oldBaseName = getFileName(oldIdentity).toLowerCase()
  const rawSourceFiles = flattenFiles(await listDirectory(`${pp}/raw/sources`, true))
  const matchingBasenames = rawSourceFiles.filter(
    (file) => getFileName(file.path).toLowerCase() === oldBaseName,
  )
  // Legacy pages sometimes stored only `config.yaml` for a nested source.
  // Rewrite that shorthand only when the live source basename is unique.
  const canMigrateLegacyBasename = oldIdentity.includes("/") && matchingBasenames.length === 1
  const writes: Array<{ path: string; original: string; migrated: string }> = []
  for (const file of allMd) {
    const content = await readFile(file.path)
    if (!content) continue
    const sources = parseSources(content)
    let changed = false
    const migrated = sources.map((source) => {
      const normalizedSource = sourceReferenceIdentity(source)
      const matchesIdentity = normalizedSource.toLowerCase() === oldIdentity.toLowerCase()
      const matchesUniqueLegacyBasename = canMigrateLegacyBasename &&
        !normalizedSource.includes("/") &&
        normalizedSource.toLowerCase() === oldBaseName
      if (!matchesIdentity && !matchesUniqueLegacyBasename) {
        return source
      }
      changed = true
      return newIdentity
    })
    if (!changed) continue
    writes.push({
      path: file.path,
      original: content,
      migrated: writeSources(content, Array.from(new Set(migrated))),
    })
  }

  const oldSummaryRel = `wiki/sources/${sourceSummarySlugFromIdentity(oldIdentity)}.md`
  const newSummaryRel = `wiki/sources/${sourceSummarySlugFromIdentity(newIdentity)}.md`
  const oldSummaryPath = `${pp}/${oldSummaryRel}`
  const newSummaryPath = `${pp}/${newSummaryRel}`
  const summaryMoves = new Map<string, string>()
  const shouldMoveSummary = oldSummaryRel !== newSummaryRel && await fileExists(oldSummaryPath)
  if (shouldMoveSummary && await fileExists(newSummaryPath)) {
    throw new Error(`Cannot migrate source summary because destination exists: ${newSummaryRel}`)
  }

  const completedWrites: typeof writes = []
  let newSummaryCreated = false
  let preserveMigratedContent = false
  try {
    for (const write of writes) {
      await writeFile(write.path, write.migrated)
      completedWrites.push(write)
    }
    if (shouldMoveSummary) {
      const migratedSummary = writes.find((write) => write.path === oldSummaryPath)?.migrated
        ?? await readFile(oldSummaryPath)
      await writeFile(newSummaryPath, migratedSummary)
      newSummaryCreated = true
      await deleteFile(oldSummaryPath)
      summaryMoves.set(oldSummaryRel, newSummaryRel)
    }
    preserveMigratedContent = true
    await moveIngestCacheEntry(pp, oldIdentity, newIdentity, summaryMoves)
    try {
      await moveParsedMarkdown(pp, oldSourcePath, newSourcePath)
    } catch (err) {
      console.warn("[source-lifecycle] failed to move optional parsed Markdown:", err)
    }
    // Preserve completed file migration if provenance storage is temporarily
    // unavailable; surface a retryable metadata error instead of rolling back
    // files after the cache/summary move has already completed.
    try { await migrateSourceMetadata(pp, oldSourcePath, newSourcePath, summaryMoves) }
    catch (error) {
      useActivityStore.getState().addItem({ type: "ingest", title: "Source metadata migration", status: "error", detail: `The moved source and its Wiki references were preserved, but identity metadata failed. Retry the file sync after fixing the metadata error: ${String(error)}`, filesWritten: [newSourcePath] })
      throw error
    }
    return writes.length
  } catch (err) {
    if (preserveMigratedContent) throw err
    if (newSummaryCreated) {
      try {
        await deleteFile(newSummaryPath)
      } catch {
        // Best-effort rollback; preserve the original error.
      }
    }
    for (const write of completedWrites.reverse()) {
      try {
        await writeFile(write.path, write.original)
      } catch {
        // Best-effort rollback; preserve the original error.
      }
    }
    throw err
  }
}

export function isIngestableSourcePath(path: string): boolean {
  const normalized = normalizePath(path)
  if (normalized.split("/").includes(".cache")) return false
  const fileName = normalized.split("/").pop() ?? ""
  if (!fileName || fileName.startsWith(".")) return false
  const ext = fileName.includes(".") ? fileName.split(".").pop()?.toLowerCase() : ""
  return ext ? INGESTABLE_SOURCE_EXTENSIONS.has(ext) : false
}

export function folderContextForSourcePath(sourcePath: string, sourcesRoot = "raw/sources"): string {
  const path = normalizePath(sourcePath)
  const root = normalizePath(sourcesRoot)
  const rawMarker = "/raw/sources/"
  const rel = path.startsWith(`${root}/`)
    ? path.slice(root.length + 1)
    : path.includes(rawMarker)
      ? path.slice(path.indexOf(rawMarker) + rawMarker.length)
      : path
  const parts = rel.split("/")
  parts.pop()
  return parts.join(" > ")
}

export async function enqueueSourceIngest(
  project: WikiProject,
  sourcePaths: string[],
  llmConfig: LlmConfig,
  options: { sourceRoot?: string; rootContext?: string; parsingConcurrency?: number } = {},
): Promise<string[]> {
  // Extraction can be expensive (OCR and Office parsers in particular).
  // Do not parse a batch that cannot proceed to ingest because no usable
  // model is configured. Imported source files remain on disk and can be
  // queued after the user configures a provider.
  if (!hasUsableLlm(getTaskLlmConfig("ingest", llmConfig))) return []
  const files = sourcePaths
    .filter((sourcePath) =>
      isIngestableSourcePath(sourcePath) &&
      !isSensitiveConfigSourceFile(sourcePath)
    )
    .map((sourcePath) => ({
      sourcePath,
      folderContext: withRootContext(
        folderContextForSourcePath(sourcePath, options.sourceRoot),
        options.rootContext,
      ),
    }))
  if (files.length === 0) return []
  await registerObservedSourcePaths(normalizePath(project.path), files.map(file=>file.sourcePath))
  const parsingConcurrency = options.parsingConcurrency
    ?? normalizeSourceWatchConfig(useWikiStore.getState().sourceWatchConfig).parsingConcurrency
  await preprocessSourceFiles(files.map((file) => file.sourcePath), parsingConcurrency)
  return enqueueBatch(project.id, files)
}

export type SourceImportSkipReason =
  | "unsupported-type"
  | "excluded"
  | "too-large"
  | "unreadable"
  | "copy-failed"
  | "sensitive-config"

export interface SkippedSourceImport {
  name: string
  reason: SourceImportSkipReason
  detail?: string
}

export interface SourceImportResult {
  imported: string[]
  skipped: SkippedSourceImport[]
}

async function registerAndCopySource(
  projectPath: string,
  originalPath: string,
  chooseTarget: (catalog: Awaited<ReturnType<typeof documents.list>>) => Promise<string>,
  copyInto: (target: string) => Promise<void>,
): Promise<string> {
  return withProjectLock(`source-import\0${projectPath}`, async () => {
    const catalog = await documents.list(projectPath)
    const existing = await documents.pathForOriginalSource(projectPath, originalPath)
    const target = existing ?? await chooseTarget(catalog)
    const targetOwner = Object.entries(catalog).find(([path]) => normalizedCatalogPath(path) === normalizedCatalogPath(target))?.[1]
    if (targetOwner && targetOwner.originalPath?.replace(/\\/g, "/") !== originalPath.replace(/\\/g, "/"))
      throw new Error("Import target is reserved by a different source origin")
    // Reserve the target in the catalog before copying. A failed/crashed copy
    // can then be retried into the same slot without a dated duplicate.
    await reserveImportedSource(projectPath, target, originalPath)
    const source = (await documents.list(projectPath))[target]
    if (!source || !/^[A-Za-z0-9_-]{1,128}$/.test(source.id))
      throw new Error("Source identity could not be established before copying")
    await withProjectLock(`ingest-source\0${projectPath}\0${source.id}`, async () => {
      await copyInto(target)
      await confirmImportedSource(projectPath, target)
    })
    return target
  })
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function errorDetail(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export async function importSourceFiles(
  project: WikiProject,
  sourcePaths: string[],
  llmConfig: LlmConfig,
  sourceWatchConfig?: SourceWatchConfig,
): Promise<SourceImportResult> {
  const pp = normalizePath(project.path)
  const importedPaths: string[] = []
  const skipped: SkippedSourceImport[] = []
  const cfg = normalizeSourceWatchConfig(sourceWatchConfig)
  // Explicit file selection is user intent, so the watcher's allow-list must
  // not silently reject a newly supported format from an older persisted
  // configuration. Exclusions and the size ceiling still apply. Folder/watch
  // imports continue to honor includeExtensions to prevent surprise ingestion.
  const explicitImportConfig = { ...cfg, includeExtensions: [] }
  const maxBytes = cfg.maxFileSizeMb * 1024 * 1024

  for (const sourcePath of sourcePaths) {
    const originalName = getFileName(sourcePath) || "unknown"
    if (isSensitiveConfigSourceFile(sourcePath)) {
      skipped.push({ name: originalName, reason: "sensitive-config" })
      continue
    }
    // Exclusions first: a hidden or excluded file may still be a supported
    // type, and "excluded" is the reason the user can act on.
    if (!isPathAllowedBySourceWatch(sourcePath, explicitImportConfig)) {
      skipped.push({ name: originalName, reason: "excluded" })
      continue
    }
    if (!isIngestableSourcePath(sourcePath)) {
      skipped.push({ name: originalName, reason: "unsupported-type" })
      continue
    }
    try {
      const size = await getFileSize(sourcePath)
      if (size > maxBytes) {
        skipped.push({ name: originalName, reason: "too-large", detail: formatMegabytes(size) })
        continue
      }
    } catch (err) {
      skipped.push({ name: originalName, reason: "unreadable", detail: errorDetail(err) })
      continue
    }

    try {
      const destPath = await registerAndCopySource(pp, sourcePath,
        async (catalog) => getUniqueDestPath(`${pp}/raw/sources`, originalName, Object.keys(catalog)),
        (target) => copyFile(sourcePath, target))
      importedPaths.push(destPath)
    } catch (err) {
      console.error(`Failed to import ${originalName}:`, err)
      skipped.push({ name: originalName, reason: "copy-failed", detail: errorDetail(err) })
    }
  }

  await enqueueSourceIngest(project, importedPaths, llmConfig, {
    parsingConcurrency: cfg.parsingConcurrency,
  })

  return { imported: importedPaths, skipped }
}

export async function importSourceFolder(
  project: WikiProject,
  selectedFolder: string,
  llmConfig: LlmConfig,
  sourceWatchConfig?: SourceWatchConfig,
): Promise<SourceImportResult> {
  const pp = normalizePath(project.path)
  const sourceRoot = normalizePath(selectedFolder)
  if (isProjectScopedImport(pp, sourceRoot)) {
    throw new Error("Cannot import the project folder or a folder inside the current project.")
  }
  const folderName = getFileName(selectedFolder) || "imported"
  const sourceRootPrefix = `${sourceRoot.replace(/\/+$/, "")}/`
  const preferredDestDir = `${pp}/raw/sources/${folderName}`
  const cfg = normalizeSourceWatchConfig(sourceWatchConfig)
  const maxBytes = cfg.maxFileSizeMb * 1024 * 1024
  const allowedFiles: string[] = []
  let resolvedDestDir = preferredDestDir
  const skipped: SkippedSourceImport[] = []
  // include hidden: a user importing a folder into raw/sources may
  // legitimately want dotfolder notes. Config-like files under known
  // agent/tool config folders are still filtered before copy so API
  // keys / tool config do not enter ingest.
  const sourceFiles = flattenFiles(await listDirectory(selectedFolder, true))

  for (const file of sourceFiles) {
    const relativeSourcePath = getRelativePath(file.path, sourceRoot)
    const displayName = relativeSourcePath || file.name
    const relPath = `raw/sources/${folderName}/${relativeSourcePath}`
    if (isSensitiveConfigSourceFile(file.path)) {
      skipped.push({ name: displayName, reason: "sensitive-config" })
      continue
    }
    if (!isPathAllowedBySourceWatch(relPath, cfg)) {
      skipped.push({ name: displayName, reason: "excluded" })
      continue
    }
    try {
      const size = await getFileSize(file.path)
      if (size > maxBytes) {
        skipped.push({ name: displayName, reason: "too-large", detail: formatMegabytes(size) })
        continue
      }
    } catch (err) {
      skipped.push({ name: displayName, reason: "unreadable", detail: errorDetail(err) })
      continue
    }
    try {
      const target = await registerAndCopySource(pp, file.path, async (catalog) => {
        const knownRootEntry = Object.entries(catalog).find(([sourcePath, source]) => {
          const origin = source.originalPath?.replace(/\\/g, "/")
          if (!origin?.startsWith(sourceRootPrefix)) return false
          const relative = origin.slice(sourceRootPrefix.length)
          return sourcePath.replace(/\\/g, "/").endsWith(`/${relative}`)
        })
        const knownRoot = knownRootEntry ? (() => {
          const relative = knownRootEntry[1].originalPath!.replace(/\\/g, "/").slice(sourceRootPrefix.length)
          const projectPath = knownRootEntry[0].replace(/\\/g, "/")
          return projectPath.slice(0, -relative.length - 1)
        })() : null
        let root = knownRoot ?? preferredDestDir
        if (!knownRoot && ((await fileExists(root)) || isCatalogImportRootReserved(catalog, root, sourceRoot)))
          root = await getUniqueDestPath(`${pp}/raw/sources`, folderName, reservedImportRoots(catalog))
        return `${root}/${relativeSourcePath}`
      }, async (destination) => {
        const parent = parentPath(destination)
        if (parent) await createDirectory(parent)
        await copyFile(file.path, destination)
      })
      const suffix = `/${relativeSourcePath}`
      if (target.endsWith(suffix)) resolvedDestDir = target.slice(0, -suffix.length)
      allowedFiles.push(target)
    } catch (err) {
      console.error(`Failed to import ${displayName}:`, err)
      skipped.push({ name: displayName, reason: "copy-failed", detail: errorDetail(err) })
    }
  }

  const naturallyOrderedFiles = [...allowedFiles].sort((a, b) =>
    naturalCompare(getRelativePath(a, resolvedDestDir), getRelativePath(b, resolvedDestDir)),
  )

  if (hasUsableLlm(getTaskLlmConfig("ingest", llmConfig))) {
    await enqueueSourceIngest(project, naturallyOrderedFiles, llmConfig, {
      sourceRoot: resolvedDestDir,
      rootContext: folderName,
      parsingConcurrency: cfg.parsingConcurrency,
    })
  }

  return { imported: naturallyOrderedFiles, skipped }
}

export async function deleteSourceFile(
  projectPath: string,
  sourcePath: string,
  options: { fileAlreadyDeleted?: boolean; logReason?: string } = {},
): Promise<DeleteSourceResult> {
  const result = await deleteSourceFiles(projectPath, [sourcePath], options)
  return {
    deletedWikiPaths: result.deletedWikiPaths,
    rewrittenSourcePages: result.rewrittenSourcePages,
  }
}

export async function deleteSourceFiles(
  projectPath: string,
  sourcePaths: string[],
  options: { fileAlreadyDeleted?: boolean; logReason?: string } = {},
): Promise<DeleteSourcesResult> {
  const pp = normalizePath(projectPath)
  const sourceInfos = sourcePaths
    .map((sourcePath) => {
      const source = normalizePath(sourcePath)
      return {
        source,
        fileName: getFileName(source),
        identity: sourceIdentityForPath(pp, source),
      }
    })
    .filter((info) => info.fileName.length > 0)

  if (sourceInfos.length === 0) {
    return { deletedWikiPaths: [], rewrittenSourcePages: 0, skippedPages: 0 }
  }

  const deletingNames = new Set(sourceInfos.map((info) => info.fileName.toLowerCase()))
  const deletingIdentities = new Set(
    sourceInfos.map((info) => sourceReferenceIdentity(info.identity).toLowerCase()),
  )

  if (!options.fileAlreadyDeleted) {
    for (const info of sourceInfos) {
      await deleteFile(info.source)
    }
  }

  for (const info of sourceInfos) {
    await removeParsedMarkdown(pp, info.source)
    try {
      await deleteFile(`${pp}/raw/sources/.cache/${info.fileName}.txt`)
    } catch {
      // cache file may not exist
    }
    try {
      await deleteFile(`${pp}/raw/sources/.cache/${info.fileName}.txt.parser`)
    } catch {
      // Version markers exist only for structured-document parser caches.
    }
    for (const cacheKey of new Set([info.identity, info.fileName])) {
      try {
        await removeFromIngestCache(pp, cacheKey)
      } catch {
        // non-critical
      }
    }
  }

  const pagesToDelete: string[] = []
  let rewrittenSourcePages = 0
  let skippedPages = 0

  let allMd: FileNode[] = []
  try {
    allMd = flattenMd(await listDirectory(`${pp}/wiki`))
  } catch (err) {
    console.warn("[source-lifecycle] failed to scan wiki sources during delete:", err)
  }

  for (const file of allMd) {
    let content: string
    try {
      content = await readFile(file.path)
    } catch (err) {
      console.warn(`[source-lifecycle] failed to read ${file.path}:`, err)
      continue
    }

    const sources = parseSources(content)
    if (sources.length === 0) {
      skippedPages++
      continue
    }

    const survivors = sources.filter(
      (source) => !sourceNameMatchesAny(source, deletingIdentities, deletingNames),
    )
    if (survivors.length === sources.length) {
      continue
    }

    if (survivors.length === 0) {
      pagesToDelete.push(file.path)
    } else {
      try {
        await writeFile(file.path, writeSources(content, survivors))
        rewrittenSourcePages++
      } catch (err) {
        console.warn(`[source-lifecycle] failed to rewrite sources for ${file.path}:`, err)
      }
    }
  }

  let deletedWikiPaths: string[] = []
  if (pagesToDelete.length > 0) {
    const { cascadeDeleteWikiPagesWithRefs } = await import("@/lib/wiki-page-delete")
    const result = await cascadeDeleteWikiPagesWithRefs(pp, pagesToDelete)
    deletedWikiPaths = result.deletedPaths
  }

  await appendSourceDeleteLog(pp, sourceInfos.map((info) => info.identity), {
    reason: options.logReason ?? (options.fileAlreadyDeleted ? "external delete" : "delete"),
    deletedWikiCount: deletedWikiPaths.length,
    keptWikiCount: rewrittenSourcePages,
  })

  if (skippedPages > 0) {
    console.debug(
      `[source-lifecycle] skipped ${skippedPages} wiki pages with no parseable sources while deleting ${sourceInfos.length} source(s)`,
    )
  }

  return { deletedWikiPaths, rewrittenSourcePages, skippedPages }
}

export async function deleteSourceFolder(
  projectPath: string,
  folder: FileNode,
  options: { folderAlreadyDeleted?: boolean } = {},
): Promise<DeleteSourceFolderResult> {
  const deletedWikiPaths: string[] = []
  const files = collectAllFilesIncludingDot(folder).map((file) => file.path)
  if (files.length > 0) {
    const result = await deleteSourceFiles(projectPath, files, {
      fileAlreadyDeleted: options.folderAlreadyDeleted,
      logReason: options.folderAlreadyDeleted ? "external folder delete" : "folder delete",
    })
    deletedWikiPaths.push(...result.deletedWikiPaths)
  }

  if (!options.folderAlreadyDeleted) {
    try {
      await deleteFile(folder.path)
    } catch (err) {
      console.warn(`Failed to remove folder ${folder.path}:`, err)
    }
  }

  return { deletedWikiPaths }
}

export async function cleanupDeletedWikiPages(
  projectPath: string,
  relativePaths: string[],
): Promise<void> {
  const pp = normalizePath(projectPath)
  const deletedInfos = relativePaths
    .map((path) => ({ path, slug: getFileStem(path), title: "" }))
    .filter((info) => info.slug.length > 0 && !info.slug.startsWith("."))

  if (deletedInfos.length === 0) return

  for (const info of deletedInfos) {
    await removePageEmbedding(pp, wikiPageIdFromPath(pp, info.path))
    const normalizedPath = normalizePath(info.path)
    if (normalizedPath.includes("/wiki/sources/") || normalizedPath.startsWith("wiki/sources/")) {
      try {
        await deleteFile(`${pp}/wiki/media/${info.slug}`)
      } catch {
        // Source pages may have no extracted media directory.
      }
    }
  }

  const deletedKeys = buildDeletedKeys(deletedInfos)
  const wikiTree = await listDirectory(`${pp}/wiki`)
  const allMd = flattenMd(wikiTree)

  for (const file of allMd) {
    let content: string
    try {
      content = await readFile(file.path)
    } catch {
      continue
    }

    let updated = content
    if (file.path === `${pp}/wiki/index.md` || file.name === "index.md") {
      updated = cleanIndexListing(updated, deletedKeys)
    }
    updated = stripDeletedWikilinks(updated, deletedKeys)

    const related = parseFrontmatterArray(updated, "related")
    if (related.length > 0) {
      const filtered = related.filter((s) => !deletedKeys.has(normalizeWikiRefKey(s)))
      if (filtered.length !== related.length) {
        updated = writeFrontmatterArray(updated, "related", filtered)
      }
    }

    if (updated !== content) {
      try {
        await writeFile(file.path, updated)
      } catch (err) {
        console.warn(`[source-lifecycle] failed to rewrite ${file.path}:`, err)
      }
    }
  }
}

function normalizedCatalogPath(path: string): string { return normalizePath(path).toLowerCase() }

function isCatalogImportRootReserved(catalog: Awaited<ReturnType<typeof documents.list>>, root: string, sourceRoot: string): boolean {
  const rootPrefix = `${normalizedCatalogPath(root)}/`
  const originPrefix = `${normalizePath(sourceRoot).replace(/\\/g, "/").replace(/\/+$/, "/")}`.toLowerCase()
  return Object.entries(catalog).some(([sourcePath, source]) => {
    if (!normalizedCatalogPath(sourcePath).startsWith(rootPrefix)) return false
    const origin = source.originalPath?.replace(/\\/g, "/").toLowerCase()
    return !origin?.startsWith(originPrefix)
  })
}

function reservedImportRoots(catalog: Awaited<ReturnType<typeof documents.list>>): string[] {
  return Object.keys(catalog).map(sourcePath => sourcePath.replace(/\\/g, "/").split("/").slice(0, -1).join("/"))
}

export async function getUniqueDestPath(dir: string, fileName: string, reservedPaths: readonly string[] = []): Promise<string> {
  const basePath = `${dir}/${fileName}`
  const reserved = new Set(reservedPaths.map(normalizedCatalogPath))
  const available = async (candidate: string) => !reserved.has(normalizedCatalogPath(candidate)) && !(await fileExists(candidate))

  if (await available(basePath)) {
    return basePath
  }

  const ext = fileName.includes(".") ? fileName.slice(fileName.lastIndexOf(".")) : ""
  const nameWithoutExt = ext ? fileName.slice(0, -ext.length) : fileName
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "")

  const withDate = `${dir}/${nameWithoutExt}-${date}${ext}`
  if (await available(withDate)) {
    return withDate
  }

  for (let i = 2; i <= 99; i++) {
    const withCounter = `${dir}/${nameWithoutExt}-${date}-${i}${ext}`
    if (await available(withCounter)) {
      return withCounter
    }
  }

  const fallback = `${dir}/${nameWithoutExt}-${date}-${Date.now()}${ext}`
  if (await available(fallback)) return fallback
  throw new Error(`Cannot allocate an unreserved destination for ${fileName}`)
}

async function appendSourceDeleteLog(
  projectPath: string,
  fileNames: string | string[],
  detail: { reason: string; deletedWikiCount: number; keptWikiCount: number },
): Promise<void> {
  try {
    const names = Array.isArray(fileNames) ? fileNames : [fileNames]
    const logPath = `${projectPath}/wiki/log.md`
    const logContent = await readFile(logPath).catch(() => "# Wiki Log\n")
    const date = new Date().toISOString().slice(0, 10)
    const subject = names.length === 1 ? names[0] : `${names.length} source files`
    const listed = names.length === 1 ? "" : `\n\nSources:\n${names.map((name) => `- ${name}`).join("\n")}`
    const logEntry = `\n## [${date}] ${detail.reason} | ${subject}\n\nDeleted ${names.length} source file${names.length === 1 ? "" : "s"} and ${detail.deletedWikiCount} wiki pages.${detail.keptWikiCount > 0 ? ` ${detail.keptWikiCount} shared pages kept (have other sources).` : ""}${listed}\n`
    await writeFile(logPath, logContent.trimEnd() + logEntry)
  } catch (err) {
    console.warn("[source-lifecycle] failed to append delete log:", err)
  }
}

function flattenMd(nodes: readonly FileNode[]): FileNode[] {
  const out: FileNode[] = []
  function walk(items: readonly FileNode[]): void {
    for (const item of items) {
      if (item.is_dir) {
        if (item.children) walk(item.children)
      } else if (item.name.endsWith(".md")) {
        out.push(item)
      }
    }
  }
  walk(nodes)
  return out
}

function sourceNameMatchesAny(
  source: string,
  deletingIdentities: Set<string>,
  deletingNames: Set<string>,
): boolean {
  const normalized = normalizePath(source)
  const identity = sourceReferenceIdentity(normalized).toLowerCase()
  if (deletingIdentities.has(identity)) return true

  // Legacy wiki pages stored only basenames in `sources`. Keep that fallback
  // for old pages, but do not let a path-aware source like
  // `project-b/config.yaml` match a different deleted `config.yaml`.
  if (normalized.includes("/")) return false

  const normalizedSource = normalized.toLowerCase()
  return deletingNames.has(normalizedSource)
}

function withRootContext(context: string, rootContext?: string): string {
  if (!rootContext) return context
  if (!context) return rootContext
  return `${rootContext} > ${context}`
}
