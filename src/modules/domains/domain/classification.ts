import type { DomainState } from "./model"

export type DomainResourceKind = "wiki" | "document"

export interface DomainFilter {
  domainIds: string[]
  match: "any" | "all"
  unclassified: boolean
}

function invalid(message: string): never {
  throw Object.assign(new Error(message), { code: "invalid_argument" as const })
}

/** Validate and return the canonical workspace key for a Wiki page or source. */
export function canonicalDomainResourceKey(kind: DomainResourceKind, identity: string): string {
  if (typeof identity !== "string" || !identity || identity.includes("\0"))
    return invalid("Invalid domain resource identity")

  if (kind === "wiki") {
    const path = identity.replace(/\\/g, "/")
    if (
      !path.startsWith("wiki/") ||
      path.startsWith("/") ||
      /^[A-Za-z]:/.test(path) ||
      /[\x00-\x1f\x7f]/.test(path) ||
      path.split("/").some((part) => !part || part === "." || part === "..")
    ) return invalid("Expected a relative Wiki resource path inside wiki/")
    return path
  }

  if (kind === "document") {
    if (
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(identity)
    ) return invalid("Invalid stable document source ID")
    return `raw/documents/${identity}`
  }
  return invalid("Unknown domain resource kind")
}

export function normalizeDomainFilter(
  state: DomainState,
  input: DomainFilter,
): DomainFilter {
  if (!input || !Array.isArray(input.domainIds) ||
      (input.match !== "any" && input.match !== "all") ||
      typeof input.unclassified !== "boolean")
    return invalid("Invalid domain filter")
  const ids = [...new Set(input.domainIds)]
  if (!ids.every((id) => typeof id === "string" && id.length > 0))
    return invalid("Invalid domain filter IDs")
  if (input.unclassified && ids.length > 0)
    return invalid("Unclassified cannot be combined with domain IDs")
  const known = new Set(state.domains.map((domain) => domain.id))
  if (ids.some((id) => !known.has(id))) return invalid("Unknown domain filter ID")
  return { domainIds: ids.sort(), match: input.match, unclassified: input.unclassified }
}

/** Effective valid assignments, using only caller-proven same-source legacy keys. */
export function effectiveDomainIds(
  state: DomainState,
  canonicalKey: string,
  legacyKeys: readonly string[] = [],
): string[] {
  const canonicalOwn = Object.prototype.hasOwnProperty.call(state.resourceDomains, canonicalKey)
  const selected = canonicalOwn
    ? [state.resourceDomains[canonicalKey]]
    : [canonicalKey, ...legacyKeys]
        .filter((key) => Object.prototype.hasOwnProperty.call(state.resourceDomains, key))
        .map((key) => state.resourceDomains[key])
  const known = new Set(state.domains.map((domain) => domain.id))
  return [...new Set(selected.flat().filter((id) => known.has(id)))].sort()
}

export function filterMatches(
  state: DomainState,
  resourceKey: string,
  filter: DomainFilter,
  legacyKeys: readonly string[] = [],
): boolean {
  const normalized = normalizeDomainFilter(state, filter)
  if (!normalized.domainIds.length && !normalized.unclassified) return true
  const assigned = effectiveDomainIds(state, resourceKey, legacyKeys)
  if (normalized.unclassified) return assigned.length === 0
  const matches = normalized.domainIds.filter((id) => assigned.includes(id)).length
  return normalized.match === "all" ? matches === normalized.domainIds.length : matches > 0
}
