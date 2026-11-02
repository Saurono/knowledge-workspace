import { createTaskRuntime, TaskCancelledError } from "@/modules/tasks"
import {
  createIngestExecutor,
  INGEST_EXECUTOR,
  type IngestExecutionInput,
} from "@/modules/ingestion/application"
import { autoIngest } from "@/lib/ingest"
import type { LlmConfig } from "@/stores/wiki-store"

/** The queue owns attempts, epochs and persistence; this adapter owns one execution. */
const executor = createIngestExecutor<LlmConfig>({
  compile: (input, context) =>
    autoIngest(
      input.projectPath,
      input.sourcePath,
      input.model,
      context.signal,
      input.folderContext,
      context.onFileWritten,
      { runCommit: input.runCommit, taskId: context.taskId, projectId: input.projectId, bindIdempotency: input.bindIdempotency },
    ),
})

export async function runQueuedIngest(
  input: IngestExecutionInput<LlmConfig>,
  request: { id: string; scopeId: string; signal: AbortSignal },
): Promise<string[]> {
  // A restored queue may reuse a logical ID while an aborted old attempt is
  // winding down. Never share execution slots or retain history across attempts.
  const runtime = createTaskRuntime()
  runtime.register(INGEST_EXECUTOR, executor)
  const result = await runtime.execute<IngestExecutionInput<LlmConfig>, string[]>(
    INGEST_EXECUTOR,
    input,
    request,
  )
  if (result.status === "cancelled") throw new TaskCancelledError()
  return result.value
}
