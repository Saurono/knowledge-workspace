import { createIngestQueue } from "@/modules/ingestion/application"
import { runQueuedIngest } from "@/app/tasks/ingestion"
import { normalizePath, isAbsolutePath } from "@/lib/path-utils"
import { getProjectPathById } from "@/lib/project-identity"
import { hasUsableLlm } from "@/lib/has-usable-llm"
import { getTaskLlmConfig } from "@/lib/llm-task-routing"
import { clampUserConcurrency } from "@/lib/concurrency-limits"
import { localQueueSnapshots } from "./queue-repository"

/** One desktop queue instance; tests/Web services can supply different adapters. */
const queue = createIngestQueue({
  snapshots: localQueueSnapshots,
  paths: { normalize: normalizePath, isAbsolute: isAbsolutePath },
  projects: { getPath: getProjectPathById },
  models: { read: () => getTaskLlmConfig("ingest"), isUsable: hasUsableLlm },
  execute: runQueuedIngest,
  loadReviewSweep: async () => (await import("@/lib/sweep-reviews")).sweepResolvedReviews,
  loadWikiCleanup: async () => (await import("@/lib/wiki-page-delete")).cascadeDeleteWikiPage,
  clampConcurrency: clampUserConcurrency,
})

export const {
  subscribeIngestQueue,
  setIngestWorkerLimit,
  getIngestWorkerLimit,
  cleanupWrittenFiles,
  enqueueIngest,
  enqueueBatch,
  enqueueInactiveProjectBatch,
  discardInactiveProjectTasksForSources,
  retryTask,
  retryTasks,
  retryAllFailedTasks,
  retryAllStoppedTasks,
  movePendingTask,
  cancelTask,
  cancelTasks,
  removeTasks,
  hasActiveRun,
  retainQueuedSelection,
  removeTask,
  discardTasksForSources,
  clearCompletedTasks,
  cancelAllTasks,
  pauseProcessing,
  resumeProcessing,
  isQueuePaused,
  getQueue,
  getQueueSummary,
  clearQueueState,
  pauseQueue,
  restoreQueue,
} = queue
