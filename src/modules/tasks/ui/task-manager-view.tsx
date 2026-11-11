import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
export type TaskManagerTab = "import" | "research" | "maintenance"
export interface ImportTaskView {
  id: string
  sourcePath: string
  status: "pending" | "processing" | "done" | "failed" | "cancelled"
  addedAt: number
  error: string | null
}
export interface TaskActivityView {
  id: string
  taskId?: string
  parentTaskId?: string
  type: "ingest" | "lint" | "query"
  title: string
  status: "running" | "done" | "error" | "cancelled"
  detail: string
  log?: string[]
  filesWritten: string[]
  createdAt: number
}
export interface TaskManagerViewProps {
  tab: TaskManagerTab
  setTab(tab: TaskManagerTab): void
  queue: readonly ImportTaskView[]
  items: readonly TaskActivityView[]
  selected: string | null
  setSelected(id: string | null): void
  error: string
  paused: boolean
  cancellableActivityIds: ReadonlySet<string>
  onTogglePause(): void
  onRetryImport(id: string): void
  onCancelImport(id: string): void
  onCancelActivity(id: string): void
  researchPanel: ReactNode
  importConnection: ReactNode
}
export function TaskManagerView({
  tab,
  setTab,
  queue,
  items,
  selected,
  setSelected,
  error,
  paused,
  cancellableActivityIds,
  onTogglePause,
  onRetryImport,
  onCancelImport,
  onCancelActivity,
  researchPanel,
  importConnection,
}: TaskManagerViewProps) {
  const { t } = useTranslation()
  const activities = items.filter(
    (item) =>
      !item.parentTaskId &&
      (tab === "maintenance"
        ? item.type === "lint"
        : item.type === "ingest" && !queue.some((task) => task.id === item.taskId)),
  )
  return (
    <section className="flex h-full flex-col">
      <header className="border-b p-4">
        <h1 className="mb-3 font-semibold">{t("workspace.tasks")}</h1>
        <div role="tablist" aria-label={t("workspace.tasks")} className="flex flex-wrap gap-2">
          {(["import", "research", "maintenance"] as const).map((id) => (
            <button
              role="tab"
              key={id}
              aria-selected={tab === id}
              onClick={() => {
                setTab(id)
                setSelected(null)
              }}
              className={`rounded px-3 py-2 text-sm ${tab === id ? "bg-primary text-primary-foreground" : "bg-muted"}`}
            >
              {t(`workspace.task_${id}`)}
            </button>
          ))}
        </div>
      </header>
      {error && (
        <p role="alert" className="p-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {tab === "research" ? (
        <div className="min-h-0 flex-1">
          {researchPanel}
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-4">
          {tab === "import" && (
            <>
              {importConnection}
              <div className="mb-3 flex gap-2">
                <button className="rounded border px-3 py-1 text-sm" onClick={onTogglePause}>
                  {t(paused ? "workspace.resume" : "workspace.pause")}
                </button>
              </div>
              {queue.map((task) => (
                <article
                  key={task.id}
                  className={`mb-2 rounded-lg border p-3 ${selected === task.id ? "border-primary" : ""}`}
                >
                  <button className="w-full text-left" onClick={() => setSelected(task.id)}>
                    <span className="block truncate text-sm">{task.sourcePath}</span>
                    <span className="text-xs text-muted-foreground">
                      {task.status}{" "}
                      {selected === task.id &&
                        task.status === "processing" &&
                        `· ${t("workspace.processing")}`}
                    </span>
                  </button>
                  {selected === task.id && (
                    <div className="mt-2 space-y-2 text-xs">
                      <p>{new Date(task.addedAt).toLocaleString()}</p>
                      {items
                        .filter((item) => item.taskId === task.id)
                        .map((item) => (
                          <p key={item.id} className="whitespace-pre-wrap">
                            {item.detail}
                          </p>
                        ))}
                      {task.error && (
                        <p role="alert" className="whitespace-pre-wrap text-destructive">
                          {task.error}
                        </p>
                      )}
                      <div className="flex gap-2">
                        {["failed", "cancelled"].includes(task.status) && (
                          <button
                            className="rounded border px-2 py-1"
                            onClick={() => onRetryImport(task.id)}
                          >
                            {t("workspace.retry")}
                          </button>
                        )}
                        {["pending", "processing"].includes(task.status) && (
                          <button
                            className="rounded border px-2 py-1"
                            onClick={() => onCancelImport(task.id)}
                          >
                            {t("workspace.cancel")}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </article>
              ))}
            </>
          )}
          {activities.map((item) => (
            <article
              key={item.id}
              className={`mb-2 rounded-lg border p-3 ${selected === item.id ? "border-primary" : ""}`}
            >
              <button className="w-full text-left" onClick={() => setSelected(item.id)}>
                <span className="text-sm">{item.title}</span>
                <span className="ml-2 text-xs text-muted-foreground">{item.status}</span>
              </button>
              {selected === item.id && (
                <div className="mt-2 space-y-2 text-xs">
                  <p>{new Date(item.createdAt).toLocaleString()}</p>
                  <p className="whitespace-pre-wrap">{item.detail}</p>
                  {item.log && item.log.length > 0 && (
                    <ol aria-label="Task progress log" className="list-inside list-disc space-y-1 text-muted-foreground">
                      {item.log.map((entry, index) => (
                        <li key={`${index}:${entry}`} className="whitespace-pre-wrap">{entry}</li>
                      ))}
                    </ol>
                  )}
                  {items
                    .filter((child) => child.parentTaskId === item.id)
                    .map((child) => (
                      <p key={child.id} className="whitespace-pre-wrap">
                        {child.title}: {child.status} · {child.detail}
                      </p>
                    ))}
                  {item.filesWritten.map((path) => (
                    <p key={path} className="break-all">
                      {path}
                    </p>
                  ))}
                  {cancellableActivityIds.has(item.id) && (
                    <button
                      className="rounded border px-2 py-1"
                      onClick={() => onCancelActivity(item.id)}
                    >
                      {t("workspace.cancel")}
                    </button>
                  )}
                </div>
              )}
            </article>
          ))}
          {activities.length === 0 && (tab !== "import" || queue.length === 0) && (
            <p className="p-6 text-center text-sm text-muted-foreground">
              {t("workspace.noTasks")}
            </p>
          )}
        </div>
      )}
    </section>
  )
}
