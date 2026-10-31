import {
  removeDomainTag,
  resourceDomainIds,
  validateDomainState,
  type DomainState,
  type DomainTag,
} from "../domain/model"
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
    remove: (path: string, id: string) =>
      repository.update(path, (state) => removeDomainTag(state, id)),
  }
}
export type DomainService = ReturnType<typeof createDomainService>
