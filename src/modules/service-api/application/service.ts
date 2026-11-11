import { canonicalWikiPagePath } from "@/modules/wiki/domain"
import { compactRevisions, createMemoryRecord, expireDue, migrateMemoriesV1, validateMemories, type MemoryRecord } from "@/modules/memory/domain"
import { createMemoryService, MemoryWriteError, type MemoryIdempotencyStore } from "@/modules/memory/application"
import { ServiceError, pageInput, pageCursor, requireId } from "../domain"
import type { ProjectRecord, ResourceKind, ResourceRecord, WikiContent } from "../domain"
import type { SharedRepository } from "./ports"
import type { ProposalActor, SubmitProposalInput, WriteProposal } from "../domain/protocol"
const stableProposalValue = (value: unknown): unknown => Array.isArray(value) ? value.map(stableProposalValue) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stableProposalValue(item)])) : value
import { emptySharedWorkspace, validateSharedWorkspace } from "./workspace"
import { canonicalDomainResourceKey, filterMatches, normalizeDomainFilter, type DomainFilter } from "@/modules/domains/domain"
const MEMORY_CONTENT_MAX_BYTES = 32 * 1024
const MEMORY_COUNT_MAX = 2000
async function memoryContentHash(title: string, content: string): Promise<string> {
  const normalized = (title + "\n" + content).trim().replace(/\s+/g, " ")
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")
}
async function checkMemoryWrite(record: MemoryRecord, memories: MemoryRecord[]) {
  if (new TextEncoder().encode(record.title + "\n" + record.content).byteLength > MEMORY_CONTENT_MAX_BYTES)
    throw new ServiceError("too_large", "Memory content is too large")
  const contentHash = await memoryContentHash(record.title, record.content)
  const live = memories.filter(item => item.id !== record.id && (item.status === "active" || item.status === "candidate"))
  const duplicate = live.find(item => item.contentHash === contentHash)
  if (duplicate) throw new ServiceError("conflict", "Duplicate memory content", { duplicateOf: duplicate.id })
  if (live.length + Number(record.status === "active" || record.status === "candidate") > MEMORY_COUNT_MAX)
    throw new ServiceError("too_many_requests", "Memory quota exceeded")
  record.contentHash = contentHash
}
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
    async readMemoryGraph(id: string, limitInput?: string | null) {
      await project(id)
      const limit = limitInput === null || limitInput === undefined || limitInput === "" ? 500 : Number(limitInput)
      if (!Number.isInteger(limit) || limit < 1 || limit > 2000) throw new ServiceError("invalid_argument", "Invalid limit")
      return { items: await repository.memoryGraph(id, { limit }) }
    },
    async readMemorySummaries(id: string, limitInput?: string | null, cursorInput?: string | null) {
      await project(id)
      const limit = limitInput ? Number(limitInput) : 50
      if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new ServiceError("invalid_argument", "Invalid limit")
      let after: { updatedAt: string; id: string } | null = null
      if (cursorInput) {
        const parts = cursorInput.split("|")
        if (parts.length !== 2 || !Number.isFinite(Date.parse(parts[0]))) throw new ServiceError("invalid_argument", "Invalid cursor")
        after = { updatedAt: parts[0], id: parts[1] }
      }
      const result = await repository.memorySummaries(id, { limit, after })
      return { items: result.items, nextCursor: result.nextCursor ? `${result.nextCursor.updatedAt}|${result.nextCursor.id}` : null }
    },
    async expireMemories(id: string, now: string): Promise<{ expired: number; revision: number }> {
      const workspace = await repository.governanceWorkspace(id)
      if (!workspace) throw new ServiceError("not_found", "Resource not found")
      const data = validateSharedWorkspace(workspace.data)
      const previous = migrateMemoriesV1(data.memories)
      const memories = expireDue(previous, now)
      const expired = memories.filter((memory, index) => memory !== previous[index]).length
      if (!expired) return { expired: 0, revision: workspace.revision }
      validateMemories(memories)
      const saved = await repository.governanceSaveWorkspace(id, { ...data, memories }, workspace.revision)
      return { expired, revision: saved.revision }
    },
    async promoteMemory(id: string, memoryId: string, actor: ProposalActor) {
      return this.changeMemory(id, memoryId, "promote", actor)
    },
    async resolveConflict(id: string, aId: string, bId: string, decision: "a-canonical" | "both-intentional" | "merged", actor: ProposalActor, note?: string) {
      const workspace = await repository.governanceWorkspace(id)
      if (!workspace) throw new ServiceError("not_found", "Resource not found")
      const data = validateSharedWorkspace(workspace.data)
      let memories = expireDue(migrateMemoriesV1(data.memories), context.now())
      const service = createMemoryService({ read: async () => memories, update: async (_path, change) => { memories = change(memories); return memories } }, context.now)
      try { await service.resolve(id, aId, bId, decision, { kind: actor.kind, actorId: actor.id }, note) }
      catch { throw new ServiceError("conflict", "Resolution requires two active memories") }
      await repository.governanceSaveWorkspace(id, { ...data, memories }, workspace.revision)
      return { memories: memories.filter(item => item.id === aId || item.id === bId) }
    },
    async archiveMemory(id: string, memoryId: string, actor: ProposalActor) {
      return this.changeMemory(id, memoryId, "archive", actor)
    },
    async supersedeMemory(id: string, oldId: string, newId: string, actor: ProposalActor) {
      return this.changeMemory(id, oldId, "supersede", actor, newId)
    },
    async changeMemory(id: string, memoryId: string, operation: "promote" | "archive" | "supersede", actor: ProposalActor, newId?: string): Promise<{ memory: MemoryRecord; revision: number }> {
      const workspace = await repository.governanceWorkspace(id)
      if (!workspace) throw new ServiceError("not_found", "Resource not found")
      const data = validateSharedWorkspace(workspace.data)
      let memories = expireDue(migrateMemoriesV1(data.memories), context.now())
      const current = memories.find(item => item.id === memoryId)
      if (!current || (operation === "supersede" && !memories.some(item => item.id === newId))) throw new ServiceError("not_found", "Memory not found")
      const source = { kind: actor.kind, actorId: actor.id }
      const memoryService = createMemoryService({ read: async () => memories, update: async (_path, change) => { memories = change(memories); return memories } })
      try {
        if (operation === "promote" && current.status !== "candidate") throw new Error()
        if (operation === "supersede" && (current.status !== "active" || memories.find(item => item.id === newId)?.status !== "active")) throw new Error()
        if (operation === "supersede") await memoryService.supersede(id, memoryId, newId!, source)
        else await memoryService[operation](id, memoryId, source)
        validateMemories(memories)
      } catch { throw new ServiceError("conflict", "Invalid memory transition") }
      const saved = await repository.governanceSaveWorkspace(id, { ...data, memories }, workspace.revision)
      return { memory: memories.find(item => item.id === memoryId)!, revision: saved.revision }
    },
    async writeMemory(id: string, memoryId: string, input: Record<string, unknown>, options: { expectedVersion: number | null; idempotencyKey?: string }, actor: ProposalActor): Promise<{ memory: MemoryRecord; revision: number; replayed: boolean }> {
      const workspace = await repository.governanceWorkspace(id)
      if (!workspace) throw new ServiceError("not_found", "Resource not found")
      const data = validateSharedWorkspace(workspace.data)
      let memories = expireDue(migrateMemoriesV1(data.memories), context.now())
      const previous = memories.find(item => item.id === memoryId)
      try {
        if (!input || typeof input !== "object" || Array.isArray(input) || (options.expectedVersion !== null && !Number.isInteger(options.expectedVersion)) || (options.idempotencyKey !== undefined && typeof options.idempotencyKey !== "string")) throw new ServiceError("invalid_argument", "Invalid memory write")
        const approvedFields = new Set(["title", "content", "category", "domainIds", "relatedIds", "access", "importance", "credibility", "validity"])
        if (Object.keys(input).some(key => !approvedFields.has(key))) throw new ServiceError("invalid_argument", "Only approved memory fields may be written")
        const fingerprint = JSON.stringify(stableProposalValue([id, memoryId, input, options, actor]))
        const prior = options.idempotencyKey === undefined ? null : await repository.memoryWriteReplay(id, options.idempotencyKey)
        if (prior && prior.fingerprint !== fingerprint) throw new MemoryWriteError("idempotency_conflict", "Idempotency key conflict")
        type Stored = { record: MemoryRecord; entry: NonNullable<Awaited<ReturnType<MemoryIdempotencyStore["get"]>>> }
        const stored = prior?.result as Stored | undefined
        const record = stored?.record ?? createMemoryRecord({ ...previous, ...input, status: previous?.status ?? "active", id: memoryId, source: { kind: actor.kind, actorId: actor.id }, createdAt: previous?.createdAt ?? context.now(), updatedAt: context.now() } as Parameters<typeof createMemoryRecord>[0])
        const memoryKeys: MemoryIdempotencyStore = {
          get: async () => stored?.entry ?? null,
          put: (projectPath, key, entry) => repository.saveMemoryWriteReplay(projectPath, key, { fingerprint, result: { record, entry } }),
        }
        let revision = workspace.revision
        const result = await createMemoryService({ read: async () => memories, update: async (_path, change) => {
          const changed = change(memories)
          await checkMemoryWrite(changed.find(item => item.id === memoryId)!, memories)
          const candidate = changed.find(item => item.id === memoryId)!
          const fields = (item: MemoryRecord) => [item.title, item.content, item.category, item.domainIds, item.relatedIds, item.access, item.importance, item.credibility, item.validity, item.status, item.relations]
          if (previous && JSON.stringify(stableProposalValue(fields(candidate))) === JSON.stringify(stableProposalValue(fields(previous)))) return memories
          const { record: compacted, archived } = compactRevisions(changed.find(item => item.id === memoryId)!)
          if (archived.length > 0) await repository.archiveMemoryRevisions(id, compacted.id, archived)
          const next = validateMemories(changed.map(item => item.id === memoryId ? compacted : item))
          // Persist lazy expiry first via the workspace path, then atomically write this memory.
          if (JSON.stringify(memories) !== JSON.stringify(migrateMemoriesV1(data.memories))) {
            await repository.governanceSaveWorkspace(id, { ...data, memories }, workspace.revision)
          }
          const saved = await repository.saveMemoryAtomic(id, compacted, { memoryVersion: previous?.version ?? null }, context.now())
          revision = saved.revision
          memories = next
          return memories
        } }, memoryKeys).write(id, structuredClone(record), options)
        return { memory: result.record, revision, replayed: result.replayed }
      } catch (error) {
        if (error instanceof ServiceError) throw error
        if (error instanceof Error && error.message.startsWith("conflict: memory ")) throw new ServiceError("conflict", error.message, { currentVersion: previous?.version ?? null })
        if (error instanceof MemoryWriteError) throw new ServiceError(error.code === "version_conflict" || error.code === "idempotency_conflict" ? "conflict" : error.code, error.message, { currentVersion: previous?.version ?? null })
        throw new ServiceError("invalid_argument", "Invalid memory payload")
      }
    },
    proposals: async (id: string) => { await project(id); return (await repository.proposals(id)).sort((a, b) => Number(b.status === "pending") - Number(a.status === "pending") || b.createdAt.localeCompare(a.createdAt)) },
    proposal: async (id: string, proposalId: string) => { await project(id); return repository.proposal(id, proposalId) },
    async submitProposal(id: string, input: SubmitProposalInput, actor: ProposalActor): Promise<{ proposal: WriteProposal; created: boolean }> {
      await project(id)
      if (!Array.isArray(input.evidence) || !input.evidence.length) throw new ServiceError("invalid_argument", "Proposal evidence is required")
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(stableProposalValue({ target: input.target, actor: { kind: actor.kind, id: actor.id, model: actor.model }, evidence: input.evidence }))))
      const fingerprint = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("")
      const prior = (await repository.proposals(id)).find(value => value.idempotencyKey === input.idempotencyKey)
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new ServiceError("conflict", "Idempotency key already has a different proposal")
        return { proposal: prior, created: false }
      }
      const proposal = await repository.saveProposal({ id: context.id(), projectId: id, status: "pending", target: input.target, idempotencyKey: input.idempotencyKey, fingerprint, source: { kind: actor.kind, actorId: actor.id, model: actor.model, entrypoint: actor.entrypoint }, evidence: input.evidence, createdAt: context.now() })
      return { proposal, created: true }
    },
    async approveProposal(id: string, proposalId: string, actor: ProposalActor & { via: "rule" | "manual" }): Promise<WriteProposal> {
      await project(id)
      const proposal = await repository.proposal(id, proposalId)
      if (!proposal) throw new ServiceError("not_found", "Proposal not found")
      if (proposal.status !== "pending") throw new ServiceError("conflict", "Proposal is already decided")
      if (proposal.target.kind === "memory") {
        const { createMemoryRecord, migrateMemoriesV1, validateMemories } = await import("@/modules/memory/domain")
        const { createMemoryService } = await import("@/modules/memory/application")
        const workspace = await this.readWorkspace(id)
        const data = validateSharedWorkspace(workspace.data)
        let memories = expireDue(migrateMemoriesV1(data.memories), context.now())
        const expired = memories
        const target = proposal.target
        const payload = target.payload as Record<string, unknown>
        if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
          ["title", "content"].some(key => typeof payload[key] !== "string" || !(payload[key] as string).trim()))
          throw new ServiceError("invalid_argument", "Memory title and content are required")
        const memoryId = target.memoryId ?? context.id()
        const previous = memories.find(memory => memory.id === memoryId)
        if (target.memoryId !== null && !previous) throw new ServiceError("not_found", "Memory not found")
        if ((target.memoryId !== null || payload.id !== undefined) && payload.id !== memoryId)
          throw new ServiceError("invalid_argument", "Memory payload id must match target")
        try {
          const record = createMemoryRecord({
            id: memoryId, title: payload.title as string, content: payload.content as string, category: (typeof payload.category === "string" ? payload.category : ""),
            domainIds: (payload.domainIds ?? []) as string[], relatedIds: (payload.relatedIds ?? []) as string[],
            access: payload.access as Parameters<typeof createMemoryRecord>[0]["access"],
            importance: payload.importance as number | null | undefined, credibility: payload.credibility as number | null | undefined,
            validity: payload.validity as Parameters<typeof createMemoryRecord>[0]["validity"],
            createdAt: previous?.createdAt ?? context.now(), updatedAt: context.now(),
            // Evidence refs retain proposal order and are joined with literal commas.
            source: { kind: proposal.source.kind, actorId: proposal.source.actorId, ref: proposal.evidence.map(e => e.ref).join(",") },
          })
          if (previous) { record.version = previous.version; record.revisions = previous.revisions; record.revisionCompaction = previous.revisionCompaction }
          await createMemoryService({ read: async () => memories, update: async (_path, update) => { memories = update(memories); return memories } }).save(id, record)
          await checkMemoryWrite(memories.find(item => item.id === memoryId)!, memories)
          const { record: compacted, archived } = compactRevisions(memories.find(item => item.id === memoryId)!)
          if (archived.length > 0) await repository.archiveMemoryRevisions(id, compacted.id, archived)
          memories = memories.map(item => item.id === memoryId ? compacted : item)
          validateMemories(memories)
        } catch (error) { if (error instanceof ServiceError) throw error; throw new ServiceError("invalid_argument", error instanceof Error ? error.message : "Invalid memory payload") }
        if (JSON.stringify(expired) !== JSON.stringify(migrateMemoriesV1(data.memories))) {
          await repository.governanceSaveWorkspace(id, { ...data, memories: expired }, workspace.revision)
        }
        let saved: { revision: number }
        try {
          saved = await repository.saveMemoryAtomic(id, memories.find(item => item.id === memoryId)!, { memoryVersion: previous?.version ?? null }, context.now())
        } catch (error) {
          if (error instanceof Error && error.message.startsWith("conflict: memory ")) throw new ServiceError("conflict", error.message)
          throw error
        }
        return repository.saveProposal({ ...proposal, status: "approved", decidedAt: context.now(), decidedBy: { actorId: actor.id, via: actor.via }, appliedRevision: saved.revision })
      }
      const saved = await this.saveWiki(id, proposal.target.path, { content: proposal.target.content }, proposal.target.expectedRevision, { kind: actor.kind, id: actor.id, entrypoint: actor.entrypoint })
      return repository.saveProposal({ ...proposal, status: "approved", decidedAt: context.now(), decidedBy: { actorId: actor.id, via: actor.via }, appliedRevision: saved.revision })
    },
    async approveProposals(id: string, input: { ids?: string[]; kind?: "wiki" | "memory"; dryRun?: boolean }, actor: ProposalActor & { via: "rule" | "manual" }): Promise<{ eligible: string[]; approved: string[]; failed: Array<{ id: string; code: string }> }> {
      const proposals = await this.proposals(id)
      const failed: Array<{ id: string; code: string }> = []
      if (!input.dryRun && input.ids) for (const proposalId of new Set(input.ids)) {
        const proposal = proposals.find(value => value.id === proposalId)
        if (!proposal || proposal.status !== "pending") failed.push({ id: proposalId, code: proposal ? "not_pending" : "not_found" })
      }
      const eligible = proposals.filter(value => value.status === "pending" && (!input.ids || input.ids.includes(value.id)) && (!input.kind || value.target.kind === input.kind)).map(value => value.id)
      const approved: string[] = []
      if (!input.dryRun) for (const proposalId of eligible) {
        try { await this.approveProposal(id, proposalId, actor); approved.push(proposalId) }
        catch (error) {
          if (!(error instanceof ServiceError) && !(error instanceof MemoryWriteError)) throw error
          failed.push({ id: proposalId, code: error.code })
        }
      }
      return { eligible, approved, failed }
    },
    async rejectProposal(id: string, proposalId: string, actor: ProposalActor & { via: "rule" | "manual" }, reason: string): Promise<WriteProposal> {
      await project(id)
      const proposal = await repository.proposal(id, proposalId)
      if (!proposal) throw new ServiceError("not_found", "Proposal not found")
      if (proposal.status !== "pending") throw new ServiceError("conflict", "Proposal is already decided")
      return repository.saveProposal({ ...proposal, status: "rejected", decidedAt: context.now(), decidedBy: { actorId: actor.id, via: actor.via }, rejectionReason: reason })
    },
    searchWiki: async (id: string, input: { query: string; limit: number; domainFilter?: string[] }) => { await project(id); return repository.searchWiki({ projectId: id, ...input }) },
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
    async list(id: string, kind: ResourceKind, limit?: string | null, cursor?: string | null, domainFilter?: DomainFilter) {
      await project(id)
      if (!domainFilter) {
        const scope = `${id}:${kind}`, input = pageInput(scope, limit, cursor)
        const values = await repository.list(id, kind, input.after, input.limit + 1), items = values.slice(0, input.limit)
        return { items, nextCursor: values.length > input.limit ? pageCursor(scope, items[items.length - 1].key) : null }
      }

      // Workspace read is deliberately first: the guarded adapter requires project.read
      // and returns only domain links the caller may observe. The resource scan then
      // independently requires the corresponding wiki.read/documents.read permission.
      const workspace = (await read(id, "workspace", "default")).data as ReturnType<typeof validateSharedWorkspace>
      let normalizedFilter: DomainFilter
      try { normalizedFilter = normalizeDomainFilter(workspace, domainFilter) }
      catch (error) { throw new ServiceError("invalid_argument", error instanceof Error ? error.message : "Invalid domain filter") }
      const filterScope = JSON.stringify(normalizedFilter)
      const scope = `${id}:${kind}:domains:${filterScope}`
      const input = pageInput(scope, limit, cursor)
      const items: ResourceRecord[] = []
      let after = input.after
      while (items.length <= input.limit) {
        const batch = await repository.list(id, kind, after, 200)
        if (!batch.length) break
        for (const resource of batch) {
          after = resource.key
          let resourceKey = ""
          if (kind === "wiki") resourceKey = resource.key
          else if (kind === "document") {
            const sourceId = (resource.data as { sourceId?: unknown })?.sourceId
            if (typeof sourceId !== "string") throw new ServiceError("internal", "Document is missing its stable source identity")
            try { resourceKey = canonicalDomainResourceKey("document", sourceId) }
            catch { throw new ServiceError("internal", "Document has an invalid stable source identity") }
          }
          if (filterMatches(workspace, resourceKey, normalizedFilter)) items.push(resource)
          if (items.length > input.limit) break
        }
        if (items.length > input.limit || batch.length < 200) break
      }
      const hasMore = items.length > input.limit
      const pageItems = items.slice(0, input.limit)
      return { items: pageItems, nextCursor: hasMore ? pageCursor(scope, pageItems[pageItems.length - 1].key) : null }
    },
    readWiki: (id: string, path: string) => read(id, "wiki", wikiPath(path)) as Promise<ResourceRecord<WikiContent>>,
    async saveWiki(id: string, path: string, input: unknown, expected: number | null, actor: { kind: "user" | "agent" | "system" | "admin"; id: string; entrypoint: string }) {
      if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => key !== "content")) throw new ServiceError("invalid_argument", "Only content is allowed")
      const content = (input as { content?: unknown }).content
      await project(id)
      const canonical = wikiPath(path)
      if (typeof content !== "string") throw new ServiceError("invalid_argument", "Wiki content must be text")
      const previous = await repository.get(id, "wiki", canonical) as ResourceRecord<WikiContent> | null
      const now = context.now()
      const trusted = { ...actor, kind: actor.kind === "admin" ? "user" as const : actor.kind }
      const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content))
      const contentHash = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("")
      const authorship = { ...previous?.data.authorship, creator: previous?.data.authorship?.creator ?? trusted, revisions: [...(previous?.data.authorship?.revisions ?? []), { revision: (previous?.data.authorship?.revisions?.length ?? 0) + 1, contentHash, actor: trusted, originKinds: [trusted.kind], createdAt: now, sourceRefs: [], evidenceRefs: [] }] }
      return repository.save(id, "wiki", canonical, { path: canonical, content, authorship }, expected, now) as Promise<ResourceRecord<WikiContent>>
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
