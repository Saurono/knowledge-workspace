import type { TaskExecutor } from "@/modules/tasks"

/** Queue-owned commit turn; does not acquire the project/source lock itself. */
export type IngestCommitRunner = <T>(operation: () => Promise<T>) => Promise<T>

export interface IngestExecutionInput<Model> {
  projectId: string
  projectPath: string
  sourcePath: string
  sourceId?: string
  sourceRevision?: string
  idempotencyKey?: string
  bindIdempotency?: (identity: { sourceId: string; sourceRevision: string; idempotencyKey: string }) => Promise<void>
  model: Model
  folderContext?: string
  runCommit?: IngestCommitRunner
  onFileWritten?: (relativePath: string) => void
}

export interface IngestCompiler<Model> {
  compile(
    input: IngestExecutionInput<Model>,
    context: {
      taskId: string
      signal: AbortSignal
      onFileWritten(relativePath: string): void
    },
  ): Promise<string[]>
}

export const INGEST_EXECUTOR = "ingestion.compile"

/** Pure use-case orchestration; parser, model, writes and receipts are injected. */
export function createIngestExecutor<Model>(
  compiler: IngestCompiler<Model>,
): TaskExecutor<IngestExecutionInput<Model>, string[]> {
  return {
    async execute(input, context) {
      context.assertCurrent()
      const written = await compiler.compile(input, {
        taskId: context.taskId,
        signal: context.signal,
        onFileWritten: (relativePath) => {
          // An atomic commit can finish after cancellation. Preserve the write
          // notification so callers can account for existing merged pages.
          input.onFileWritten?.(relativePath)
          context.progress(relativePath)
        },
      })
      context.assertCurrent()
      if (written.length === 0) throw new Error("Ingest produced no output files")
      return written
    },
  }
}
