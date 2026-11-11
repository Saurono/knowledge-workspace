import { expect, it } from "vitest"
import type { AccessContext, MemoryGrant } from "@/modules/identity/domain"
import { createMemoryRecord } from "@/modules/memory/domain"
import { recallForContext } from "./memory-recall"
const now = "2026-11-10T00:00:00Z"
const context: AccessContext = { id: "c", actorKind: "user", entrypoint: "web", actorId: "alice", effectiveAccountId: "alice", projectId: "p", workRoleId: "r", credential: { channel: "session", id: "s" }, permissions: ["memory.read"], basis: { membershipId: "m", catalogRevision: 1, tokenId: null, delegationId: null }, capturedAt: now }
const privateMemory = createMemoryRecord({ id: "m", title: "secret", content: "private body", category: "general", domainIds: [], relatedIds: [], createdAt: now, updatedAt: now, access: { visibility: "private", ownerId: "bob" } })
const workspace = { version: 1 as const, domains: [], resourceDomains: {}, memories: [privateMemory] }
const grant: MemoryGrant = { id: "g", projectId: "p", memoryId: "m", ownerId: "bob", accountId: "alice", actions: ["read"], expiresAt: "2026-12-01T00:00:00Z", revokedAt: null }
it("injects private memory only with a valid grant and reports scope", () => {
  expect(recallForContext(workspace, context, [], { now, limit: 5 }).injection.text).toBe("")
  const result = recallForContext(workspace, context, [grant], { now, limit: 5 })
  expect(result.injection.text).toContain("private body")
  expect(result.recall.scope).toMatchObject({ projectId: "p", workRoleId: "r", permission: "memory.read", authorize: "injected" })
})
it("excludes candidates for non-creators", () => {
  const result = recallForContext({ ...workspace, memories: [{ ...privateMemory, status: "candidate", source: { kind: "user", actorId: "bob" } }] }, context, [grant], { now, limit: 5 })
  expect(result.injection.text).toBe("")
  expect(result.recall.scope.excluded).toEqual([{ id: "m", reason: "not-active" }])
})
