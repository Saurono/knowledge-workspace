import { validateSharedWorkspace, type SharedWorkspace } from "./workspace"

export const EXPORT_BUNDLE_VERSION = 1
export interface ExportBundle {
  bundleVersion: typeof EXPORT_BUNDLE_VERSION
  exportedAt: string
  project: { name: string }
  workspace: SharedWorkspace
  wiki: Array<{ path: string; content: string }>
  documents: Array<{ sourceId: string; name: string; size: number; mediaType?: string; byteRevision?: string }>
}
type Input = { projectName: string; exportedAt: string; workspace: SharedWorkspace; wiki: ReadonlyArray<ExportBundle["wiki"][number]>; documents: ReadonlyArray<ExportBundle["documents"][number]> }
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0

// Clone all nested data; sort wiki paths, document source IDs and memory IDs.
// Duplicate resource keys are ambiguous and must be rejected.
export function createExportBundle(input: Input): ExportBundle {
  const bundle: ExportBundle = structuredClone({ bundleVersion: EXPORT_BUNDLE_VERSION, exportedAt: input.exportedAt, project: { name: input.projectName }, workspace: input.workspace, wiki: [...input.wiki], documents: [...input.documents] })
  const paths = new Set<string>(), ids = new Set<string>()
  for (const item of bundle.wiki) {
    if (paths.has(item.path)) throw new Error(`Duplicate wiki path: ${item.path}`)
    paths.add(item.path)
  }
  for (const item of bundle.documents) {
    if (ids.has(item.sourceId)) throw new Error(`Duplicate document sourceId: ${item.sourceId}`)
    ids.add(item.sourceId)
  }
  bundle.wiki.sort((a, b) => compare(a.path, b.path))
  bundle.documents.sort((a, b) => compare(a.sourceId, b.sourceId))
  bundle.workspace.memories.sort((a, b) => compare(a.id, b.id))
  return bundle
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value)
const nonempty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0

// Delegate workspace validation, then return an independent normalized bundle.
export function validateExportBundle(value: unknown): ExportBundle {
  if (!object(value) || value.bundleVersion !== EXPORT_BUNDLE_VERSION) throw new Error("Unsupported export bundle version")
  if (typeof value.exportedAt !== "string" || !Number.isFinite(Date.parse(value.exportedAt))) throw new Error("Invalid exportedAt")
  if (!object(value.project) || !nonempty(value.project.name)) throw new Error("Invalid project name")
  const workspace = validateSharedWorkspace(value.workspace)
  if (!Array.isArray(value.wiki) || !value.wiki.every(item => object(item) && nonempty(item.path) && nonempty(item.content))) throw new Error("Invalid wiki")
  if (!Array.isArray(value.documents) || !value.documents.every(item => object(item) && nonempty(item.sourceId) && nonempty(item.name) && typeof item.size === "number" && Number.isInteger(item.size) && item.size >= 0 && (item.mediaType === undefined || typeof item.mediaType === "string") && (item.byteRevision === undefined || typeof item.byteRevision === "string"))) throw new Error("Invalid documents")
  return createExportBundle({ projectName: value.project.name, exportedAt: value.exportedAt, workspace, wiki: value.wiki, documents: value.documents })
}

// Wiki paths overwrite existing entries. Documents skip existing source IDs:
// this format layer assumes the same source ID identifies the same bytes; it does not compare content.
export function planImport(bundle: ExportBundle, existing: { wikiPaths: readonly string[]; documentSourceIds: readonly string[] }): { wiki: { create: string[]; update: string[] }; documents: { create: string[]; skip: string[] }; memories: number; domains: number } {
  const paths = new Set(existing.wikiPaths), ids = new Set(existing.documentSourceIds)
  return {
    wiki: { create: bundle.wiki.map(item => item.path).filter(path => !paths.has(path)).sort(compare), update: bundle.wiki.map(item => item.path).filter(path => paths.has(path)).sort(compare) },
    documents: { create: bundle.documents.map(item => item.sourceId).filter(id => !ids.has(id)).sort(compare), skip: bundle.documents.map(item => item.sourceId).filter(id => ids.has(id)).sort(compare) },
    memories: bundle.workspace.memories.length, domains: bundle.workspace.domains.length,
  }
}
