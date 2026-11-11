import { useEffect, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { createMemoryRecord, type MemoryRecord } from "../domain/model"
import { MEMORY_CATEGORIES, type MemoryCategory } from "../domain"
import { detectConflicts } from "../domain/lifecycle"

export interface MemorySummaryView {
  id: string
  title: string
  status: MemoryRecord["status"]
  version: number
  updatedAt: string
  owner: string | null
  category: string
}

export interface MemoryLibraryProps {
  memories?: MemoryRecord[]
  summaries?: MemorySummaryView[]
  onLoadMemory?: (id: string) => Promise<MemoryRecord | null>
  domains: { id: string; name: string }[]
  loading: boolean
  readOnly?: boolean
  saving: boolean
  error: string | null
  selected: string | null
  onSelect: (id: string | null) => void
  onSave: (record: MemoryRecord) => Promise<boolean | { success: boolean; record: MemoryRecord }>
  onRemove: (id: string) => Promise<boolean>
  onRetry: () => void
  onPromote?: (id: string) => Promise<unknown>
  onArchive?: (id: string) => Promise<unknown>
  onSupersede?: (oldId: string, newId: string) => Promise<unknown>
  onResolve?: (id: string, withId: string, decision: "both-intentional" | "merged") => Promise<unknown>
  domainControls?: ReactNode
}
export function MemoryLibrary({
  memories = [],
  summaries,
  onLoadMemory,
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
  onPromote,
  onArchive,
  onSupersede,
  onResolve,
  domainControls,
}: MemoryLibraryProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState("")
  const [replacement, setReplacement] = useState({ owner: "", target: "" })
  const [domain, setDomain] = useState("")
  const [draft, setDraft] = useState<MemoryRecord | null>(null)
  const [loaded, setLoaded] = useState<Record<string, MemoryRecord>>({})
  const [savedSummaries, setSavedSummaries] = useState<Record<string, MemorySummaryView>>({})
  const [loadState, setLoadState] = useState<{ id: string; loading: boolean; error: string | null } | null>(null)
  const summaryMode = summaries !== undefined
  const summaryList = summaryMode
    ? Array.from(new Map([...summaries, ...Object.values(savedSummaries)].map(m => [m.id, savedSummaries[m.id] ?? m])).values())
    : []
  const targets = summaryMode ? summaryList.filter(m => m.status === "active") : memories
  const disabled = readOnly || loading || saving || !!error
  const current = (summaryMode && selected !== null && draft?.id !== selected ? null : draft)
    ?? (summaryMode && selected ? loaded[selected] : undefined)
    ?? memories.find((m) => m.id === selected)
  const loadMemory = async (id: string) => {
    if (!summaryMode || memories.some(m => m.id === id) || loaded[id]) return
    setLoadState({ id, loading: true, error: null })
    try {
      const record = await onLoadMemory?.(id)
      if (!record || record.id !== id) throw new Error(t("errors.generic"))
      setLoaded(previous => ({ ...previous, [id]: record }))
      setLoadState(previous => previous?.id === id ? null : previous)
    } catch (cause) {
      setLoadState(previous => previous?.id === id
        ? { id, loading: false, error: cause instanceof Error ? cause.message : t("errors.generic") }
        : previous)
    }
  }
  useEffect(() => {
    if (summaryMode && selected) void loadMemory(selected)
    // Loading is driven by selection; failures wait for an explicit retry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summaryMode, selected])
  const conflicts = summaryMode ? [] : detectConflicts(memories).filter((c) => c.a === current?.id || c.b === current?.id)
  const filtered = summaryMode ? summaryList.filter(m =>
    `${m.title} ${m.category}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  ) : memories.filter(
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
          disabled={summaryMode}
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
            setDraft(createMemoryRecord({
              id: crypto.randomUUID(),
              title: "",
              content: "",
              category: "",
              domainIds: [],
              relatedIds: [],
              createdAt: now,
              updatedAt: now,
            }))
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
                if (selected === m.id) void loadMemory(m.id)
              }}
              className={`mb-1 block w-full rounded p-3 text-left text-sm ${selected === m.id ? "bg-accent" : "hover:bg-muted"}`}
            >
              <strong className="block truncate">{m.title}</strong>
              <span className="block text-xs">
                <span className="rounded border px-1">{t(`workspace.memoryDisplay.${m.status}`)}</span> v{m.version}
              </span>
              {"validity" in m && <>
                {m.validity.until && <span className="block text-xs">{t("workspace.memoryDisplay.until")}: {m.validity.until}</span>}
                <span className="block text-xs">{t("workspace.memoryDisplay.importance")}: {m.importance ?? t("workspace.memoryDisplay.unknown")}</span>
                <span className="block text-xs">{t("workspace.memoryDisplay.credibility")}: {m.credibility ?? t("workspace.memoryDisplay.unknown")}</span>
              </>}
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
          {summaryMode && selected === loadState?.id && loadState && (loadState.loading
            ? <p className="text-sm text-muted-foreground">{t("workspace.loadingMemory")}</p>
            : <div role="alert" className="p-3 text-destructive">{loadState.error}<button onClick={() => void loadMemory(loadState.id)}>{t("workspace.retry")}</button></div>)}
          {current ? (
            <div className="mx-auto max-w-3xl space-y-4">
              <div className="flex gap-2">
                {current.status === "candidate" && onPromote && <button disabled={disabled} onClick={() => void onPromote(current.id)}>{t("workspace.memoryDisplay.promote")}</button>}
                {current.status !== "archived" && onArchive && <button disabled={disabled} onClick={() => void onArchive(current.id)}>{t("workspace.memoryDisplay.archive")}</button>}
                {current.status === "active" && onSupersede && <>
                  <select aria-label={t("workspace.memoryDisplay.supersedeTarget")} disabled={disabled} value={replacement.owner === current.id ? replacement.target : ""} onChange={e => setReplacement({ owner: current.id, target: e.target.value })}>
                    <option value="">{t("workspace.memoryDisplay.supersedeTarget")}</option>
                    {targets.filter(m => m.id !== current.id && m.status === "active").map(m => <option key={m.id} value={m.id}>{m.title}</option>)}
                  </select>
                  <button disabled={disabled || replacement.owner !== current.id || !targets.some(m => m.id === replacement.target && m.id !== current.id && m.status === "active")} onClick={() => void onSupersede(current.id, replacement.target)}>{t("workspace.memoryDisplay.supersede")}</button>
                </>}
              </div>
              <section className="space-y-2 text-sm">
                <h2 className="font-semibold">{t("workspace.memoryDisplay.history")}</h2>
                {current.revisionCompaction && <p>{t("workspace.memoryDisplay.compacted", { to: current.revisionCompaction.upToVersion })}</p>}
                <ol>{current.revisions.filter(r => r.version >= (current.revisionCompaction?.keptFrom ?? 1)).map((r, i) => <li key={i} className="mb-2">
                  v{r.version} / {r.at} / {r.source.kind}
                  {r.changeNote && <p>{r.changeNote}</p>}
                </li>)}</ol>
              </section>
              <section className="space-y-2 text-sm">
                <h2 className="font-semibold">{t("workspace.memoryDisplay.audit")}</h2>
                <ol>{current.transitions.map((r, i) => <li key={i} className="mb-2">
                  {r.at} / {r.from === null ? t("workspace.memoryDisplay.unknown") : t(`workspace.memoryDisplay.${r.from}`)} → {t(`workspace.memoryDisplay.${r.to}`)} / {r.source.kind}
                  {r.reason && <p>{r.reason}</p>}
                </li>)}</ol>
              </section>
              <section className="space-y-2 text-sm">
                <h2 className="font-semibold">{t("workspace.memoryDisplay.access")}</h2>
                <p>{t(`workspace.memoryDisplay.${current.access?.visibility ?? "project"}`)}</p>
                {current.access && <>
                  <p>{t("workspace.memoryDisplay.owner")}: {current.access.ownerId}</p>
                  <p>{t("workspace.memoryDisplay.roles")}: {current.access.workRoleIds?.join(", ") || t("workspace.memoryDisplay.unknown")}</p>
                </>}
              </section>
              {conflicts.length > 0 && <section className="space-y-2 text-sm">
                <h2 className="font-semibold">{t("workspace.memoryDisplay.conflicts")}</h2>
                <ul>{conflicts.map((c) => {
                  const id = c.a === current.id ? c.b : c.a
                  return <li key={id}>{id} / {memories.find((m) => m.id === id)?.title}
                    {onResolve && <>
                      <button disabled={disabled} onClick={() => void onResolve(current.id, id, "both-intentional")}>{t("workspace.memoryDisplay.resolveBoth")}</button>
                      <button disabled={disabled} onClick={() => void onResolve(current.id, id, "merged")}>{t("workspace.memoryDisplay.resolveMerged")}</button>
                    </>}
                  </li>
                })}</ul>
              </section>}
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
                <select
                  value={current.category}
                  onChange={(e) => edit({ category: e.target.value as MemoryCategory })}
                  className="mt-1 w-full rounded border bg-background p-2"
                >
                  {MEMORY_CATEGORIES.map(value => <option key={value} value={value}>{t(`workspace.categoryOption.${value}`)}</option>)}
                </select>
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
                {targets
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
                    }
                    const result = await onSave(saved)
                    const success = typeof result === "boolean" ? result : result.success
                    if (success) {
                      const record = typeof result === "boolean" ? saved : result.record
                      if (summaryMode) {
                        setLoaded(previous => ({ ...previous, [record.id]: record }))
                        setSavedSummaries(previous => ({ ...previous, [record.id]: {
                          id: record.id, title: record.title, status: record.status,
                          version: record.version, updatedAt: record.updatedAt,
                          owner: record.access?.ownerId ?? null, category: record.category,
                        } }))
                      }
                      setSelected(record.id)
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
