/**
 * Normalize page links after an LLM merge without touching frontmatter,
 * prose paths, code examples, or Obsidian image/file embeds.
 *
 * Project schemas route pages into directories on disk, but cross-page links
 * use bare slugs. Older page bodies may still contain targets such as
 * `[[clients/foo-overview]]`; merge prompts intentionally preserve existing
 * links, so the application must repair those targets deterministically.
 */
export function stripBodyWikilinkPathPrefixes(content: string): string {
  const frontmatter = content.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)
  if (!frontmatter) return content

  const body = content.slice(frontmatter[0].length)
  if (!body.includes("[[")) return content

  const normalizedBody = normalizeWikilinksOutsideCode(body)

  return `${frontmatter[0]}${normalizedBody}`
}

function normalizeWikilinksOutsideCode(body: string): string {
  let fence: { marker: "`" | "~"; length: number } | null = null

  return body.replace(/.*(?:\r?\n|$)/g, (line) => {
    const content = line.replace(/\r?\n$/, "")
    const markerMatch = content.match(/^ {0,3}(`{3,}|~{3,})/)
    if (markerMatch) {
      const marker = markerMatch[1][0] as "`" | "~"
      const length = markerMatch[1].length
      if (!fence) fence = { marker, length }
      else if (
        marker === fence.marker &&
        length >= fence.length &&
        content.slice(markerMatch[0].length).trim() === ""
      ) {
        fence = null
      }
      return line
    }
    if (fence || /^(?: {4}|\t)/.test(content)) return line

    return replaceOutsideInlineCode(line)
  })
}

function replaceOutsideInlineCode(text: string): string {
  let output = ""
  let cursor = 0

  while (cursor < text.length) {
    const opening = text.indexOf("`", cursor)
    if (opening < 0) return output + replaceWikilinkPrefixes(text.slice(cursor))

    output += replaceWikilinkPrefixes(text.slice(cursor, opening))
    let runEnd = opening + 1
    while (text[runEnd] === "`") runEnd += 1
    const delimiter = text.slice(opening, runEnd)
    const closing = text.indexOf(delimiter, runEnd)
    if (closing < 0) {
      // An unmatched run is ordinary Markdown text, not an inline code span.
      output += replaceWikilinkPrefixes(text.slice(opening, runEnd))
      cursor = runEnd
      continue
    }

    output += text.slice(opening, closing + delimiter.length)
    cursor = closing + delimiter.length
  }

  return output
}

const PAGE_WIKILINK_RE = /\[\[([^\]|\n]+)(?:\|([^\]\n]*))?\]\]/g

function replaceWikilinkPrefixes(text: string): string {
  return text.replace(
    PAGE_WIKILINK_RE,
    (match, rawTarget: string, rawAlias: string | undefined, offset: number) => {
      if (offset > 0 && text[offset - 1] === "!") return match
      const preceding = text.slice(0, offset).match(/\\+$/)?.[0].length ?? 0
      if (preceding % 2 === 1) return match

      const target = rawTarget.trim()
      const normalizedTarget = bareWikilinkTarget(target)
      if (normalizedTarget === target) return match

      const alias = rawAlias === undefined ? "" : `|${rawAlias}`
      return `[[${normalizedTarget}${alias}]]`
    },
  )
}

function bareWikilinkTarget(target: string): string {
  if (!target || target.startsWith("#")) return target
  // URI-like targets are not wiki page paths.
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return target

  const fragmentIndex = target.indexOf("#")
  const pageTarget = fragmentIndex >= 0 ? target.slice(0, fragmentIndex) : target
  const fragment = fragmentIndex >= 0 ? target.slice(fragmentIndex) : ""
  const normalizedPath = pageTarget.replace(/\\/g, "/")
  if (!normalizedPath.includes("/")) return target

  const leaf = normalizedPath.split("/").pop()
  if (!leaf) return target
  const extensionIndex = leaf.lastIndexOf(".")
  if (extensionIndex > 0 && leaf.slice(extensionIndex).toLowerCase() !== ".md") {
    return target
  }

  return `${leaf}${fragment}`
}
