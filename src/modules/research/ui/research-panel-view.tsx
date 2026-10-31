import { useState, type ReactNode, type ComponentType, type KeyboardEvent } from "react"
import { useTranslation } from "react-i18next"
import {
  Search,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ChevronRight,
  ChevronDown,
  X,
  FileSearch,
  FileText,
  Globe2,
  Send,
  RotateCcw,
} from "lucide-react"
import { hasActiveResearchRerun, type ResearchTask } from "../domain"
export interface ResearchActionButtonProps {
  children?: ReactNode
  onClick?: () => void
  disabled?: boolean
  className?: string
  variant?: "outline" | "ghost"
  size?: "sm" | "icon"
}
export interface ResearchPanelViewProps {
  tasks: readonly ResearchTask[]
  onStart(topic: string): Promise<boolean>
  onRetry(task: ResearchTask): void
  onRemove(id: string): void
  onClose(): void
  onOpenSaved(task: ResearchTask): void
  renderSynthesis(synthesis: string, isStreaming: boolean): ReactNode
  ActionButton: ComponentType<ResearchActionButtonProps>
  isComposing(event: KeyboardEvent<HTMLInputElement>): boolean
}
export function ResearchPanelView({
  tasks,
  onStart,
  onRetry,
  onRemove,
  onClose,
  onOpenSaved,
  renderSynthesis,
  ActionButton,
  isComposing,
}: ResearchPanelViewProps) {
  const { t } = useTranslation()
  const Button = ActionButton
  const [inputValue, setInputValue] = useState("")
  const running = tasks.filter((t) => ["searching", "synthesizing", "saving"].includes(t.status))
  const queued = tasks.filter((t) => t.status === "queued")
  const done = tasks.filter((t) => t.status === "done" || t.status === "error")
  async function handleStartResearch() {
    const topic = inputValue.trim()
    if (topic && (await onStart(topic))) setInputValue("")
  }
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold">{t("research.title")}</span>
          {(running.length > 0 || queued.length > 0) && (
            <span className="rounded-full bg-primary/20 px-1.5 py-0.5 text-[10px] font-medium text-primary">
              {t("research.activeBadge", { running: running.length, queued: queued.length })}
            </span>
          )}
        </div>
        <button onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-accent">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Research input */}
      <div className="flex shrink-0 items-center gap-1.5 border-b px-3 py-2">
        <input
          value={inputValue}
          dir="auto"
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => {
            if (isComposing(e)) return
            if (e.key === "Enter") handleStartResearch()
          }}
          className="flex-1 rounded border bg-background px-2 py-1 text-xs outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
          placeholder={t("research.inputPlaceholder")}
        />
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={handleStartResearch}
          disabled={!inputValue.trim()}
        >
          <Send className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 p-8 text-center text-xs text-muted-foreground">
            <Search className="h-8 w-8 opacity-20" />
            <p>{t("research.emptyTitle")}</p>
            <p>{t("research.emptyHint")}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-1 p-2">
            {running.map((task) => (
              <ResearchTaskCard
                ActionButton={ActionButton}
                renderSynthesis={renderSynthesis}
                onOpenSaved={onOpenSaved}
                key={task.id}
                task={task}
                onRemove={onRemove}
                onRetry={onRetry}
                rerunPending={hasActiveResearchRerun(tasks, task.id)}
              />
            ))}
            {queued.map((task) => (
              <ResearchTaskCard
                ActionButton={ActionButton}
                renderSynthesis={renderSynthesis}
                onOpenSaved={onOpenSaved}
                key={task.id}
                task={task}
                onRemove={onRemove}
                onRetry={onRetry}
                rerunPending={hasActiveResearchRerun(tasks, task.id)}
              />
            ))}
            {done.map((task) => (
              <ResearchTaskCard
                ActionButton={ActionButton}
                renderSynthesis={renderSynthesis}
                onOpenSaved={onOpenSaved}
                key={task.id}
                task={task}
                onRemove={onRemove}
                onRetry={onRetry}
                rerunPending={hasActiveResearchRerun(tasks, task.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ResearchTaskCard({
  task,
  onRemove,
  onRetry,
  rerunPending,
  onOpenSaved,
  renderSynthesis,
  ActionButton: Button,
}: {
  task: ResearchTask
  onRemove: (id: string) => void
  onRetry: (task: ResearchTask) => void
  rerunPending: boolean
  onOpenSaved(task: ResearchTask): void
  renderSynthesis(synthesis: string, isStreaming: boolean): ReactNode
  ActionButton: ComponentType<ResearchActionButtonProps>
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(
    task.status === "synthesizing" || task.status === "searching",
  )
  const statusIcon = {
    queued: <div className="h-3 w-3 rounded-full border-2 border-muted-foreground" />,
    searching: <Loader2 className="h-3 w-3 animate-spin text-blue-500" />,
    synthesizing: <Loader2 className="h-3 w-3 animate-spin text-purple-500" />,
    saving: <Loader2 className="h-3 w-3 animate-spin text-orange-500" />,
    done: <CheckCircle2 className="h-3 w-3 text-emerald-500" />,
    error: <AlertCircle className="h-3 w-3 text-destructive" />,
  }[task.status]

  const statusText = {
    queued: t("research.status.queued"),
    searching: t("research.status.searching"),
    synthesizing: t("research.status.synthesizing"),
    saving: t("research.status.saving"),
    done: task.savedPath ? t("research.status.saved") : t("research.status.done"),
    error: t("research.status.failed"),
  }[task.status]

  return (
    <div className="rounded-lg border text-xs">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent/50"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
        )}
        {statusIcon}
        <span className="flex-1 truncate font-medium">{task.topic}</span>
        <span className="shrink-0 text-muted-foreground">{statusText}</span>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t px-3 py-2">
          {/* Error */}
          {task.error && <p className="mb-2 text-destructive">{task.error}</p>}

          {/* Web results */}
          {task.webResults.length > 0 && (
            <div className="mb-2">
              <div className="mb-1 font-medium text-muted-foreground">
                {t("research.sourcesCount", { count: task.webResults.length })}
              </div>
              <div className="flex flex-col gap-1">
                {task.webResults.map((r, i) => {
                  const isAnyTxt = r.source.toLowerCase() === "anytxt"
                  const SourceIcon = isAnyTxt ? FileSearch : Globe2
                  return (
                    <div key={i} className="flex items-start gap-1.5 rounded bg-muted/50 px-2 py-1">
                      <span className="shrink-0 font-mono text-muted-foreground">[{i + 1}]</span>
                      <SourceIcon
                        className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${isAnyTxt ? "text-amber-600" : "text-blue-600"}`}
                        aria-label={isAnyTxt ? t("research.anyTxtSource") : t("research.webSource")}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{r.title}</div>
                        <div className="truncate text-muted-foreground">
                          {isAnyTxt ? "AnyTXT" : r.source}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Synthesis (streaming) */}
          {task.synthesis && renderSynthesis(task.synthesis, task.status === "synthesizing")}

          {/* Actions */}
          <div className="flex items-center gap-1.5 mt-2">
            {task.savedPath && (
              <Button
                variant="outline"
                size="sm"
                className="h-6 text-[11px] gap-1"
                onClick={() => onOpenSaved(task)}
              >
                <FileText className="h-3 w-3" />
                {t("research.open")}
              </Button>
            )}
            {(task.status === "done" || task.status === "error") && (
              <Button
                variant="outline"
                size="sm"
                className="h-6 text-[11px] gap-1"
                onClick={() => onRetry(task)}
                disabled={rerunPending}
              >
                <RotateCcw className="h-3 w-3" />
                {t(task.status === "error" ? "research.retry" : "research.rerun")}
              </Button>
            )}
            {(task.status === "done" || task.status === "error") && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[11px] gap-1 text-muted-foreground"
                onClick={() => onRemove(task.id)}
              >
                <X className="h-3 w-3" />
                {t("research.remove")}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
