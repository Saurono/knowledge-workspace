import { TaskManagerView } from "@/modules/tasks/ui"
import { useEffect, useState } from "react"
import { useActivityStore } from "@/stores/activity-store"
import { useWorkspaceUiStore } from "@/stores/workspace-ui-store"
import {
  getQueue,
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
import { useWikiStore } from "@/stores/wiki-store"
import type { TaskProtocol } from "@/modules/tasks"
import { createTaskRuntimeHandle } from "@/app/tasks/task-runtime"
import { subscribeIngestQueue } from "@/app/ingestion/queue"
import { createLegacyIngestMirror } from "@/app/tasks/ingest-mirror"
import { toActivityViews } from "@/app/tasks/view-projection"

export function TaskManager() {
  const project = useWikiStore((s) => s.project)
  const [unified, setUnified] = useState<TaskProtocol[]>([])
  const [runtimeError, setRuntimeError] = useState("")
  useEffect(() => {
    setRuntimeError("")
    if (!project?.path) {
      setUnified([])
      return
    }
    setUnified([])
    const handle = createTaskRuntimeHandle({
      root: project.path,
      now: () => new Date().toISOString(),
    })
    const mirror = createLegacyIngestMirror({
      subscribe: subscribeIngestQueue,
      host: handle,
      now: () => new Date().toISOString(),
      onError: (e) => setRuntimeError(String(e)),
    })
    void (async () => { await mirror.ready; await handle.start(); setUnified(await handle.list()) })()
      .catch((e) => setRuntimeError(String(e)))
    const stop = handle.subscribe((task) => setUnified((current) => {
      const index = current.findIndex((item) => item.id === task.id)
      return index < 0 ? [...current, task] : current.map((item) => item.id === task.id ? task : item)
    }), { replay: true })
    return () => {
      mirror.stop()
      stop()
      void handle.dispose()
    }
  }, [project?.path])
  const unifiedItems = toActivityViews(unified)
    .map((item) => ({ ...item, detail: "[统一任务] " + item.detail }))
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
      items={[...items, ...unifiedItems]}
      selected={selected}
      setSelected={setSelected}
      error={error || runtimeError}
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
