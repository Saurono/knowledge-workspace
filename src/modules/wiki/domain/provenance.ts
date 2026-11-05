/** Stored with ingest records v1; Wiki owns page metadata, documents owns source identity. */
export interface WikiProvenance {
  createdAt: string | null
  sources: string[]
}
export type WikiProvenanceCatalog = Record<string, WikiProvenance>

/** Record a completed Wiki write. Existing files without evidence stay unknown. */
export function recordWikiWrite(
  catalog: WikiProvenanceCatalog,
  path: string,
  input: { existed: boolean; now: string; sources?: readonly string[] },
): WikiProvenanceCatalog {
  const key = path.replace(/\\/g, "/")
  const previous = catalog[key]
  return {
    ...catalog,
    [key]: {
      createdAt: previous
        ? previous.createdAt
        : input.existed
          ? null
          : input.now,
      sources: [...new Set([...(previous?.sources ?? []), ...(input.sources ?? [])])],
    },
  }
}

/** Keep the original top-level YAML created value when replacing a generated page. */
export function preserveWikiCreatedFrontmatter(previous: string, next: string): string {
  const matchBlock = (content: string) => content.match(/^(---[ \t]*\r?\n)([\s\S]*?)(\r?\n---[ \t]*(?:\r?\n|$))/)
  const oldMatch = matchBlock(previous)
  const nextMatch = matchBlock(next)
  if (!nextMatch) return next
  const findCreated = (payload: string) => {
    const lines = payload.split(/\r?\n/)
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]
      if (/^\s/.test(line)) continue
      if (/^created[ \t]*:/.test(line)) {
        let end = index + 1
        while (end < lines.length && (/^[ \t]+/.test(lines[end]) || lines[end] === "")) end += 1
        return { start: index, end, lines: lines.slice(index, end) }
      }
      if (/^[^#\s][^:]*[ \t]*:[ \t]*[|>][+-]?[0-9]?[ \t]*$/.test(line)) {
        index += 1
        while (index < lines.length && (/^[ \t]+/.test(lines[index]) || lines[index] === "")) index += 1
        index -= 1
      }
    }
    return undefined
  }
  const oldCreated = oldMatch ? findCreated(oldMatch[2]) : undefined
  const nextLines = nextMatch[2].split(/\r?\n/)
  const nextCreated = findCreated(nextMatch[2])
  if (nextCreated) nextLines.splice(nextCreated.start, nextCreated.end - nextCreated.start)
  if (oldCreated) nextLines.push(...oldCreated.lines)
  const protectedPayload = nextLines.join("\n")
  return `${nextMatch[1]}${protectedPayload}${nextMatch[3]}${next.slice(nextMatch[0].length)}`
}
export function recordWikiProvenance(
  catalog: WikiProvenanceCatalog,
  paths: readonly string[],
  source: string,
  createdPages: Readonly<Record<string, string>>,
): WikiProvenanceCatalog {
  const result = { ...catalog }
  for (const path of paths) {
    const key = path.replace(/\\/g, "/")
    const previous = result[key]
    result[key] = {
      createdAt: previous?.createdAt ?? (previous ? null : createdPages[key] ?? null),
      sources: [...new Set([...(previous?.sources ?? []), source])],
    }
  }
  return result
}
export function moveWikiProvenance(
  catalog: WikiProvenanceCatalog,
  fromSource: string,
  toSource: string,
  moves: ReadonlyMap<string, string>,
): WikiProvenanceCatalog {
  const result = Object.fromEntries(Object.entries(catalog).map(([path, page]) => [path, {
    ...page,
    sources: [...new Set(page.sources.map(key => key === fromSource ? toSource : key))],
  }]))
  for (const [from, to] of moves) {
    if (from === to || !result[from]) continue
    const previous = result[from], next = result[to]
    result[to] = {
      // A destination timestamp is not evidence for the moved source page.
      createdAt: previous.createdAt,
      sources: [...new Set([...previous.sources, ...(next?.sources ?? [])])],
    }
    delete result[from]
  }
  return result
}
