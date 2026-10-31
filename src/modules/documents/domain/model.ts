export interface SourceProvenance {
  id: string
  originalPath: string | null
  receivedAt: string | null
  ingestedAt: string | null
}
export type SourceCatalog = Record<string, SourceProvenance>
export interface DocumentRevision {
  sourceId: string
  revision: string
  firstIngestedAt: string | null
  recordedAt: string
  taskId: string
  outputPaths: string[]
}
export const normalizeSourceKey = (path: string) => path.replace(/\\/g, "/")
function sourceAt(catalog: SourceCatalog, key: string): SourceProvenance | undefined {
  return Object.prototype.hasOwnProperty.call(catalog, key) ? catalog[key] : undefined
}
export function registerSource(
  catalog: SourceCatalog,
  path: string,
  originalPath: string,
  context: { createId(): string; now: string },
): SourceCatalog {
  const key = normalizeSourceKey(path)
  const existing = sourceAt(catalog, key)
  if (existing) {
    const original = normalizeSourceKey(originalPath)
    // A watcher can observe the local copy before its importing connector.
    // Enrich an unknown/self location, but never overwrite a known origin.
    if ((!existing.originalPath || existing.originalPath === key) && original !== key)
      return { ...catalog, [key]: { ...existing, originalPath: original } }
    return catalog
  }
  return {
    ...catalog,
    [key]: {
      id: context.createId(),
      originalPath: normalizeSourceKey(originalPath),
      receivedAt: context.now,
      ingestedAt: null,
    },
  }
}
export function recordSourceIngested(
  catalog: SourceCatalog,
  path: string,
  context: { createId(): string; now: string; cacheHit: boolean },
): { catalog: SourceCatalog; source: SourceProvenance } {
  const key = normalizeSourceKey(path)
  const previous = sourceAt(catalog, key)
  const source = {
    ...(previous ?? {
      id: context.createId(),
      originalPath: null,
      receivedAt: null,
      ingestedAt: null,
    }),
  }
  if (!context.cacheHit) source.ingestedAt ??= context.now
  return { catalog: { ...catalog, [key]: source }, source }
}

/** Only call after the caller has established content identity for a move. */
export function moveSourceKey(catalog: SourceCatalog, from: string, to: string): SourceCatalog {
  const previous = normalizeSourceKey(from),
    next = normalizeSourceKey(to)
  const source = sourceAt(catalog, previous)
  if (previous === next || !source) return catalog
  const destination = sourceAt(catalog, next)
  if (destination && destination.id !== source.id)
    throw new Error("Cannot replace another source identity during a move")
  const updated = { ...catalog, [next]: source }
  delete updated[previous]
  return updated
}
