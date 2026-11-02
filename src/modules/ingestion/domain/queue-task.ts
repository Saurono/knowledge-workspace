export interface IngestTask {
  id: string
  /** Stable project UUID. Resolve its current path through the project
   * registry port at execution time; filesystem locations can change. */
  projectId: string
  sourcePath: string // relative to project: "raw/sources/folder/file.pdf"
  sourceId?: string
  sourceRevision?: string
  idempotencyKey?: string
  folderContext: string // e.g. "AI-Research > papers" or ""
  status: "pending" | "processing" | "done" | "failed" | "cancelled"
  addedAt: number
  error: string | null
  retryCount: number
}
