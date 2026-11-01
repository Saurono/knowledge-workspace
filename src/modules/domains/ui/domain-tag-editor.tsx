import { useState } from "react"
import { useTranslation } from "react-i18next"

export interface DomainTagEditorProps {
  domains: { id: string; name: string }[]
  selectedIds?: string[]
  resourcePath?: string
  error: string | null
  loading: boolean
  readOnly?: boolean
  saving: boolean
  onRetry: () => void
  onAdd: (tag: { id: string; name: string }) => Promise<boolean>
  onRemove: (id: string) => Promise<boolean>
  onToggle: (resourcePath: string, id: string) => Promise<boolean>
}
export function DomainTagEditor({
  domains,
  selectedIds: selected = [],
  resourcePath,
  error,
  loading,
  saving,
  readOnly = false,
  onRetry,
  onAdd,
  onRemove,
  onToggle,
}: DomainTagEditorProps) {
  const { t } = useTranslation()
  const [name, setName] = useState("")
  return (
    <div className="space-y-2 border-b p-3 text-xs">
      <div className="font-medium">{t("workspace.domains")}</div>
      {error && (
        <div role="alert">
          {error} <button onClick={onRetry}>{t("workspace.retry")}</button>
        </div>
      )}
      <div className="flex flex-wrap gap-1">
        {domains.map((domain) => (
          <span
            key={domain.id}
            className="inline-flex items-center gap-1 rounded-full border px-2 py-1"
          >
            {resourcePath && (
              <input
                type="checkbox"
                aria-label={domain.name}
                checked={selected.includes(domain.id)}
                disabled={readOnly || loading || saving || !!error}
                onChange={() => void onToggle(resourcePath, domain.id)}
              />
            )}
            {domain.name}
            {!resourcePath && (
              <button
                aria-label={`${t("workspace.delete")} ${domain.name}`}
                disabled={readOnly || loading || saving || !!error}
                onClick={() => void onRemove(domain.id)}
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
            domains.some((d) => d.name.toLocaleLowerCase() === value.toLocaleLowerCase())
          )
            return
          const success = await onAdd({ id: crypto.randomUUID(), name: value })
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
          disabled={!name.trim() || readOnly || loading || saving || !!error}
          className="rounded border px-2 disabled:opacity-40"
        >
          {t("workspace.add")}
        </button>
      </form>
    </div>
  )
}
