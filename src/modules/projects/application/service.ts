import {
  rememberProject,
  forgetProject,
  type ProjectIdentity,
  type ProjectRegistry,
  type ProjectPreferences,
  type WikiProject,
} from "../domain"
export interface ProjectIdentityRepository {
  /** Ensure one durable identity under a repository-owned concurrency guard. */
  ensure(path: string, create: () => ProjectIdentity): Promise<ProjectIdentity>
}
export interface ProjectRegistryRepository {
  read(): Promise<ProjectRegistry>
  update(change: (registry: ProjectRegistry) => ProjectRegistry): Promise<void>
}
export interface ProjectPreferencesRepository {
  read(): Promise<ProjectPreferences>
  update(change: (state: ProjectPreferences) => ProjectPreferences): Promise<void>
}
export interface ProjectServicePorts {
  identities: ProjectIdentityRepository
  registry: ProjectRegistryRepository
  preferences: ProjectPreferencesRepository
  normalizePath(path: string): string
  now(): number
  createId(): string
}
export function createProjectService(ports: ProjectServicePorts) {
  const normalize = (project: WikiProject) => ({
    ...project,
    path: ports.normalizePath(project.path),
  })
  const normalizePreferences = (state: ProjectPreferences) => ({
    recent: state.recent.map(normalize),
    last: state.last ? normalize(state.last) : null,
  })
  return {
    ensureProjectId: async (path: string) =>
      (
        await ports.identities.ensure(ports.normalizePath(path), () => ({
          id: ports.createId(),
          createdAt: ports.now(),
        }))
      ).id,
    loadRegistry: () => ports.registry.read(),
    upsertProjectInfo: (id: string, path: string, name: string) =>
      ports.registry.update((registry) => ({
        ...registry,
        [id]: { id, path: ports.normalizePath(path), name, lastOpened: ports.now() },
      })),
    getProjectPathById: async (id: string) => {
      const registry = await ports.registry.read()
      return Object.prototype.hasOwnProperty.call(registry, id) ? registry[id].path : null
    },
    getProjectIdByPath: async (path: string) => {
      const normalized = ports.normalizePath(path)
      return (
        Object.values(await ports.registry.read()).find(
          (entry) => ports.normalizePath(entry.path) === normalized,
        )?.id ?? null
      )
    },
    getRecentProjects: async () => (await ports.preferences.read()).recent,
    getLastProject: async () => (await ports.preferences.read()).last,
    addToRecentProjects: (project: WikiProject) =>
      ports.preferences.update((state) =>
        rememberProject(normalizePreferences(state), normalize(project)),
      ),
    saveLastProject: (project: WikiProject) =>
      ports.preferences.update((state) => ({
        ...rememberProject(normalizePreferences(state), normalize(project)),
        last: normalize(project),
      })),
    removeFromRecentProjects: (path: string) =>
      ports.preferences.update((state) =>
        forgetProject(normalizePreferences(state), ports.normalizePath(path)),
      ),
  }
}
