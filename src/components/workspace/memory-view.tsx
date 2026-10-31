import { MemoryLibrary } from "@/modules/memory"
import { useWikiStore } from "@/stores/wiki-store"
import { useWorkspaceStore } from "@/stores/workspace-store"
import { useWorkspaceUiStore } from "@/stores/workspace-ui-store"
import { DomainTags } from "./domain-tags"
/** Application composition: feature UI receives data and commands, never global stores. */
export function MemoryView() {
  const project = useWikiStore((state) => state.project)
  const workspace = useWorkspaceStore()
  const selected = useWorkspaceUiStore((state) => state.selectedMemoryId)
  const onSelect = useWorkspaceUiStore((state) => state.setSelectedMemoryId)
  if (!project) return null
  return (
    <MemoryLibrary
      key={project.path}
      memories={workspace.data.memories}
      domains={workspace.data.domains}
      loading={workspace.loading}
      saving={workspace.saving}
      error={workspace.error}
      selected={selected}
      onSelect={onSelect}
      onRetry={() => void workspace.load(project.path)}
      onSave={(record) => workspace.perform(project.path, { type: "memory.save", record })}
      onRemove={(id) => workspace.perform(project.path, { type: "memory.remove", id })}
      domainControls={<DomainTags />}
    />
  )
}
