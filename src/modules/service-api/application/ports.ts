import type { ProjectRecord, ResourceKind, ResourceRecord, ProjectEvent } from "../domain"
export interface SharedRepository {
  createProject(project: ProjectRecord, initialWorkspace: unknown): Promise<ProjectRecord>
  project(id: string): Promise<ProjectRecord | null>
  projects(after: string, limit: number): Promise<ProjectRecord[]>
  get(projectId: string, kind: ResourceKind, key: string): Promise<ResourceRecord | null>
  list(projectId: string, kind: ResourceKind, after: string, limit: number): Promise<ResourceRecord[]>
  save(projectId: string, kind: ResourceKind, key: string, data: unknown, expected: number | null, now: string): Promise<ResourceRecord>
  remove(projectId: string, kind: ResourceKind, key: string, expected: number, now: string): Promise<void>
  events(projectId: string, after: number, limit: number): Promise<ProjectEvent[]>
}
