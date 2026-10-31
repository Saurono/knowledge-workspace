import { useEffect, useRef, useState } from "react"
import { FileHistoryView } from "@/modules/wiki/ui"
import type { FileHistoryEntry } from "@/modules/documents/domain"
import { readProjectFileHistory, restoreProjectFileHistory } from "@/app/wiki/history"
import { summarizeAgentFileChange } from "@/lib/agent-file-activity"
import { useWikiStore } from "@/stores/wiki-store"

export function FileHistoryButton({
  filePath,
  currentContent,
  buttonClassName,
}: {
  filePath: string
  currentContent: string
  buttonClassName?: string
}) {
  const project = useWikiStore((state) => state.project)
  const [open, setOpen] = useState(false),
    [entries, setEntries] = useState<FileHistoryEntry[]>([])
  const [selected, setSelected] = useState<FileHistoryEntry | null>(null)
  const [loading, setLoading] = useState(false),
    [restoring, setRestoring] = useState(false),
    [error, setError] = useState<string | null>(null)
  const generation = useRef(0)
  useEffect(() => {
    ++generation.current
    setOpen(false)
    setEntries([])
    setSelected(null)
    setError(null)
    setLoading(false)
    setRestoring(false)
    const unsubscribe = useWikiStore.subscribe((state, previous) => {
      if (
        state.project?.id !== previous.project?.id ||
        state.project?.path !== previous.project?.path
      ) {
        ++generation.current
        setOpen(false)
        setEntries([])
        setSelected(null)
        setLoading(false)
        setRestoring(false)
        setError(null)
      }
    })
    return () => {
      ++generation.current
      unsubscribe()
    }
  }, [project?.id, project?.path, filePath])
  if (!project) return null
  const current = (version: number) =>
    version === generation.current &&
    useWikiStore.getState().project?.id === project.id &&
    useWikiStore.getState().project?.path === project.path
  const show = async () => {
    const version = ++generation.current
    setOpen(true)
    setLoading(true)
    setRestoring(false)
    setError(null)
    setSelected(null)
    try {
      const list = await readProjectFileHistory(project.path, filePath)
      if (current(version)) setEntries(list)
    } catch (failure) {
      if (current(version)) setError(String(failure))
    } finally {
      if (current(version)) setLoading(false)
    }
  }
  const restore = async () => {
    if (!selected || restoring) return
    const version = ++generation.current
    setRestoring(true)
    setError(null)
    try {
      const content = await restoreProjectFileHistory(project.path, filePath, selected.id)
      if (current(version)) {
        useWikiStore.getState().openFileInPreview(filePath, content)
        setOpen(false)
      }
    } catch (failure) {
      if (current(version)) setError(String(failure))
    } finally {
      if (current(version)) setRestoring(false)
    }
  }
  const diff = selected
    ? summarizeAgentFileChange({
        id: selected.id,
        path: filePath,
        tool: selected.tool,
        beforeContent: selected.content,
        afterContent: currentContent,
      }).diff
    : ""
  return (
    <FileHistoryView
      open={open}
      entries={entries}
      selected={selected}
      loading={loading}
      restoring={restoring}
      error={error}
      diff={diff}
      buttonClassName={buttonClassName}
      onShow={() => void show()}
      onClose={() => {
        ++generation.current
        setOpen(false)
      }}
      onSelect={setSelected}
      onRestore={() => void restore()}
    />
  )
}
