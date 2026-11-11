import type { ProjectRecord, ResourceKind, ResourceRecord, ProjectEvent } from "../domain"
export interface SharedRepository {
  memoryGraph(projectId: string, options: { limit: number }): Promise<import("../domain/protocol").MemoryGraphNode[]>
  memorySummaries(projectId: string, options: { limit: number; after: import("../domain/protocol").MemorySummaryCursor | null }): Promise<{ items: import("../domain/protocol").MemorySummary[]; nextCursor: import("../domain/protocol").MemorySummaryCursor | null }>
  saveMemoryAtomic(projectId: string, next: unknown, expected: { memoryVersion: number | null }, now: string): Promise<{ revision: number; memory: unknown }>
  archiveMemoryRevisions(projectId: string, memoryId: string, revisions: Array<{ version: number; data: unknown }>): Promise<void>
  memoryWriteReplay(projectId: string, key: string): Promise<{ fingerprint: string; result: unknown } | null>
  saveMemoryWriteReplay(projectId: string, key: string, entry: { fingerprint: string; result: unknown }): Promise<void>
  governanceSaveWorkspace(projectId: string, data: import("./workspace").SharedWorkspace, expected: number | null): Promise<{ data: import("./workspace").SharedWorkspace; revision: number }>
  governanceWorkspace(projectId: string): Promise<{ data: import("./workspace").SharedWorkspace; revision: number } | null>
  proposals(projectId: string): Promise<import("../domain/protocol").WriteProposal[]>
  proposal(projectId: string, id: string): Promise<import("../domain/protocol").WriteProposal | null>
  saveProposal(proposal: import("../domain/protocol").WriteProposal): Promise<import("../domain/protocol").WriteProposal>
  searchWiki(input: { projectId: string; query: string; limit: number; domainFilter?: string[] }): Promise<Array<{ path: string; title: string; snippet: string; titleMatch: boolean; score: number }>>
  createProject(project: ProjectRecord, initialWorkspace: unknown): Promise<ProjectRecord>
  project(id: string): Promise<ProjectRecord | null>
  projects(after: string, limit: number): Promise<ProjectRecord[]>
  get(projectId: string, kind: ResourceKind, key: string): Promise<ResourceRecord | null>
  list(projectId: string, kind: ResourceKind, after: string, limit: number): Promise<ResourceRecord[]>
  save(projectId: string, kind: ResourceKind, key: string, data: unknown, expected: number | null, now: string): Promise<ResourceRecord>
  remove(projectId: string, kind: ResourceKind, key: string, expected: number, now: string): Promise<void>
  events(projectId: string, after: number, limit: number): Promise<ProjectEvent[]>
}
