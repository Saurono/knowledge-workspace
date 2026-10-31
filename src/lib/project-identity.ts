/** @deprecated Project contracts live in modules/projects; local adapters in app/projects. */
export type { ProjectIdentity, ProjectRegistryEntry, ProjectRegistry } from "@/modules/projects/domain"
export { ensureProjectId, loadRegistry, upsertProjectInfo, getProjectPathById, getProjectIdByPath } from "@/app/projects/service"
