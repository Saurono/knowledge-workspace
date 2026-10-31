import { normalizeRetrievalPath as normalizePath } from "./model"
export function looksLikeOversizeError(httpStatus: number, body: string): boolean {
  if (httpStatus === 413) return true
  const lower = body.toLowerCase()
  return (
    lower.includes("too long") ||
    lower.includes("maximum context") ||
    lower.includes("max_tokens") ||
    lower.includes("max tokens") ||
    lower.includes("context length") ||
    lower.includes("token limit") ||
    lower.includes("exceeds") ||
    lower.includes("input length")
  )
}

export function wikiPageIdFromPath(projectPath: string, pagePath: string): string {
  const pp = normalizePath(projectPath).replace(/\/$/, "")
  let normalized = normalizePath(pagePath)
  const absoluteWikiPrefix = `${pp}/wiki/`
  if (normalized.startsWith(absoluteWikiPrefix)) {
    normalized = normalized.slice(absoluteWikiPrefix.length)
  } else if (normalized.startsWith("wiki/")) {
    normalized = normalized.slice("wiki/".length)
  } else if (normalized.includes("/")) {
    return ""
  }
  return normalized.replace(/^\/+/, "").replace(/\.md$/i, "")
}
