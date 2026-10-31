import { createProjectService } from "@/modules/projects/application"
import { normalizePath } from "@/lib/path-utils"
import {
  localProjectIdentities,
  localProjectRegistry,
  localProjectPreferences,
} from "./repositories"
export const projects = createProjectService({
  identities: localProjectIdentities,
  registry: localProjectRegistry,
  preferences: localProjectPreferences,
  normalizePath,
  now: () => Date.now(),
  createId: () => crypto.randomUUID(),
})
export const {
  ensureProjectId,
  loadRegistry,
  upsertProjectInfo,
  getProjectPathById,
  getProjectIdByPath,
  getRecentProjects,
  getLastProject,
  addToRecentProjects,
  saveLastProject,
  removeFromRecentProjects,
} = projects
