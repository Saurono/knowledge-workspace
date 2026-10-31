import type { TaskExecutor } from "@/modules/tasks"
import type { QualityFinding, WikiCheckConfig } from "../domain/check"
export interface WikiCheckInput<Model> {
  projectPath: string
  config: WikiCheckConfig
  semantic: boolean
  model: Model
}
export interface WikiCheckPorts<Model> {
  structural(
    projectPath: string,
    options: {
      config: WikiCheckConfig
      signal: AbortSignal
      onProgress: (completed: number, total: number) => void
    },
  ): Promise<QualityFinding[]>
  semantic(
    projectPath: string,
    model: Model,
    signal: AbortSignal,
    parentTaskId: string,
  ): Promise<QualityFinding[]>
  hasUsableModel(model: Model): boolean
}
export const WIKI_CHECK_EXECUTOR = "wiki.check"
export function createWikiCheckExecutor<Model>(
  ports: WikiCheckPorts<Model>,
): TaskExecutor<WikiCheckInput<Model>, QualityFinding[]> {
  return {
    async execute(input, context) {
      context.assertCurrent()
      const structural = await ports.structural(input.projectPath, {
        config: input.config,
        signal: context.signal,
        onProgress: (completed, total) =>
          context.progress(`Structural check: ${completed}/${total}`),
      })
      context.assertCurrent()
      const semantic =
        input.semantic && ports.hasUsableModel(input.model)
          ? await ports.semantic(input.projectPath, input.model, context.signal, context.taskId)
          : []
      context.assertCurrent()
      const findings = [...structural, ...semantic]
      context.progress(`${findings.length} findings`)
      return findings
    },
  }
}
