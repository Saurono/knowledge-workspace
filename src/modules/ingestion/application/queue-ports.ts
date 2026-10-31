import type { IngestExecutionInput } from "./execute-ingest"

/** Immutable serialized snapshots; adapter chooses storage location and transport. */
export interface QueueSnapshotRepository {
  read(projectPath: string): Promise<string>
  write(projectPath: string, snapshot: string): Promise<void>
}
export interface QueueClock {
  now(): number
  createId(): string
  setTimer(callback: () => void, delay: number): unknown
  clearTimer(handle: unknown): void
  defer(callback: () => void): void
}
export interface IngestQueuePorts<Model> {
  snapshots: QueueSnapshotRepository
  paths: { normalize(path: string): string; isAbsolute(path: string): boolean }
  projects: { getPath(projectId: string): Promise<string | null> }
  models: { read(): Model; isUsable(model: Model): boolean }
  execute(
    input: IngestExecutionInput<Model>,
    request: { id: string; scopeId: string; signal: AbortSignal },
  ): Promise<string[]>
  /** Resolve lazy capabilities before checking whether their queue scope is still current. */
  loadReviewSweep(): Promise<(projectPath: string, signal: AbortSignal) => Promise<unknown>>
  loadWikiCleanup(): Promise<(projectPath: string, fullPath: string) => Promise<unknown>>
  clampConcurrency(value: number): number
  clock?: QueueClock
  logger?: Pick<Console, "log" | "warn" | "error">
}
