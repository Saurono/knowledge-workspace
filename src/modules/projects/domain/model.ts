export interface WikiProject {
  id: string
  name: string
  path: string
}
export interface ProjectIdentity {
  id: string
  createdAt: number
}
export interface ProjectRegistryEntry extends WikiProject {
  lastOpened: number
}
export type ProjectRegistry = Record<string, ProjectRegistryEntry>
export interface ProjectPreferences {
  recent: WikiProject[]
  last: WikiProject | null
}

export function rememberProject(
  state: ProjectPreferences,
  project: WikiProject,
): ProjectPreferences {
  return {
    ...state,
    recent: [project, ...state.recent.filter((item) => item.path !== project.path)].slice(0, 10),
  }
}
export function forgetProject(state: ProjectPreferences, path: string): ProjectPreferences {
  return {
    recent: state.recent.filter((item) => item.path !== path),
    last: state.last?.path === path ? null : state.last,
  }
}
