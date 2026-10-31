import { create } from "zustand"
export type TaskTab = "import" | "research" | "maintenance"
interface WorkspaceUiState {
  selectedMemoryId: string | null
  setSelectedMemoryId: (id: string | null) => void
  taskTab: TaskTab
  setTaskTab: (tab: TaskTab) => void
  chatMode: "local" | "llm"
  setChatMode: (mode: "local" | "llm") => void
  wikiMode: "preview" | "edit"
  setWikiMode: (mode: "preview" | "edit") => void
}
export const useWorkspaceUiStore = create<WorkspaceUiState>((set) => ({
  selectedMemoryId: null,
  setSelectedMemoryId: (selectedMemoryId) => set({ selectedMemoryId }),
  taskTab: "import",
  setTaskTab: (taskTab) => set({ taskTab }),
  chatMode: "llm",
  setChatMode: (chatMode) => set({ chatMode }),
  wikiMode: "preview",
  setWikiMode: (wikiMode) => set({ wikiMode }),
}))
