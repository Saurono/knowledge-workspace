import { useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import type { MemoryRecord } from "../domain/model"

export interface MemoryLibraryProps {
  memories: MemoryRecord[]
  domains: { id: string; name: string }[]
  loading: boolean
  readOnly?: boolean
  saving: boolean
  error: string | null
  selected: string | null
  onSelect: (id: string | null) => void
  onSave: (record: MemoryRecord) => Promise<boolean>
  onRemove: (id: string) => Promise<boolean>
  onRetry: () => void
  domainControls?: ReactNode
}
export function MemoryLibrary({
  memories,
  domains,
  loading,
  saving,
  readOnly = false,
  error,
  selected,
  onSelect: setSelected,
  onSave,
  onRemove,
  onRetry,
  domainControls,
}: MemoryLibraryProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState("")
  const [domain, setDomain] = useState("")
  const [draft, setDraft] = useState<MemoryRecord | null>(null)
  const disabled = readOnly || loading || saving || !!error
  const current = draft ?? memories.find((m) => m.id === selected)
  const filtered = memories.filter(
    (m) =>
      (!domain || m.domainIds.includes(domain)) &&
      `${m.title} ${m.content} ${m.category}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
  )
  const edit = (value: Partial<MemoryRecord>) => {
    if (current && !readOnly) setDraft({ ...current, ...value })
  }
  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b p-4">
        <h1 className="font-semibold">{t("workspace.memories")}</h1>
        <input
          aria-label={t("workspace.searchMemories")}
          placeholder={t("workspace.searchMemories")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="rounded border bg-background px-2 py-1 text-sm"
        />
        <select
          aria-label={t("workspace.domains")}
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          className="rounded border bg-background p-1 text-sm"
        >
          <option value="">{t("workspace.allDomains")}</option>
          {domains.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <button
          disabled={disabled}
          onClick={() => {
            const now = new Date().toISOString()
            setSelected(null)
            setDraft({
              id: crypto.randomUUID(),
              title: "",
              content: "",
              category: "",
              domainIds: [],
              relatedIds: [],
              createdAt: now,
              updatedAt: now,
            })
          }}
          className="rounded border px-3 py-1 text-sm"
        >
          {t("workspace.newMemory")}
        </button>
      </header>
      {domainControls}
      {error && (
        <div role="alert" className="p-3 text-destructive">
          {error}
          <button onClick={onRetry}>{t("workspace.retry")}</button>
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <aside className="w-64 shrink-0 overflow-auto border-r p-2">
          {filtered.map((m) => (
            <button
              key={m.id}
              onClick={() => {
                setSelected(m.id)
                setDraft(null)
              }}
              className={`mb-1 block w-full rounded p-3 text-left text-sm ${selected === m.id ? "bg-accent" : "hover:bg-muted"}`}
            >
              <strong className="block truncate">{m.title}</strong>
              <span className="text-xs text-muted-foreground">
                {m.category || t("workspace.uncategorized")}
              </span>
            </button>
          ))}
          {!loading && filtered.length === 0 && (
            <p className="p-3 text-sm text-muted-foreground">{t("workspace.noMemories")}</p>
          )}
        </aside>
        <main className="min-w-0 flex-1 overflow-auto p-6">
          {current ? (
            <div className="mx-auto max-w-3xl space-y-4">
              <label className="block text-sm">
                {t("workspace.title")}
                <input
                  value={current.title}
                  onChange={(e) => edit({ title: e.target.value })}
                  className="mt-1 w-full rounded border bg-background p-2"
                />
              </label>
              <label className="block text-sm">
                {t("workspace.category")}
                <input
                  value={current.category}
                  onChange={(e) => edit({ category: e.target.value })}
                  placeholder={t("workspace.categoryHint")}
                  className="mt-1 w-full rounded border bg-background p-2"
                />
              </label>
              <label className="block text-sm">
                {t("workspace.content")}
                <textarea
                  value={current.content}
                  onChange={(e) => edit({ content: e.target.value })}
                  rows={10}
                  className="mt-1 w-full rounded border bg-background p-2"
                />
              </label>
              <fieldset className="space-x-3 text-sm">
                <legend className="mb-2">{t("workspace.domains")}</legend>
                {domains.map((d) => (
                  <label key={d.id} className="inline-flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={current.domainIds.includes(d.id)}
                      onChange={() =>
                        edit({
                          domainIds: current.domainIds.includes(d.id)
                            ? current.domainIds.filter((id) => id !== d.id)
                            : [...current.domainIds, d.id],
                        })
                      }
                    />
                    {d.name}
                  </label>
                ))}
              </fieldset>
              <fieldset className="space-x-3 text-sm">
                <legend className="mb-2">{t("workspace.relatedMemories")}</legend>
                {memories
                  .filter((m) => m.id !== current.id)
                  .map((m) => (
                    <label key={m.id} className="inline-flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={current.relatedIds.includes(m.id)}
                        onChange={() =>
                          edit({
                            relatedIds: current.relatedIds.includes(m.id)
                              ? current.relatedIds.filter((id) => id !== m.id)
                              : [...current.relatedIds, m.id],
                          })
                        }
                      />
                      {m.title}
                    </label>
                  ))}
              </fieldset>
              <p className="text-xs text-muted-foreground">
                {t("workspace.createdAt")}: {new Date(current.createdAt).toLocaleString()}
              </p>
              <div className="flex gap-2">
                <button
                  disabled={disabled || !current.title.trim() || !current.content.trim()}
                  className="rounded bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-40"
                  onClick={async () => {
                    const saved = {
                      ...current,
                      title: current.title.trim(),
                      updatedAt: new Date().toISOString(),
                    }
                    const success = await onSave(saved)
                    if (success) {
                      setSelected(saved.id)
                      setDraft(null)
                    }
                  }}
                >
                  {t("workspace.save")}
                </button>
                {selected && (
                  <button
                    disabled={disabled}
                    className="rounded border px-3 py-2 text-sm"
                    onClick={async () => {
                      const success = await onRemove(selected)
                      if (success) {
                        setSelected(null)
                        setDraft(null)
                      }
                    }}
                  >
                    {t("workspace.delete")}
                  </button>
                )}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("workspace.selectMemory")}</p>
          )}
        </main>
      </div>
    </div>
  )
}
