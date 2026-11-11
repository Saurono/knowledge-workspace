import type { QualityFileNode, ReviewItem, StructuralLintFinding, StructuralLintPage } from "../domain"
import type { StructuralLintOptions } from "./lint"
export interface QualityActivity {
  addItem(input: { type: "lint" | "query"; title: string; parentTaskId?: string; status: "running" | "done" | "error" | "cancelled"; detail: string; filesWritten: string[] }): string
  updateItem(id: string, patch: { status?: "running" | "done" | "error" | "cancelled"; detail?: string }): void
}
export interface QualityCommonPorts<Config> {
  files: { read(path: string): Promise<string>; list(path: string): Promise<QualityFileNode[]> }
  paths: { normalizePath(path: string): string; getFileName(path: string): string; getRelativePath(path: string, root: string): string }
  activity(): QualityActivity
  stream(config: Config, messages: Array<{ role: "user"; content: string }>, callbacks: { onToken(token: string): void; onDone(): void; onError(error: Error): void }, signal?: AbortSignal): Promise<void>
}
export interface LintPorts<Config> extends QualityCommonPorts<Config> {
  languageDirective(content: string): string
  structural(pages: StructuralLintPage[], options: StructuralLintOptions): Promise<StructuralLintFinding[]>
}
export interface SweepPorts<Config> extends QualityCommonPorts<Config> {
  reviews(): { items: ReviewItem[]; resolveItem(id: string, action: string): void }
  modelConfig(): Config
  usable(config: Config): boolean
  parseFrontmatter(content: string): { frontmatter: Record<string, unknown> | null }
  scope(projectPath: string): () => boolean
}
