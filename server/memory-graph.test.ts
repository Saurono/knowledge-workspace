import { afterEach, beforeEach, expect, it } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AccessContext } from "@/modules/identity/domain"
import type { SharedWorkspace } from "@/modules/service-api/application/workspace"
import { createAuthorizedRepository } from "@/modules/service-api/application/authorized-repository"
import { SqliteRepository } from "./repository"

const at = "2026-11-10T00:00:00.000Z"
let directory: string, repository: SqliteRepository
const context: AccessContext = {
  id: "context", actorKind: "user", entrypoint: "test", actorId: "bob", effectiveAccountId: "bob",
  projectId: "p", workRoleId: null, credential: { channel: "session", id: "session" },
  permissions: ["memory.read"], basis: { membershipId: "membership", catalogRevision: 1, tokenId: null, delegationId: null }, capturedAt: at,
}
const read = () => createAuthorizedRepository(repository, async () => context, async () => [], () => at).memoryGraph("p", { limit: 50 })
async function seed(privateB = false, missing = false) {
  await repository.governanceSaveWorkspace("p", {
    version: 1, domains: [], resourceDomains: {}, memories: ["A", "B", "C"].map(id => ({
      id, title: id, content: "body", category: "fact", status: "active", version: 1,
      createdAt: at, updatedAt: at, domainIds: [], source: { kind: "user", actorId: "alice" },
      access: { visibility: privateB && id === "B" ? "private" : "project", ownerId: "alice" },
      relations: id === "A" ? [{ type: "related", targetId: "B" }, { type: "related", targetId: missing ? "missing" : "C" }] : [],
    })),
  } as unknown as SharedWorkspace, 1)
}
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "memory-graph-"))
  repository = new SqliteRepository(directory)
  await repository.createProject({ id: "p", name: "p", createdAt: at }, {})
})
afterEach(() => { repository.close(); rmSync(directory, { recursive: true, force: true }) })
it("returns three visible nodes and both relations", async () => {
  await seed(); const nodes = await read()
  expect(nodes).toHaveLength(3); expect(nodes.find(node => node.id === "A")?.relations).toHaveLength(2)
})
it("removes private nodes and relations to them", async () => {
  await seed(true); const nodes = await read()
  expect(nodes.map(node => node.id)).toEqual(["A", "C"])
  expect(nodes[0].relations.map(relation => relation.targetId)).toEqual(["C"])
})
it("prunes nonexistent targets without throwing", async () => {
  await seed(false, true)
  expect((await read())[0].relations.map(relation => relation.targetId)).toEqual(["B"])
})
it("omits content and authorization fields", async () => {
  await seed()
  for (const node of await read()) for (const key of ["content", "access", "source", "validityUntil"]) expect(Object.keys(node)).not.toContain(key)
})
