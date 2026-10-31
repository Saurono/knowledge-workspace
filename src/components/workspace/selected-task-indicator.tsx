import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { getQueue, subscribeIngestQueue } from "@/lib/ingest-queue"
import { normalizePath } from "@/lib/path-utils"
import { useWikiStore } from "@/stores/wiki-store"
export function SelectedTaskIndicator({ path }: { path: string }) {
  const { t } = useTranslation()
  const project = useWikiStore((s) => s.project)
  const [queue, setQueue] = useState(() => [...getQueue()])
  useEffect(() => subscribeIngestQueue((tasks) => setQueue([...tasks])), [])
  const processing =
    project &&
    queue.some(
      (task) =>
        task.status === "processing" &&
        normalizePath(
          task.sourcePath.startsWith(project.path)
            ? task.sourcePath
            : `${project.path}/${task.sourcePath}`,
        ) === normalizePath(path),
    )
  return processing ? (
    <span role="status" className="rounded bg-primary/10 px-2 py-0.5 text-xs text-primary">
      {t("workspace.processing")}
    </span>
  ) : null
}
