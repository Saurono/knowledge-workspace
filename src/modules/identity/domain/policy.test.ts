import { describe, expect, it } from "vitest"
import { ACCOUNT_KINDS, PROJECT_PERMISSIONS, accountLoginChannel, emptyIdentityCatalog } from "./model"
import type { AccountKind, IdentityCatalog, ProjectPermissionRole } from "./model"
import { evaluateProjectPermission, globalPermissions } from "./policy"
import { validateIdentityCatalog } from "./validation"
const now = "2026-11-01T00:00:00.000Z"
function fixture(kind: AccountKind = "user", permissionRole: ProjectPermissionRole = "editor"): IdentityCatalog {
  return { ...emptyIdentityCatalog(),
    accounts: [{ id: "a", handle: "alice", displayName: "Alice", kind, status: "active", createdAt: now, updatedAt: now }],
    memberships: [{ id: "m", accountId: "a", projectId: "p", status: "active", permissionRole, workRoleIds: ["r"], createdAt: now, updatedAt: now }],
    workRoles: [{ id: "r", projectId: "p", name: "Researcher", description: "", status: "active", permissionRole: "viewer", permissions: ["wiki.read", "memory.read"], createdAt: now, updatedAt: now }],
  }
}
describe("identity permission boundaries", () => {
  for (const kind of ACCOUNT_KINDS) for (const role of ["viewer", "editor", "manager"] as const) {
    it(`${kind}/${role} follows the project matrix independently of account kind`, () => {
      const catalog = fixture(kind, role)
      const actual = PROJECT_PERMISSIONS.filter(permission => evaluateProjectPermission(catalog, { accountId: "a", projectId: "p", permission }).allowed)
      const read = ["project.read", "wiki.read", "documents.read", "memory.read"]
      const edit = ["wiki.write", "documents.write", "memory.write", "domains.manage", "agent.run", "tasks.manage"]
      const manage = ["project.settings.manage", "members.manage", "roles.manage"]
      expect(actual.sort()).toEqual([...read, ...(role !== "viewer" ? edit : []), ...(role === "manager" ? manage : [])].sort())
    })
  }
  it("separates interactive account administration from Agent token identities", () => {
    expect(ACCOUNT_KINDS.map(accountLoginChannel)).toEqual(["interactive", "api_token", "interactive"])
    expect(globalPermissions(fixture("agent").accounts[0])).toEqual([])
    expect(globalPermissions(fixture("user").accounts[0])).toEqual(["projects.create"])
    expect(globalPermissions(fixture("admin").accounts[0])).toEqual(["projects.create", "accounts.manage"])
    expect(globalPermissions({ ...fixture("admin").accounts[0], status: "disabled" })).toEqual([])
  })
  it("fails closed for disabled accounts, revoked membership and cross-project access even for admin", () => {
    const catalog = fixture("admin"), input = { accountId: "a", projectId: "p", permission: "wiki.read" as const }
    expect(evaluateProjectPermission(catalog, { ...input, projectId: "other" }).reason).toBe("membership_required")
    catalog.memberships[0].status = "revoked"
    expect(evaluateProjectPermission(catalog, input).reason).toBe("membership_required")
    catalog.accounts[0].status = "disabled"
    expect(evaluateProjectPermission(catalog, input).reason).toBe("account_unavailable")
  })
  it("switches only to granted roles, intersects permissions and cannot elevate account kind", () => {
    const catalog = fixture("agent"), input = { accountId: "a", projectId: "p", workRoleId: "r", permission: "wiki.read" as const }
    expect(evaluateProjectPermission(catalog, input)).toMatchObject({ allowed: true, permissionRole: "viewer", workRoleId: "r" })
    expect(evaluateProjectPermission(catalog, { ...input, permission: "wiki.write" }).reason).toBe("permission_denied")
    expect(evaluateProjectPermission(catalog, { ...input, permission: "documents.read" }).reason).toBe("permission_denied")
    expect(globalPermissions(catalog.accounts[0])).toEqual([])
    for (const change of [() => { catalog.memberships[0].workRoleIds = [] }, () => { catalog.workRoles[0].projectId = "other" }, () => { catalog.workRoles[0].status = "retired" }, () => { catalog.workRoles[0].permissionRole = "manager" }]) {
      const separate = fixture(); change()
      expect(evaluateProjectPermission(catalog, input).reason).toBe("role_not_granted")
      // Reset each source of denial so every guard is exercised independently.
      catalog.memberships = separate.memberships; catalog.workRoles = separate.workRoles
    }
  })
  it("requires a matching explicit private-memory grant, including for project managers/admins", () => {
    const catalog = fixture("admin", "manager"), input = { accountId: "a", projectId: "p", permission: "memory.read" as const }
    const grant = { accountId: "a", projectId: "p", memoryId: "private", actions: ["read" as const], expiresAt: "2026-11-02T00:00:00.000Z" }
    const decide = (override = {}) => evaluateProjectPermission(catalog, { ...input, privateMemory: { id: "private", now, grant: { ...grant, ...override } } })
    expect(evaluateProjectPermission(catalog, { ...input, privateMemory: { id: "private", now } }).allowed).toBe(false)
    expect(decide().allowed).toBe(true)
    for (const override of [{ accountId: "other" }, { projectId: "other" }, { memoryId: "other" }, { actions: [] }, { expiresAt: now }, { expiresAt: "invalid" }]) expect(decide(override).reason).toBe("private_grant_required")
    expect(evaluateProjectPermission(catalog, { ...input, permission: "memory.write", privateMemory: { id: "private", now, grant } }).allowed).toBe(false)
    expect(decide({ expiresAt: null }).allowed).toBe(true)
  })
  it("validates identity references and rejects global permission injection or role escalation", () => {
    const catalog = fixture(); expect(validateIdentityCatalog(catalog)).toBe(catalog)
    for (const mutate of [
      (value: IdentityCatalog) => { value.workRoles[0].permissions.push("accounts.manage" as never) },
      (value: IdentityCatalog) => { value.workRoles[0].permissionRole = "manager" },
      (value: IdentityCatalog) => { value.memberships[0].accountId = "missing" },
      (value: IdentityCatalog) => { value.workRoles[0].projectId = "other" },
      (value: IdentityCatalog) => { value.memberships[0].permissionRole = "__proto__" as never },
      (value: IdentityCatalog) => { value.accounts.push({ ...value.accounts[0], id: "duplicate" }) },
    ]) { const bad = structuredClone(catalog); mutate(bad); expect(() => validateIdentityCatalog(bad)).toThrow() }
  })
})
