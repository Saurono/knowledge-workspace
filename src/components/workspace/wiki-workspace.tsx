import { useState } from "react"
import { useTranslation } from "react-i18next"
import { PreviewPanel } from "@/components/layout/preview-panel"
import { LintView } from "@/components/lint/lint-view"
import { useWorkspaceUiStore } from "@/stores/workspace-ui-store"

export function WikiWorkspace() {
  const { t } = useTranslation()
  const [showChecks, setShowChecks] = useState(false)
  const mode = useWorkspaceUiStore((s) => s.wikiMode)
  const setMode = useWorkspaceUiStore((s) => s.setWikiMode)
  return (
    <section className="flex h-full flex-col">
      <header className="flex flex-wrap gap-2 border-b p-3">
        <div role="tablist" aria-label={t("workspace.wikiMode")} className="flex gap-2">
          {(["preview", "edit"] as const).map((id) => (
            <button
              key={id}
              role="tab"
              aria-selected={mode === id}
              onClick={() => {
                setMode(id)
                setShowChecks(false)
              }}
              className={`rounded px-3 py-1.5 text-sm ${mode === id ? "bg-primary text-primary-foreground" : "bg-muted"}`}
            >
              {t(`workspace.wiki_${id}`)}
            </button>
          ))}
        </div>
        <button
          aria-pressed={showChecks}
          onClick={() => setShowChecks((open) => !open)}
          className={`rounded border px-3 py-1.5 text-sm ${showChecks ? "bg-accent" : ""}`}
        >
          {t("workspace.checks")}
        </button>
      </header>
      <div className={showChecks ? "hidden" : "min-h-0 flex-1"}>
        <PreviewPanel />
      </div>
      <div className={showChecks ? "min-h-0 flex-1" : "hidden"}>
        <LintView />
      </div>
    </section>
  )
}
