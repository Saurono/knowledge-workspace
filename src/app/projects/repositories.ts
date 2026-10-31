import { load } from "@tauri-apps/plugin-store"
import { readFile, writeFileAtomic } from "@/commands/fs"
import { withProjectLock } from "@/lib/project-mutex"
import type {
  ProjectIdentityRepository,
  ProjectRegistryRepository,
  ProjectPreferencesRepository,
} from "@/modules/projects/application"
import type { ProjectIdentity, ProjectRegistry, WikiProject } from "@/modules/projects/domain"
const store = () => load("app-state.json", { autoSave: true, defaults: {} })

export const localProjectIdentities: ProjectIdentityRepository = {
  ensure: (path, create) =>
    withProjectLock(`project-identity\0${path}`, async () => {
      const file = `${path}/.llm-wiki/project.json`
      try {
        const identity = JSON.parse(await readFile(file)) as ProjectIdentity
        if (identity?.id && typeof identity.id === "string") return identity
      } catch {
        /* v1 missing/corrupt identity: initialize as before */
      }
      const identity = create()
      // Never return a newly invented identity when it could not be persisted.
      await writeFileAtomic(file, JSON.stringify(identity, null, 2))
      return identity
    }),
}
let registryWrite: Promise<void> = Promise.resolve()
export const localProjectRegistry: ProjectRegistryRepository = {
  read: async () => {
    try {
      return (await (await store()).get<ProjectRegistry>("projectRegistry")) ?? {}
    } catch {
      return {}
    }
  },
  update: (change) => {
    const operation = registryWrite.then(async () => {
      const current = await store()
      const registry = (await current.get<ProjectRegistry>("projectRegistry")) ?? {}
      await current.set("projectRegistry", change(registry))
    })
    registryWrite = operation.catch(() => {})
    return operation
  },
}
let preferencesWrite: Promise<void> = Promise.resolve()
export const localProjectPreferences: ProjectPreferencesRepository = {
  read: async () => {
    const current = await store()
    return {
      recent: (await current.get<WikiProject[]>("recentProjects")) ?? [],
      last: (await current.get<WikiProject>("lastProject")) ?? null,
    }
  },
  update: (change) => {
    const operation = preferencesWrite.then(async () => {
      const current = await store()
      const recent = (await current.get<WikiProject[]>("recentProjects")) ?? []
      const last = (await current.get<WikiProject>("lastProject")) ?? null
      const updated = change({ recent, last })
      await current.set("recentProjects", updated.recent)
      if (updated.last !== last) {
        if (updated.last) await current.set("lastProject", updated.last)
        else await current.delete("lastProject")
      }
    })
    preferencesWrite = operation.catch(() => {})
    return operation
  },
}
