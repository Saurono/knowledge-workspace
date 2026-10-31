import { useTranslation } from "react-i18next"
import { ChatPanel } from "@/components/chat/chat-panel"
import { SearchView } from "@/components/search/search-view"
import { useWorkspaceUiStore } from "@/stores/workspace-ui-store"

export function ChatWorkspace() {
  const { t } = useTranslation()
  const mode = useWorkspaceUiStore((s) => s.chatMode)
  const setMode = useWorkspaceUiStore((s) => s.setChatMode)
  return (
    <section className="flex h-full flex-col">
      <header
        className="flex gap-2 border-b p-3"
        role="tablist"
        aria-label={t("workspace.retrievalMode")}
      >
        {(["local", "llm"] as const).map((id) => (
          <button
            key={id}
            role="tab"
            aria-selected={mode === id}
            onClick={() => setMode(id)}
            className={`rounded px-3 py-1.5 text-sm ${mode === id ? "bg-primary text-primary-foreground" : "bg-muted"}`}
          >
            {t(`workspace.chat_${id}`)}
          </button>
        ))}
      </header>
      <div className={mode === "local" ? "min-h-0 flex-1" : "hidden"}>
        <SearchView localOnly />
      </div>
      <div className={mode === "llm" ? "min-h-0 flex-1" : "hidden"}>
        <ChatPanel />
      </div>
    </section>
  )
}
