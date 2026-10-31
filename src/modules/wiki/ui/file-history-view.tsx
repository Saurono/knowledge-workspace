import { useTranslation } from "react-i18next"
import { Clock3, RotateCcw, X } from "lucide-react"
import type { FileHistoryEntry } from "@/modules/documents/domain"
export interface FileHistoryViewProps {
  open: boolean
  loading: boolean
  restoring: boolean
  entries: readonly FileHistoryEntry[]
  selected: FileHistoryEntry | null
  diff: string
  error: string | null
  buttonClassName?: string
  onShow(): void
  onClose(): void
  onSelect(entry: FileHistoryEntry): void
  onRestore(): void
}
export function FileHistoryView({
  open,
  loading,
  restoring,
  entries,
  selected,
  diff,
  error,
  onShow,
  onClose,
  onSelect,
  onRestore,
  buttonClassName = "right-3 top-3",
}: FileHistoryViewProps) {
  const { t } = useTranslation()
  return (
    <>
      <button
        type="button"
        onClick={onShow}
        className={`absolute ${buttonClassName} z-20 rounded-md border bg-background/90 p-1.5 text-muted-foreground shadow-sm hover:text-foreground`}
        title={t("preview.history")}
      >
        <Clock3 className="h-4 w-4" />
      </button>
      {open && (
        <div
          className="absolute inset-0 z-40 flex bg-background"
          role="region"
          aria-label={t("preview.history")}
        >
          <aside className="w-72 shrink-0 border-r p-3">
            <div className="mb-3 flex items-center justify-between">
              <strong className="text-sm">{t("preview.history")}</strong>
              <button type="button" onClick={onClose} aria-label={t("common.close")}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-1 overflow-auto">
              {loading && (
                <p className="text-xs text-muted-foreground">{t("preview.historyLoading")}</p>
              )}
              {!loading && entries.length === 0 && (
                <p className="text-xs text-muted-foreground">{t("preview.historyEmpty")}</p>
              )}
              {entries.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  disabled={restoring}
                  onClick={() => onSelect(entry)}
                  className={`w-full rounded border px-2 py-2 text-left text-xs ${selected?.id === entry.id ? "border-primary bg-primary/5" : "border-transparent hover:bg-muted"}`}
                >
                  <div className="font-medium">
                    {entry.author} · {entry.tool}
                  </div>
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    {new Date(entry.timestamp).toLocaleString()}
                  </div>
                </button>
              ))}
            </div>
          </aside>
          <main className="min-w-0 flex-1 overflow-auto p-4">
            {error && (
              <p role="alert" className="mb-3 text-sm text-destructive">
                {error}
              </p>
            )}
            {selected ? (
              <>
                <div className="mb-3 flex justify-end">
                  <button
                    type="button"
                    disabled={restoring || loading}
                    className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
                    onClick={onRestore}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    {t(restoring ? "workspace.processing" : "preview.historyRestore")}
                  </button>
                </div>
                <pre className="whitespace-pre-wrap break-words rounded-md bg-muted/40 p-3 font-mono text-xs">
                  {diff}
                </pre>
              </>
            ) : (
              <div className="grid h-full place-items-center text-sm text-muted-foreground">
                {t("preview.historySelect")}
              </div>
            )}
          </main>
        </div>
      )}
    </>
  )
}
