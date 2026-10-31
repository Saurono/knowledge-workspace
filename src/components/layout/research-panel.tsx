import { ResearchPanelView, type ResearchActionButtonProps } from "@/modules/research/ui"
import { Button } from "@/components/ui/button"
import {
  hasActiveResearchRerun,
  useResearchStore,
  type ResearchTask,
} from "@/stores/research-store"
import { useWikiStore } from "@/stores/wiki-store"
import { readFile } from "@/commands/fs"
import { queueResearch, queueResearchBatch } from "@/lib/deep-research"
import { normalizePath } from "@/lib/path-utils"
import { hasConfiguredDeepResearchSources } from "@/lib/web-search"
import { isImeComposing } from "@/lib/keyboard-utils"
import { useTranslation } from "react-i18next"
import { useAppDialog } from "@/stores/app-dialog-store"
import { SynthesisBlock } from "./research-synthesis"
function ResearchActionButton(props: ResearchActionButtonProps) {
  return <Button {...props} />
}

export function ResearchPanel() {
  const { t } = useTranslation()
  const appDialog = useAppDialog()
  const allTasks = useResearchStore((s) => s.tasks)
  const remove = useResearchStore((s) => s.removeTask)
  const project = useWikiStore((s) => s.project)
  const model = useWikiStore((s) => s.llmConfig)
  const search = useWikiStore((s) => s.searchApiConfig)
  const tasks = allTasks.filter(
    (task) => !task.projectPath || task.projectPath === normalizePath(project?.path ?? ""),
  )
  const checkSource = async () => {
    if (!project) return false
    if (!hasConfiguredDeepResearchSources(search)) {
      await appDialog.alert({ message: t("research.notConfigured") })
      return false
    }
    return true
  }
  const retry = async (task: ResearchTask) => {
    if (
      hasActiveResearchRerun(useResearchStore.getState().tasks, task.id) ||
      !(await checkSource()) ||
      !project
    )
      return
    queueResearchBatch(
      normalizePath(project.path),
      [
        {
          topic: task.topic,
          searchQueries: task.searchQueries,
          sourceReviewId: task.sourceReviewId,
          rerunOfTaskId: task.id,
        },
      ],
      model,
      search,
    )
  }
  const open = async (task: ResearchTask) => {
    if (!project || !task.savedPath) return
    const path = `${normalizePath(project.path)}/${task.savedPath}`
    try {
      const content = await readFile(path)
      if (useWikiStore.getState().project?.path === project.path)
        useWikiStore.getState().openFileInPreview(path, content)
    } catch {
      /* existing preview fallback */
    }
  }
  return (
    <ResearchPanelView
      key={project?.path}
      tasks={tasks}
      onStart={async (topic) => {
        if (!(await checkSource()) || !project) return false
        queueResearch(normalizePath(project.path), topic, model, search)
        return true
      }}
      onRetry={(task) => void retry(task)}
      onRemove={remove}
      onClose={() => useWikiStore.getState().setActiveView("wiki")}
      onOpenSaved={(task) => void open(task)}
      renderSynthesis={(synthesis, isStreaming) => (
        <SynthesisBlock synthesis={synthesis} isStreaming={isStreaming} />
      )}
      ActionButton={ResearchActionButton}
      isComposing={isImeComposing}
    />
  )
}
