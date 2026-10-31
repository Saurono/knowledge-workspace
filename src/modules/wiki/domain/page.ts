export interface WikiPage {
  path: string
  content: string
  frontmatter: Record<string, unknown>
}
export interface WikiTextPage {
  path: string
  content: string
  revision: string
}
export class WikiRevisionConflict extends Error {
  constructor(
    public readonly path: string,
    public readonly expectedRevision: string | null,
    public readonly actualRevision: string | null,
  ) {
    super(`Wiki page changed since it was read: ${path}`)
    this.name = "WikiRevisionConflict"
  }
}
/** Wiki storage paths may include non-Markdown outputs used by legacy generators. */
export function canonicalWikiStoragePath(path: string): string {
  const normalized = path.replace(/\\/g, "/")
  if (
    !normalized.startsWith("wiki/") ||
    normalized.includes("\0") ||
    normalized.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new Error("Expected a storage path inside wiki/")
  return normalized
}
/** Storage-relative Markdown paths; authorization/symlink checks belong to adapters. */
export function canonicalWikiPagePath(path: string): string {
  const canonical = canonicalWikiStoragePath(path)
  if (!/\.md$/i.test(canonical)) throw new Error("Expected a Markdown page path inside wiki/")
  return canonical
}
