import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useActivityStore } from "@/stores/activity-store"
import { useWorkspaceUiStore } from "@/stores/workspace-ui-store"
import {
  getQueue,
  subscribeIngestQueue,
  retryTask,
  cancelTask,
  pauseProcessing,
  resumeProcessing,
  isQueuePaused,
  type IngestTask,
} from "@/lib/ingest-queue"
import { canCancelMaintenanceTask, cancelMaintenanceTask } from "@/lib/maintenance-tasks"
import { ObsidianConnection } from "./obsidian-connection"
import { ResearchPanel } from "@/components/layout/research-panel"

export function TaskManager() {
  const { t } = useTranslation()
  const tab = useWorkspaceUiStore((s) => s.taskTab)
  const setTab = useWorkspaceUiStore((s) => s.setTaskTab)
  const items = useActivityStore((s) => s.items)
  const [queue, setQueue] = useState<IngestTask[]>(() => [...getQueue()])
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState("")
  const [paused, setPaused] = useState(isQueuePaused)
  useEffect(
    () =>
      subscribeIngestQueue((tasks) => {
        setQueue([...tasks])
        setPaused(isQueuePaused())
      }),
    [],
  )
  const activities = items.filter(
    (item) =>
      !item.parentTaskId &&
      (tab === "maintenance"
        ? item.type === "lint"
        : item.type === "ingest" && !queue.some((task) => task.id === item.taskId)),
  )
  const action = async (fn: () => void | Promise<unknown>) => {
    setError("")
    try {
      await fn()
    } catch (e) {
      setError(String(e))
    }
  }
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
          <ResearchPanel />
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-4">
          {tab === "import" && (
            <>
              <ObsidianConnection />
              <div className="mb-3 flex gap-2">
                <button
                  className="rounded border px-3 py-1 text-sm"
                  onClick={() =>
                    void action(() => {
                      if (paused) resumeProcessing()
                      else pauseProcessing()
                      setPaused(isQueuePaused())
                    })
                  }
                >
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
                            onClick={() => void action(() => retryTask(task.id))}
                          >
                            {t("workspace.retry")}
                          </button>
                        )}
                        {["pending", "processing"].includes(task.status) && (
                          <button
                            className="rounded border px-2 py-1"
                            onClick={() => void action(() => cancelTask(task.id))}
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
                  {canCancelMaintenanceTask(item.id) && (
                    <button
                      className="rounded border px-2 py-1"
                      onClick={() => cancelMaintenanceTask(item.id)}
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
