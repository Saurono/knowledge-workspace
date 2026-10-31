/** Stored with ingest records v1; Wiki owns page metadata, documents owns source identity. */
export interface WikiProvenance {
  createdAt: string | null
  sources: string[]
}
export type WikiProvenanceCatalog = Record<string, WikiProvenance>
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
      createdAt: previous.createdAt ?? next?.createdAt ?? null,
      sources: [...new Set([...previous.sources, ...(next?.sources ?? [])])],
    }
    delete result[from]
  }
  return result
}
