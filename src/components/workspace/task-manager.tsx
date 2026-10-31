import { TaskManagerView } from "@/modules/tasks/ui"
import { useEffect, useState } from "react"
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
  const action = async (fn: () => void | Promise<unknown>) => {
    setError("")
    try {
      await fn()
    } catch (e) {
      setError(String(e))
    }
  }
  return (
    <TaskManagerView
      tab={tab}
      setTab={setTab}
      queue={queue}
      items={items}
      selected={selected}
      setSelected={setSelected}
      error={error}
      paused={paused}
      cancellableActivityIds={
        new Set(items.filter((item) => canCancelMaintenanceTask(item.id)).map((item) => item.id))
      }
      onTogglePause={() =>
        void action(() => {
          if (paused) resumeProcessing()
          else pauseProcessing()
          setPaused(isQueuePaused())
        })
      }
      onRetryImport={(id) => void action(() => retryTask(id))}
      onCancelImport={(id) => void action(() => cancelTask(id))}
      onCancelActivity={(id) => void action(() => cancelMaintenanceTask(id))}
      researchPanel={<ResearchPanel />}
      importConnection={<ObsidianConnection />}
    />
  )
}
