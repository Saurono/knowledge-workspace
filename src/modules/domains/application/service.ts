import {
  removeDomainTag,
  resourceDomainIds,
  validateDomainState,
  type DomainState,
  type DomainTag,
} from "../domain/model"
import { canonicalDomainResourceKey } from "../domain/classification"
export interface DomainRepository {
  read(projectPath: string): Promise<DomainState>
  update(projectPath: string, change: (state: DomainState) => DomainState): Promise<DomainState>
}
export function createDomainService(repository: DomainRepository) {
  return {
    list: (path: string) => repository.read(path),
    add: (path: string, tag: DomainTag) =>
      repository.update(path, (state) => {
        const name = tag.name.trim()
        if (!name || !tag.id.trim()) throw new Error("Domain ID and name are required")
        if (
          state.domains.some(
            (existing) =>
              existing.id === tag.id ||
              existing.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
          )
        )
          throw new Error("Domain already exists")
        return validateDomainState({ ...state, domains: [...state.domains, { id: tag.id, name }] })
      }),
    toggle: (path: string, resourcePath: string, domainId: string) =>
      repository.update(path, (state) => {
        if (!resourcePath.trim() || !state.domains.some((domain) => domain.id === domainId))
          throw new Error("Unknown domain or resource")
        const ids = resourceDomainIds(state, resourcePath)
        return {
          ...state,
          resourceDomains: {
            ...state.resourceDomains,
            [resourcePath]: ids.includes(domainId)
              ? ids.filter((id) => id !== domainId)
              : [...ids, domainId],
          },
        }
      }),
    setResourceDomains: (
      path: string,
      canonicalKey: string,
      ids: readonly string[],
      // The caller supplies legacy keys only when it has proved they refer to
      // this same source. Assignment writes the canonical key; it never deletes
      // or consumes those historical mappings.
      legacyKeys: readonly string[] = [],
    ) => repository.update(path, (state) => {
      if (typeof canonicalKey !== "string")
        throw Object.assign(new Error("Invalid canonical domain resource assignment"), { code: "invalid_argument" })
      const isWiki = canonicalKey.startsWith("wiki/")
      const isDocument = canonicalKey.startsWith("raw/documents/")
      const validatedKey = isWiki
        ? canonicalDomainResourceKey("wiki", canonicalKey)
        : isDocument
          ? canonicalDomainResourceKey("document", canonicalKey.slice("raw/documents/".length))
          : ""
      if (!validatedKey || validatedKey !== canonicalKey || !Array.isArray(ids) || !Array.isArray(legacyKeys))
        throw Object.assign(new Error("Invalid canonical domain resource assignment"), { code: "invalid_argument" })
      const uniqueIds = [...new Set(ids)]
      if (uniqueIds.some((id) => typeof id !== "string" || !state.domains.some((domain) => domain.id === id)))
        throw Object.assign(new Error("Unknown domain assignment"), { code: "invalid_argument" })
      if (legacyKeys.some((key) => typeof key !== "string" || !key.trim()))
        throw Object.assign(new Error("Invalid legacy domain resource key"), { code: "invalid_argument" })
      return {
        ...state,
        resourceDomains: { ...state.resourceDomains, [canonicalKey]: uniqueIds },
      }
    }),
    remove: (path: string, id: string) =>
      repository.update(path, (state) => removeDomainTag(state, id)),
  }
}
export type DomainService = ReturnType<typeof createDomainService>
