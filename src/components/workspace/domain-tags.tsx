import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useWikiStore } from "@/stores/wiki-store"
import { useWorkspaceStore } from "@/stores/workspace-store"
import { removeDomain } from "@/lib/workspace-data"

export function DomainTags({ resourcePath }: { resourcePath?: string }) {
  const { t } = useTranslation()
  const project = useWikiStore((s) => s.project)
  const { data, update, error, loading, saving, load } = useWorkspaceStore()
  const [name, setName] = useState("")
  if (!project) return null
  const selected = resourcePath ? (data.resourceDomains[resourcePath] ?? []) : []
  return (
    <div className="space-y-2 border-b p-3 text-xs">
      <div className="font-medium">{t("workspace.domains")}</div>
      {error && (
        <div role="alert">
          {error} <button onClick={() => void load(project.path)}>{t("workspace.retry")}</button>
        </div>
      )}
      <div className="flex flex-wrap gap-1">
        {data.domains.map((domain) => (
          <span
            key={domain.id}
            className="inline-flex items-center gap-1 rounded-full border px-2 py-1"
          >
            {resourcePath && (
              <input
                type="checkbox"
                aria-label={domain.name}
                checked={selected.includes(domain.id)}
                disabled={loading || saving || !!error}
                onChange={() =>
                  void update(project.path, (current) => {
                    const ids = current.resourceDomains[resourcePath] ?? []
                    return {
                      ...current,
                      resourceDomains: {
                        ...current.resourceDomains,
                        [resourcePath]: ids.includes(domain.id)
                          ? ids.filter((id) => id !== domain.id)
                          : [...ids, domain.id],
                      },
                    }
                  })
                }
              />
            )}
            {domain.name}
            {!resourcePath && (
              <button
                aria-label={`${t("workspace.delete")} ${domain.name}`}
                disabled={loading || saving || !!error}
                onClick={() =>
                  void update(project.path, (current) => removeDomain(current, domain.id))
                }
              >
                ×
              </button>
            )}
          </span>
        ))}
      </div>
      <form
        className="flex gap-2"
        onSubmit={async (event) => {
          event.preventDefault()
          const value = name.trim()
          if (
            !value ||
            data.domains.some((d) => d.name.toLocaleLowerCase() === value.toLocaleLowerCase())
          )
            return
          const success = await update(project.path, (current) => ({
            ...current,
            domains: [...current.domains, { id: crypto.randomUUID(), name: value }],
          }))
          if (success) setName("")
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label={t("workspace.newDomain")}
          placeholder={t("workspace.newDomain")}
          className="min-w-0 flex-1 rounded border bg-background px-2 py-1"
        />
        <button
          disabled={!name.trim() || loading || saving || !!error}
          className="rounded border px-2 disabled:opacity-40"
        >
          {t("workspace.add")}
        </button>
      </form>
    </div>
  )
}
