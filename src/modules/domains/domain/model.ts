export interface DomainTag {
  id: string
  name: string
}
export interface DomainState {
  domains: DomainTag[]
  resourceDomains: Record<string, string[]>
}
export function validateDomainState(value: unknown): DomainState {
  if (!value || typeof value !== "object") throw new Error("Invalid domain state")
  const state = value as DomainState
  if (
    !Array.isArray(state.domains) ||
    !state.domains.every(
      (tag) => tag && typeof tag.id === "string" && typeof tag.name === "string",
    ) ||
    new Set(state.domains.map((tag) => tag.id)).size !== state.domains.length ||
    !state.resourceDomains ||
    typeof state.resourceDomains !== "object" ||
    Array.isArray(state.resourceDomains) ||
    !Object.values(state.resourceDomains).every(
      (ids) => Array.isArray(ids) && ids.every((id) => typeof id === "string"),
    )
  )
    throw new Error("Invalid domain records")
  return state
}
export function resourceDomainIds(state: DomainState, resourcePath: string): string[] {
  return Object.prototype.hasOwnProperty.call(state.resourceDomains, resourcePath)
    ? state.resourceDomains[resourcePath]
    : []
}
export function removeDomainTag(state: DomainState, id: string): DomainState {
  return {
    domains: state.domains.filter((tag) => tag.id !== id),
    resourceDomains: Object.fromEntries(
      Object.entries(state.resourceDomains).map(([path, ids]) => [
        path,
        ids.filter((value) => value !== id),
      ]),
    ),
  }
}
