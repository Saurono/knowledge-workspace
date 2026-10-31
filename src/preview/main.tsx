import { PREVIEW_PROJECT, resetPreview } from "./runtime"
import ReactDOM from "react-dom/client"
import App from "@/App"
import { AppDialogHost } from "@/components/app-dialog-host"
import { useWikiStore, type WikiState } from "@/stores/wiki-store"
import { useActivityStore } from "@/stores/activity-store"
import { useResearchStore } from "@/stores/research-store"
import i18n from "@/i18n"
import "@/index.css"
import "./preview.css"

await i18n.changeLanguage("zh")
useWikiStore.getState().setProject(PREVIEW_PROJECT)
useWikiStore.getState().setActiveView("graph")
useActivityStore
  .getState()
  .addItem({
    type: "ingest",
    title: "示例资料入库 · 演示记录",
    status: "done",
    detail: "示例：资料解析、知识编译已完成。此记录用于界面预览，未执行真实任务。",
    filesWritten: ["wiki/concepts/page-1.md"],
  })
useActivityStore
  .getState()
  .addItem({
    type: "lint",
    title: "Wiki 结构检查 · 演示记录",
    status: "done",
    detail: "示例：已检查 24 个页面。可在 Wiki 的检查入口发起实际的示例数据检查。",
    filesWritten: [],
  })
const researchId = useResearchStore.getState().addTask("示例研究任务 · 统一任务界面")
useResearchStore
  .getState()
  .updateTask(researchId, {
    status: "done",
    synthesis: "这是用于展示任务布局的合成研究结果，未调用模型或搜索服务。",
    savedPath: null,
  })
const views: { id: WikiState["activeView"]; label: string }[] = [
  { id: "graph", label: "记忆星海" },
  { id: "memories", label: "记忆库" },
  { id: "wiki", label: "Wiki" },
  { id: "chat", label: "对话与搜索" },
  { id: "tasks", label: "任务管理器" },
]
function show(id: WikiState["activeView"]) {
  const state = useWikiStore.getState()
  if (!state.project) state.setProject(PREVIEW_PROJECT)
  if (id === "wiki" && !state.selectedFile) {
    void state.openPathInPreview(`${PREVIEW_PROJECT.path}/wiki/concepts/page-1.md`)
  } else state.setActiveView(id)
}
ReactDOM.createRoot(document.getElementById("root")!).render(
  <>
    <div className="preview-banner">
      <strong>交互预览</strong>
      <span>合成数据 · 不连接本地文件或模型</span>
      <nav aria-label="预览导航">
        {views.map((view) => (
          <button key={view.id} onClick={() => show(view.id)}>
            {view.label}
          </button>
        ))}
      </nav>
      <button className="preview-reset" onClick={resetPreview}>
        重置示例
      </button>
    </div>
    <div className="preview-app">
      <App />
      <AppDialogHost />
    </div>
  </>,
)
