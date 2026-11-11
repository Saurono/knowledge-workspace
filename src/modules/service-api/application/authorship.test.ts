import { expect, it, vi } from "vitest"
import { createSharedService } from "./service"
import type { SharedRepository } from "./ports"
import type { ResourceRecord, WikiContent } from "../domain"
import { resourceTool } from "../../../../server/resource-tools"
import type { AccessContext } from "@/modules/identity/domain"
const actor = { kind: "user" as const, id: "alice", entrypoint: "api" }
function fixture() {
  let stored: ResourceRecord<WikiContent> | null = null
  const save = vi.fn(async (projectId, kind, key, data, _expected, now) => (stored = { projectId, kind, key, data, revision: (stored?.revision ?? 0) + 1, createdAt: now, updatedAt: now }))
  const repository = { project: async () => ({ id: "p", name: "p", createdAt: "old" }), get: async () => stored, save } as unknown as SharedRepository
  return { service: createSharedService(repository, { id: () => "id", now: () => "trusted-time" }), save, seed: (value: ResourceRecord<WikiContent>) => { stored = value } }
}
it("rejects forged metadata before any repository write", async () => {
  const f = fixture()
  for (const key of ["authorship", "creator", "createdAt", "updatedAt"]) await expect(f.service.saveWiki("p", "wiki/a.md", { content: "x", [key]: "forged" }, null, actor)).rejects.toMatchObject({ code: "invalid_argument" })
  expect(f.save).not.toHaveBeenCalled()
})
it("keeps the first creator and records both trusted body revisions", async () => {
  const f = fixture()
  await f.service.saveWiki("p", "wiki/a.md", { content: "one" }, null, actor)
  const result = await f.service.saveWiki("p", "wiki/a.md", { content: "two" }, 1, { ...actor, id: "bob" })
  expect(result.data.authorship?.creator).toEqual(actor)
  expect(result.data.authorship?.revisions).toMatchObject([{ actor, createdAt: "trusted-time", revision: 1 }, { actor: { id: "bob" }, createdAt: "trusted-time", revision: 2 }])
})
it("reads legacy authorship as unknown", async () => {
  const f = fixture()
  f.seed({ projectId: "p", kind: "wiki", key: "wiki/a.md", data: { path: "wiki/a.md", content: "legacy" }, revision: 1, createdAt: "old", updatedAt: "old" })
  expect((await f.service.readWiki("p", "wiki/a.md")).data.authorship).toBeUndefined()
})
it("rejects forged metadata through wiki.write", async () => {
  const f = fixture()
  const context: AccessContext = { id: "ctx", effectiveAccountId: "alice", projectId: "p", workRoleId: null, capturedAt: "now", credential: { channel: "token", id: "token" }, basis: { membershipId: "m", catalogRevision: 1, tokenId: "token", delegationId: null }, actorKind: "user", actorId: "alice", entrypoint: "cli", permissions: ["wiki.write"] }
  for (const key of ["authorship", "createdAt"]) await expect(resourceTool(f.service, "p", "wiki.write", { content: "x", path: "wiki/a.md", expectedRevision: null, [key]: {} }, { context })).rejects.toMatchObject({ code: "invalid_argument" })
  expect(f.save).not.toHaveBeenCalled()
})
