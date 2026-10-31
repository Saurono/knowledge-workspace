export * from "@/app/settings/configuration"
export type { PersistedUpdateCheckState } from "@/modules/settings/domain"
export { getRecentProjects, getLastProject, saveLastProject, addToRecentProjects, removeFromRecentProjects } from "@/app/projects/service"
