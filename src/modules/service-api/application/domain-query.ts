import type { DomainFilter } from "@/modules/domains/domain"
import { ServiceError } from "../domain"

function invalid(message: string): never {
  throw new ServiceError("invalid_argument", message)
}

/** Parse the repeated query-string form shared by Wiki and document lists. */
export function domainFilterFromQuery(params: URLSearchParams): DomainFilter | undefined {
  const ids = params.getAll("domainId")
  const modes = params.getAll("domainMatch")
  const unclassifiedValues = params.getAll("unclassified")
  if (!ids.length && !modes.length && !unclassifiedValues.length) return undefined
  if (ids.some((id) => !id)) return invalid("domainId cannot be empty")
  if (modes.length > 1 || unclassifiedValues.length > 1) return invalid("Domain filter options may only appear once")
  const match = modes[0] ?? "any"
  if (match !== "any" && match !== "all") return invalid("domainMatch must be any or all")
  const flag = unclassifiedValues[0] ?? "0"
  if (flag !== "0" && flag !== "1") return invalid("unclassified must be 0 or 1")
  if (flag === "1" && ids.length) return invalid("unclassified cannot be combined with domainId")
  return { domainIds: ids, match, unclassified: flag === "1" }
}

/** Parse the object form used by resource tools and keyword search. */
export function domainFilterFromInput(value: unknown): DomainFilter | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid("domainFilter must be an object")
  const candidate = value as Partial<DomainFilter>
  if (!Array.isArray(candidate.domainIds) || candidate.domainIds.some((id) => typeof id !== "string") ||
      (candidate.match !== "any" && candidate.match !== "all") || typeof candidate.unclassified !== "boolean")
    return invalid("Invalid domainFilter")
  if (candidate.unclassified && candidate.domainIds.length) return invalid("unclassified cannot be combined with domainIds")
  return { domainIds: candidate.domainIds, match: candidate.match, unclassified: candidate.unclassified }
}

export function appendDomainFilterQuery(query: string, filter?: DomainFilter): string {
  if (!filter) return query
  if (!Array.isArray(filter.domainIds) || filter.domainIds.some((id) => typeof id !== "string" || !id) ||
      (filter.match !== "any" && filter.match !== "all") || typeof filter.unclassified !== "boolean" ||
      (filter.unclassified && filter.domainIds.length))
    return invalid("Invalid domain filter")
  const params = new URLSearchParams(query.replace(/^\?/, ""))
  params.delete("domainId")
  params.delete("domainMatch")
  params.delete("unclassified")
  for (const id of [...new Set(filter.domainIds)].sort()) params.append("domainId", id)
  params.set("domainMatch", filter.match)
  params.set("unclassified", filter.unclassified ? "1" : "0")
  return `?${params.toString()}`
}
