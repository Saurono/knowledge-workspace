/** Explicit preview entry only. All file/native operations stay in this tab's memory. */
import type { FileNode } from "@/types/wiki"
import type { WorkspaceData } from "@/lib/workspace-data"
import { createMemoryRecord } from "@/modules/memory/domain"

export const PREVIEW_PROJECT = {
  id: "preview-project",
  path: "/preview-project",
  name: "交互预览 · 示例知识库",
}
const STATE_KEY = "llm-wiki-interactive-preview-v1"
const now = new Date().toISOString()
const topics = ["资料入库", "知识领域", "智能体记忆", "任务管理"]
const domainIds = topics.map((_, i) => `demo-domain-${i}`)
const memories: WorkspaceData["memories"] = Array.from({ length: 64 }, (_, i) => createMemoryRecord({
  id: `demo-memory-${i}`,
  title: `${topics[Math.floor(i / 16)]} · 示例记忆 ${(i % 16) + 1}`,
  content: `这是用于体验界面的合成记忆，不是你的真实知识。\n\n你可以修改标题、内容、领域标签与关联，再切换回星海查看变化。\n记忆的正式分类方案仍等待你补充。`,
  category: `示例星团 ${Math.floor(i / 16) + 1}`,
  domainIds: [domainIds[Math.floor(i / 16)]],
  relatedIds: [`demo-memory-${(i + 1) % 64}`, `demo-memory-${(i + 3) % 64}`],
  createdAt: now,
  updatedAt: now,
}))
const seed: Record<string, string> = {}
const resourceDomains: Record<string, string[]> = {}
for (let i = 0; i < 24; i++) {
  const type = i % 3 === 0 ? "entity" : "concept"
  const directory = type === "entity" ? "entities" : "concepts"
  const path = `wiki/${directory}/page-${i}.md`
  seed[`${PREVIEW_PROJECT.path}/${path}`] =
    `---\ntype: ${type}\ntitle: ${topics[Math.floor(i / 6)]} · 示例页面 ${i + 1}\nsources: [示例资料.md]\n---\n# ${topics[Math.floor(i / 6)]} · 示例页面 ${i + 1}\n\n这是**当前改造版本的交互预览**，使用合成资料。\n\n## 可以体验\n\n- 在 Wiki 的编辑与预览模式间切换\n- 为页面勾选多个知识领域\n- 查看 Wiki 建立时间与原始文件入库时间\n- 从检查入口运行结构检查，在任务管理器查看结果\n\n相关页面：[[page-${(i + 1) % 24}]]、[[page-${(i + 4) % 24}]]。\n`
  resourceDomains[path] = [domainIds[Math.floor(i / 6)]]
}
seed[`${PREVIEW_PROJECT.path}/raw/sources/示例资料.md`] =
  "# 示例资料\n\n这是合成资料，用于预览资料列表与页面导航，不读取本地文件。"
seed[`${PREVIEW_PROJECT.path}/purpose.md`] = "# 示例知识库\n用于体验本次改造的界面与交互。"
seed[`${PREVIEW_PROJECT.path}/schema.md`] = "# 知识结构\n实体与概念通过 Wiki 链接关联。"
seed[`${PREVIEW_PROJECT.path}/.llm-wiki/workspace.json`] = JSON.stringify({
  version: 1,
  domains: topics.map((name, i) => ({ id: domainIds[i], name })),
  resourceDomains,
  memories,
})
seed[`${PREVIEW_PROJECT.path}/.llm-wiki/project.json`] = JSON.stringify({
  id: PREVIEW_PROJECT.id,
  createdAt: Date.now(),
})
seed[`${PREVIEW_PROJECT.path}/.llm-wiki/ingest-records.json`] = JSON.stringify({
  version: 1,
  vaultPath: null,
  receipts: {},
  sources: {
    [`${PREVIEW_PROJECT.path}/raw/sources/示例资料.md`]: {
      id: "demo-source",
      originalPath: null,
      receivedAt: now,
      ingestedAt: now,
    },
  },
  pages: Object.fromEntries(
    Object.keys(resourceDomains).map((path) => [
      path,
      { createdAt: now, sources: [`${PREVIEW_PROJECT.path}/raw/sources/示例资料.md`] },
    ]),
  ),
})
let files: Map<string, string>
try {
  const saved = sessionStorage.getItem(STATE_KEY)
  files = new Map(saved ? Object.entries(JSON.parse(saved)) : Object.entries(seed))
} catch {
  files = new Map(Object.entries(seed))
}
function save() {
  try {
    sessionStorage.setItem(STATE_KEY, JSON.stringify(Object.fromEntries(files)))
  } catch {
    /* session storage may be disabled */
  }
}
export function resetPreview() {
  try {
    sessionStorage.removeItem(STATE_KEY)
  } catch {
    /* no persistence */
  }
  location.reload()
}
function tree(path: string, hidden: boolean): FileNode[] {
  const prefix = path.replace(/\/$/, "") + "/"
  const names = new Set(
    [...files.keys()]
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length).split("/")[0])
      .filter((name) => hidden || !name.startsWith(".")),
  )
  return [...names].sort().map((name) => {
    const full = prefix + name
    const directory = !files.has(full)
    return {
      name,
      path: full,
      is_dir: directory,
      ...(directory ? { children: tree(full, hidden) } : {}),
    }
  })
}
const settings = new Map<string, unknown>([
  ["language", "zh"],
  ["updateCheckEnabled", false],
])
let callbackId = 1
const callbacks = new Map<number, unknown>()
Object.defineProperty(window, "__TAURI_INTERNALS__", {
  configurable: true,
  value: {
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    transformCallback(fn: unknown) {
      const id = callbackId++
      callbacks.set(id, fn)
      return id
    },
    unregisterCallback(id: number) {
      callbacks.delete(id)
    },
    convertFileSrc(path: string) {
      return path
    },
    async invoke(command: string, args: Record<string, unknown> = {}) {
      const path = String(args.path ?? "")
      if (command === "plugin:store|load") return 1
      if (command === "plugin:store|get")
        return [settings.get(String(args.key)), settings.has(String(args.key))]
      if (command === "plugin:store|set") {
        settings.set(String(args.key), args.value)
        return
      }
      if (command === "plugin:store|entries") return [...settings.entries()]
      if (command === "plugin:autostart|is_enabled") return false
      if (command === "plugin:event|listen") return callbackId++
      if (command === "plugin:dialog|open" || command === "plugin:dialog|save") return null
      if (command === "plugin:opener|open_path" || command === "plugin:opener|open_url") return
      if (command === "file_exists")
        return files.has(path) || [...files.keys()].some((key) => key.startsWith(path + "/"))
      if (command === "read_file" || command === "preprocess_file") {
        if (!files.has(path)) throw new Error("预览中没有此示例文件")
        return files.get(path)
      }
      if (command === "write_file" || command === "write_file_atomic") {
        files.set(path, String(args.contents))
        save()
        return
      }
      if (command === "delete_file") {
        for (const key of files.keys())
          if (key === path || key.startsWith(path + "/")) files.delete(key)
        save()
        return
      }
      if (command === "create_directory") return
      if (command === "list_directory") return tree(path, Boolean(args.includeHidden))
      if (command === "open_project") return PREVIEW_PROJECT
      if (command === "clip_server_status") return "running"
      if (command === "get_file_modified_time") return Date.now()
      if (command === "get_file_size") return new TextEncoder().encode(files.get(path) ?? "").length
      if (command === "get_page_links") return { outgoing: [], backlinks: [], missing: [] }
      if (command === "list_file_history" || command === "agent_list_skills") return []
      if (command === "get_file_history_stats") return { bytes: 0, files: 0 }
      if (command === "search_project") {
        const query = String(args.query ?? "").toLocaleLowerCase()
        const results = [...files.entries()]
          .filter(
            ([key, content]) =>
              key.includes("/wiki/") && content.toLocaleLowerCase().includes(query),
          )
          .slice(0, 20)
          .map(([key, content]) => ({
            path: key.slice(PREVIEW_PROJECT.path.length + 1),
            title: content.match(/^title: (.*)$/m)?.[1] ?? key.split("/").pop(),
            snippet: content.replace(/^---[\s\S]*?---\n/, "").slice(0, 200),
            score: 1,
            titleMatch: true,
            images: [],
          }))
        return { mode: "keyword", results, tokenHits: results.length, vectorHits: 0 }
      }
      if (
        command.startsWith("plugin:") ||
        command.startsWith("set_") ||
        command.startsWith("stop_")
      )
        return null
      throw new Error("交互预览未接入此原生/模型功能，请使用桌面版进行真实操作。")
    },
  },
})
// Preview never contacts clip servers, model APIs or third-party search services.
window.fetch = async () =>
  new Response(JSON.stringify({ ok: false, clips: [], error: "预览未连接外部服务" }), {
    status: 503,
    headers: { "Content-Type": "application/json" },
  })
// Keep offline preview self-contained, using the existing synchronous graph fallbacks.
Object.defineProperty(window, "Worker", { configurable: true, value: undefined })
