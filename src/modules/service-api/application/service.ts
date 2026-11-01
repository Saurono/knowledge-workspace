import { canonicalWikiPagePath } from "@/modules/wiki/domain"
import { ServiceError, pageInput, pageCursor, requireId } from "../domain"
import type { ProjectRecord, ResourceKind, ResourceRecord, WikiContent } from "../domain"
import type { SharedRepository } from "./ports"
import { emptySharedWorkspace, validateSharedWorkspace } from "./workspace"
export function createSharedService(repository: SharedRepository, context: { id(): string; now(): string }) {
  const project = async (id: string) => {
    requireId(id)
    const value = await repository.project(id)
    if (!value) throw new ServiceError("not_found", "Project not found")
    return value
  }
  const wikiPath = (path: string) => { try { return canonicalWikiPagePath(path) } catch { throw new ServiceError("invalid_argument", "Expected a relative Markdown path inside wiki/") } }
  const read = async (id: string, kind: ResourceKind, key: string) => {
    await project(id)
    const resource = await repository.get(id, kind, key)
    if (!resource) throw new ServiceError("not_found", "Resource not found")
    return resource
  }
  return {
    project,
    async createProject(name: unknown) {
      if (typeof name !== "string" || !name.trim() || name.trim().length > 120) throw new ServiceError("invalid_argument", "Project name must contain 1–120 characters")
      return repository.createProject({ id: context.id(), name: name.trim(), createdAt: context.now() }, emptySharedWorkspace())
    },
    async projects(limit?: string | null, cursor?: string | null) {
      const input = pageInput("projects", limit, cursor), values = await repository.projects(input.after, input.limit + 1)
      const items: ProjectRecord[] = values.slice(0, input.limit)
      return { items, nextCursor: values.length > input.limit ? pageCursor("projects", items[items.length - 1].id) : null }
    },
    async list(id: string, kind: ResourceKind, limit?: string | null, cursor?: string | null) {
      await project(id)
      const scope = `${id}:${kind}`, input = pageInput(scope, limit, cursor)
      const values = await repository.list(id, kind, input.after, input.limit + 1), items = values.slice(0, input.limit)
      return { items, nextCursor: values.length > input.limit ? pageCursor(scope, items[items.length - 1].key) : null }
    },
    readWiki: (id: string, path: string) => read(id, "wiki", wikiPath(path)) as Promise<ResourceRecord<WikiContent>>,
    async saveWiki(id: string, path: string, content: unknown, expected: number | null) {
      await project(id)
      const canonical = wikiPath(path)
      if (typeof content !== "string") throw new ServiceError("invalid_argument", "Wiki content must be text")
      return repository.save(id, "wiki", canonical, { path: canonical, content }, expected, context.now()) as Promise<ResourceRecord<WikiContent>>
    },
    async removeWiki(id: string, path: string, expected: number | null) {
      await project(id)
      if (expected === null) throw new ServiceError("invalid_argument", "Deletion requires an existing revision")
      await repository.remove(id, "wiki", wikiPath(path), expected, context.now())
    },
    readWorkspace: (id: string) => read(id, "workspace", "default"),
    async saveWorkspace(id: string, value: unknown, expected: number | null) {
      await project(id)
      return repository.save(id, "workspace", "default", validateSharedWorkspace(value), expected, context.now())
    },
    async events(id: string, after: number, limit = 100) {
      await project(id)
      if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new ServiceError("invalid_argument", "Invalid event cursor or limit")
      return repository.events(id, after, limit)
    },
  }
}
