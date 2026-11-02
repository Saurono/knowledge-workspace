export interface SourceProvenance {
  id: string
  originalPath: string | null
  receivedAt: string | null
  ingestedAt: string | null
  /** Last source content revision captured as SHA-256 of UTF-8 parser input. */
  contentRevision?: string | null
}
export type SourceCatalog = Record<string, SourceProvenance>
export interface DocumentRevision {
  sourceId: string
  revision: string
  firstIngestedAt: string | null
  recordedAt: string
  taskId: string
  outputPaths: string[]
  idempotencyKey?: string
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

/** Reserve a stable identity before an external copy; reservation is not receipt. */
export function reserveSource(
  catalog: SourceCatalog,
  path: string,
  originalPath: string,
  context: { createId(): string },
): SourceCatalog {
  const key = normalizeSourceKey(path)
  const existing = sourceAt(catalog, key)
  if (existing) {
    const original = normalizeSourceKey(originalPath)
    if ((!existing.originalPath || existing.originalPath === key) && original !== key)
      return { ...catalog, [key]: { ...existing, originalPath: original } }
    return catalog
  }
  return { ...catalog, [key]: { id: context.createId(), originalPath: normalizeSourceKey(originalPath), receivedAt: null, ingestedAt: null } }
}

/** Confirm a successful copy once, preserving the first received timestamp. */
export function confirmSourceReceived(catalog: SourceCatalog, path: string, now: string): SourceCatalog {
  const key = normalizeSourceKey(path)
  const previous = sourceAt(catalog, key)
  if (!previous) throw new Error("Cannot confirm an unreserved source")
  if (previous.receivedAt !== null) return catalog
  return { ...catalog, [key]: { ...previous, receivedAt: now } }
}

/** Finds an already imported logical source by its exact external origin. */
export function sourcePathForOrigin(catalog: SourceCatalog, originalPath: string): string | null {
  const origin = normalizeSourceKey(originalPath)
  return Object.entries(catalog).find(([, source]) =>
    source.originalPath !== null && normalizeSourceKey(source.originalPath) === origin,
  )?.[0] ?? null
}

export function setSourceContentRevision(
  catalog: SourceCatalog,
  path: string,
  revision: string,
): SourceCatalog {
  const key = normalizeSourceKey(path)
  const previous = sourceAt(catalog, key)
  if (!previous) throw new Error("Cannot revise an unregistered source")
  if (!/^[a-f0-9]{64}$/.test(revision)) throw new Error("Invalid SHA-256 source revision")
  if (previous.contentRevision === revision) return catalog
  return { ...catalog, [key]: { ...previous, contentRevision: revision } }
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
