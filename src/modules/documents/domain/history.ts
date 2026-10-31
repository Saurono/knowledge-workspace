export interface FileHistoryEntry {
  id: string
  path: string
  timestamp: number
  author: string
  tool: string
  content: string
}
/** Relative project paths are transport-neutral; native adapters also enforce filesystem scope. */
export function canonicalDocumentPath(path: string): string {
  const normalized = path.replace(/\\/g, "/")
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:/.test(normalized) ||
    normalized.includes("\0") ||
    normalized.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new Error("Expected a relative file path inside the project")
  return normalized
}
