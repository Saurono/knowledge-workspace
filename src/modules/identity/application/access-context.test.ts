import { describe, expect, it } from "vitest"
import { captureAccessContext } from "./access-context"
import { emptyIdentityCatalog, requireContextPermission } from "../domain"
import type { IdentitySnapshot, Principal } from "../domain"
const now = "2026-11-01T00:00:00.000Z", runtime = { id: () => "context", now: () => now }
function fixture(): IdentitySnapshot {
  return { revision: 4, catalog: { ...emptyIdentityCatalog(), accounts: [{ id: "agent", handle: "agent", displayName: "Agent", kind: "agent", status: "active", createdAt: now, updatedAt: now }], memberships: [{ id: "member", accountId: "agent", projectId: "project", status: "active", permissionRole: "editor", workRoleIds: ["role"], createdAt: now, updatedAt: now }], workRoles: [{ id: "role", projectId: "project", name: "Reader", description: "", status: "active", permissionRole: "viewer", permissions: ["project.read", "wiki.read"], createdAt: now, updatedAt: now }] } }
}
const principal: Principal = { accountId: "agent", credentialId: "token", channel: "token", scope: { projectId: "project", workRoleId: null, permissions: ["project.read", "wiki.read", "wiki.write"] } }
describe("trusted AccessContext capture", () => {
  it("records actual/effective identity and authority, intersects scope, and freezes independent execution snapshots", () => {
    const catalog = fixture(), first = captureAccessContext(catalog, principal, "project", runtime)
    const second = captureAccessContext(catalog, principal, "project", runtime, "role", "cli")
    expect(first.actorKind).toBe("user")
    expect(first.entrypoint).toBe("api")
    expect(second.entrypoint).toBe("cli")
    expect(first).toMatchObject({ actorId: "agent", effectiveAccountId: "agent", credential: { id: "token", channel: "token" }, basis: { membershipId: "member", catalogRevision: 4, tokenId: "token", delegationId: null } })
    expect(first.permissions).toContain("wiki.write"); expect(second.permissions).toEqual(["project.read", "wiki.read"])
    expect(() => requireContextPermission(second, "wiki.write")).toThrow()
    expect(Object.isFrozen(first)).toBe(true); expect(Object.isFrozen(first.permissions)).toBe(true); expect(Object.isFrozen(first.basis)).toBe(true)
    catalog.catalog.memberships[0].status = "revoked"
    expect(first.permissions).toContain("wiki.write") // Captured identity never inherits another context's changes.
    expect(() => captureAccessContext(catalog, principal, "project", runtime)).toThrow()
  })
  it("rejects spoofed projects, missing Token scope, ungranted roles and roles outside a pinned Token", () => {
    const catalog = fixture()
    for (const action of [() => captureAccessContext(catalog, principal, "other", runtime), () => captureAccessContext(catalog, { ...principal, scope: undefined }, "project", runtime), () => captureAccessContext(catalog, principal, "project", runtime, "missing"), () => captureAccessContext(catalog, { ...principal, scope: { ...principal.scope!, workRoleId: "role" } }, "project", runtime, "other")]) expect(action).toThrow()
  })
})

it("captures delegated agent as the real actor", async () => {
  const { createContextService } = await import("./delegation")
  const snapshot = fixture()
  snapshot.catalog.accounts.push({ ...snapshot.catalog.accounts[0], id: "human", kind: "user" })
  snapshot.catalog.memberships.push({ ...snapshot.catalog.memberships[0], id: "human-member", accountId: "human" })
  const service = createContextService({ identities: async () => snapshot, delegations: async () => [{ id: "grant", grantorId: "human", granteeId: "agent", projectId: "project", workRoleId: null, permissions: ["project.read", "wiki.write"], expiresAt: "2099-01-01T00:00:00Z", createdAt: now, revokedAt: null }], saveDelegation: async () => {}, revokeDelegation: async () => {}, context: async () => null, saveContext: async () => {} }, runtime)
  const access = await service.capture(principal, "project", { effectiveAccountId: "human", delegationId: "grant" })
  expect(access.actorId).toBe("agent")
  expect(access.effectiveAccountId).toBe("human")
  expect(access.actorKind).toBe("agent")
  expect(access.entrypoint).toBe("api")
})
