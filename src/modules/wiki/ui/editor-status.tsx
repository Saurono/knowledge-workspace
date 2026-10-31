export interface WikiEditorStatusProps {
  status: "loading" | "ready" | "saving" | "error" | "conflict"
  message?: string
  draft: string
  onReload(): void
  onRetry(): void
  onCopy(draft: string): void
}
export function WikiEditorStatus({ status, message, draft, onReload, onRetry, onCopy }: WikiEditorStatusProps) {
  if (status === "ready") return null
  if (status === "loading" || status === "saving") return <p role="status" className="border-b px-3 py-1 text-xs text-muted-foreground">{status === "loading" ? "正在读取…" : "正在保存…"}</p>
  return <div role="alert" className="space-y-2 border-b border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
    <p>{status === "conflict" ? "文件已被其他操作修改，自动保存已停止。当前草稿仍保留，请先复制草稿，再加载最新版本进行合并。" : "读取或保存失败，当前内容未被确认保存。"}</p>
    <p className="break-all text-muted-foreground">{message}</p>
    <div className="flex gap-3">
      <button type="button" onClick={() => onCopy(draft)}>复制草稿</button>
      <button type="button" onClick={onReload}>放弃草稿并加载最新版本</button>
      {status === "error" && <button type="button" onClick={onRetry}>重试</button>}
    </div>
  </div>
}
