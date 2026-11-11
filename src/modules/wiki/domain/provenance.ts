
/** Stored with ingest records v1; absent authorship is a legacy unknown. */
export type WikiAuthorKind = "user" | "agent" | "system"
export interface WikiActor {
  kind: WikiAuthorKind
  /** Local actor IDs are execution labels, never shared account IDs. */
  id: string
  principalKind?: "user" | "agent" | "admin"
  effectivePrincipalId?: string
  workRoleId?: string
  entrypoint: string
  taskId?: string
  reason?: string
}
export interface WikiBodyRevision {
  revision: number
  contentHash: string
  actor: WikiActor
  originKinds: WikiAuthorKind[]
  createdAt: string
  sourceRefs: string[]
  evidenceRefs: string[]
}
export interface WikiReviewEvent {
  actor: WikiActor
  reviewedRevision: number
  createdAt: string
  decision: "approved" | "rejected" | "commented"
  reason?: string
}
export interface WikiProvenance {
  createdAt: string | null
  sources: string[]
  /** Missing means legacy/unknown. New fields remain optional for v1 compatibility. */
  creator?: WikiActor
  revisions?: WikiBodyRevision[]
  reviews?: WikiReviewEvent[]
  currentContentHash?: string
}
export type WikiProvenanceCatalog = Record<string, WikiProvenance>

export interface WikiWriteAttribution {
  actor: WikiActor
  sourceRefs?: readonly string[]
  evidenceRefs?: readonly string[]
  /** Set only for verified internal system transformations. */
  metadataOnly?: boolean
}

const unique = (items: readonly string[] = []) => [...new Set(items)]
const actorIsValid = (value: unknown): value is WikiActor => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const actor = value as Record<string, unknown>
  return ["user", "agent", "system"].includes(String(actor.kind)) && typeof actor.id === "string" && actor.id.length > 0 &&
    typeof actor.entrypoint === "string" && actor.entrypoint.length > 0 &&
    (actor.principalKind === undefined || ["user", "agent", "admin"].includes(String(actor.principalKind))) &&
    (actor.effectivePrincipalId === undefined || typeof actor.effectivePrincipalId === "string") &&
    (actor.workRoleId === undefined || typeof actor.workRoleId === "string") &&
    (actor.taskId === undefined || typeof actor.taskId === "string") &&
    (actor.reason === undefined || typeof actor.reason === "string")
}
export function isWikiProvenance(value: unknown): value is WikiProvenance {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const page = value as Record<string, unknown>
  if (!(page.createdAt === undefined || page.createdAt === null || typeof page.createdAt === "string") || !Array.isArray(page.sources) || !page.sources.every(item => typeof item === "string")) return false
  if (page.creator !== undefined && !actorIsValid(page.creator)) return false
  if (page.currentContentHash !== undefined && (typeof page.currentContentHash !== "string" || !/^[a-f0-9]{64}$/.test(page.currentContentHash))) return false
  if (page.revisions !== undefined) {
    if (!Array.isArray(page.revisions)) return false
    let expectedRevision = 1
    for (const value of page.revisions) {
      if (!value || typeof value !== "object" || Array.isArray(value)) return false
      const revision = value as Record<string, unknown>
      if (revision.revision !== expectedRevision++ || typeof revision.contentHash !== "string" || !/^[a-f0-9]{64}$/.test(revision.contentHash) ||
          !actorIsValid(revision.actor) || typeof revision.createdAt !== "string" || !Array.isArray(revision.originKinds) ||
          !revision.originKinds.length || !revision.originKinds.every(kind => ["user", "agent", "system"].includes(String(kind))) ||
          !revision.originKinds.includes((revision.actor as WikiActor).kind) || !Array.isArray(revision.sourceRefs) || !revision.sourceRefs.every(ref => typeof ref === "string" && !!ref && !/[\u0000-\u001f\u007f]/.test(ref)) ||
          !Array.isArray(revision.evidenceRefs) || !revision.evidenceRefs.every(ref => typeof ref === "string" && !!ref && !/[\u0000-\u001f\u007f]/.test(ref))) return false
    }
    if (page.revisions.length && page.currentContentHash !== page.revisions[page.revisions.length - 1]?.contentHash) return false
  }
  if (page.reviews !== undefined) {
    if (!Array.isArray(page.reviews)) return false
    for (const value of page.reviews) {
      if (!value || typeof value !== "object" || Array.isArray(value)) return false
      const review = value as Record<string, unknown>
      if (!actorIsValid(review.actor) || !Number.isSafeInteger(review.reviewedRevision) || (review.reviewedRevision as number) < 1 || typeof review.createdAt !== "string" ||
          !["approved", "rejected", "commented"].includes(String(review.decision)) || (review.reason !== undefined && typeof review.reason !== "string")) return false
    }
  }
  return true
}

/** Record a completed body write. Same-content and metadata-only operations add no contribution. */
export function recordWikiWrite(
  catalog: WikiProvenanceCatalog,
  path: string,
  input: { existed: boolean; now: string; contentHash?: string; sources?: readonly string[]; attribution?: WikiWriteAttribution },
): WikiProvenanceCatalog {
  const key = path.replace(/\\/g, "/")
  const previous = catalog[key]
  const contentHash = input.contentHash
  const changedBody = !input.attribution?.metadataOnly && !!contentHash && contentHash !== previous?.currentContentHash
  const firstCreate = !previous
  const revisions = [...(previous?.revisions ?? [])]
  let creator = previous?.creator
  if (changedBody && input.attribution) {
    const entry: WikiBodyRevision = {
      revision: (revisions[revisions.length - 1]?.revision ?? 0) + 1,
      contentHash: contentHash!,
      actor: input.attribution.actor,
      originKinds: unique([...(revisions[revisions.length - 1]?.originKinds ?? []), input.attribution.actor.kind]) as WikiAuthorKind[],
      createdAt: input.now,
      sourceRefs: unique(input.attribution.sourceRefs),
      evidenceRefs: unique(input.attribution.evidenceRefs),
    }
    revisions.push(entry)
    if (!creator && firstCreate && !input.existed) creator = input.attribution.actor
  }
  return {
    ...catalog,
    [key]: {
      ...previous,
      createdAt: previous ? previous.createdAt : input.existed ? null : input.now,
      sources: unique([...(previous?.sources ?? []), ...(input.sources ?? [])]),
      ...(creator ? { creator } : previous?.creator ? { creator: previous.creator } : {}),
      ...(previous?.revisions || revisions.length ? { revisions } : {}),
      ...(previous?.reviews ? { reviews: previous.reviews } : {}),
      ...(changedBody && contentHash ? { currentContentHash: contentHash } : previous?.currentContentHash ? { currentContentHash: previous.currentContentHash } : {}),
    },
  }
}

export function recordWikiReview(catalog: WikiProvenanceCatalog, path: string, event: WikiReviewEvent): WikiProvenanceCatalog {
  const key = path.replace(/\\/g, "/")
  const previous = catalog[key]
  if (!previous) return catalog
  return { ...catalog, [key]: { ...previous, reviews: [...(previous.reviews ?? []), event] } }
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
    result[key] = { ...previous, createdAt: previous?.createdAt ?? (previous ? null : createdPages[key] ?? null), sources: unique([...(previous?.sources ?? []), source]) }
  }
  return result
}
export function moveWikiProvenance(catalog: WikiProvenanceCatalog, fromSource: string, toSource: string, moves: ReadonlyMap<string, string>): WikiProvenanceCatalog {
  const result = Object.fromEntries(Object.entries(catalog).map(([path, page]) => [path, { ...page, sources: unique(page.sources.map(key => key === fromSource ? toSource : key)) }])) as WikiProvenanceCatalog
  for (const [from, to] of moves) {
    if (from === to || !result[from]) continue
    const previous = result[from], next = result[to]
    const revisions = [...(previous.revisions ?? []), ...(next?.revisions ?? [])]
      .filter((item, index, all) => all.findIndex(other => other.contentHash === item.contentHash && other.actor.kind === item.actor.kind && other.actor.id === item.actor.id) === index)
      .map((item, index) => ({ ...item, revision: index + 1 }))
    result[to] = {
      ...previous,
      createdAt: previous.createdAt,
      sources: unique([...previous.sources, ...(next?.sources ?? [])]),
      ...(previous.creator || next?.creator ? { creator: previous.creator ?? next?.creator } : {}),
      ...(revisions.length ? { revisions } : {}),
      ...((previous.reviews?.length || next?.reviews?.length) ? { reviews: [...(previous.reviews ?? []), ...(next?.reviews ?? [])] } : {}),
      ...(previous.currentContentHash || next?.currentContentHash ? { currentContentHash: previous.currentContentHash ?? next?.currentContentHash } : {}),
    }
    delete result[from]
  }
  return result
}
