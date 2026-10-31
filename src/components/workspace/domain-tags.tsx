import { DomainTagEditor } from "@/modules/domains"
import { resourceDomainIds } from "@/modules/domains/domain"
import { useWikiStore } from "@/stores/wiki-store"
import { useWorkspaceStore } from "@/stores/workspace-store"
export function DomainTags({ resourcePath }: { resourcePath?: string }) {
  const project = useWikiStore((state) => state.project)
  const workspace = useWorkspaceStore()
  if (!project) return null
  return (
    <DomainTagEditor
      key={`${project.path}:${resourcePath ?? "tags"}`}
      domains={workspace.data.domains}
      selectedIds={resourcePath ? resourceDomainIds(workspace.data, resourcePath) : []}
      resourcePath={resourcePath}
      loading={workspace.loading}
      saving={workspace.saving}
      error={workspace.error}
      onRetry={() => void workspace.load(project.path)}
      onAdd={(tag) => workspace.perform(project.path, { type: "domain.add", tag })}
      onRemove={(id) => workspace.perform(project.path, { type: "domain.remove", id })}
      onToggle={(path, id) =>
        workspace.perform(project.path, { type: "domain.toggle", resourcePath: path, domainId: id })
      }
    />
  )
}
