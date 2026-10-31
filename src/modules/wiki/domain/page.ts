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
/** Storage-relative Markdown paths; authorization/symlink checks belong to adapters. */
export function canonicalWikiPagePath(path: string): string {
  const normalized = path.replace(/\\/g, "/")
  if (
    !normalized.startsWith("wiki/") ||
    !/\.md$/i.test(normalized) ||
    normalized.includes("\0") ||
    normalized.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new Error("Expected a Markdown page path inside wiki/")
  return normalized
}
