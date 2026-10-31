import { create } from "zustand"
import {
  emptyWorkspaceData,
  loadWorkspaceData,
  updateWorkspaceData,
  executeWorkspaceCommand,
  type WorkspaceCommand,
  type WorkspaceData,
} from "@/app/workspace"
interface WorkspaceState {
  projectPath: string | null
  data: WorkspaceData
  loading: boolean
  saving: boolean
  error: string | null
  reset: () => void
  load: (path: string) => Promise<void>
  /** Compatibility for existing preview and migration callers; feature UIs use perform. */
  update: (path: string, change: (data: WorkspaceData) => WorkspaceData) => Promise<boolean>
  perform: (path: string, command: WorkspaceCommand) => Promise<boolean>
}
let loadVersion = 0
export const useWorkspaceStore = create<WorkspaceState>((set, get) => {
  const persist = async (
    path: string,
    operation: () => Promise<WorkspaceData>,
  ): Promise<boolean> => {
    if (get().projectPath !== path || get().loading || get().saving || get().error) return false
    const version = loadVersion
    set({ saving: true })
    try {
      const data = await operation()
      if (version !== loadVersion || get().projectPath !== path) return false
      set({ data, saving: false })
      return true
    } catch (error) {
      if (version === loadVersion && get().projectPath === path)
        set({ saving: false, error: String(error) })
      return false
    }
  }
  return {
    projectPath: null,
    data: emptyWorkspaceData(),
    loading: false,
    saving: false,
    error: null,
    reset: () => {
      ++loadVersion
      set({
        projectPath: null,
        data: emptyWorkspaceData(),
        loading: false,
        saving: false,
        error: null,
      })
    },
    load: async (path) => {
      const version = ++loadVersion
      set({
        projectPath: path,
        data: emptyWorkspaceData(),
        loading: true,
        error: null,
        saving: false,
      })
      try {
        const data = await loadWorkspaceData(path)
        if (version === loadVersion) set({ data, loading: false })
      } catch (error) {
        if (version === loadVersion) set({ loading: false, error: String(error) })
      }
    },
    update: (path, change) => persist(path, () => updateWorkspaceData(path, change)),
    perform: (path, command) => persist(path, () => executeWorkspaceCommand(path, command)),
  }
})
