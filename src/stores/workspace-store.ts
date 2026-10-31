import { create } from "zustand"
import {
  emptyWorkspaceData,
  loadWorkspaceData,
  updateWorkspaceData,
  type WorkspaceData,
} from "@/lib/workspace-data"

interface WorkspaceState {
  projectPath: string | null
  data: WorkspaceData
  loading: boolean
  saving: boolean
  error: string | null
  reset: () => void
  load: (path: string) => Promise<void>
  update: (path: string, change: (data: WorkspaceData) => WorkspaceData) => Promise<boolean>
}
let loadVersion = 0
export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
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
  update: async (path, change) => {
    if (get().projectPath !== path || get().loading || get().saving || get().error) return false
    set({ saving: true })
    try {
      const data = await updateWorkspaceData(path, change)
      if (get().projectPath === path) set({ data, saving: false })
      return true
    } catch (error) {
      if (get().projectPath === path) set({ saving: false, error: String(error) })
      return false
    }
  },
}))
