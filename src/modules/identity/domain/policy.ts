import type { Account, GlobalPermission, IdentityCatalog, ProjectMembership, ProjectPermission, ProjectPermissionRole } from "./model"
const READ: readonly ProjectPermission[] = ["project.read", "wiki.read", "documents.read", "memory.read"]
export const PERMISSION_MATRIX: Readonly<Record<ProjectPermissionRole, readonly ProjectPermission[]>> = Object.freeze({
  viewer: Object.freeze([...READ]),
  editor: Object.freeze([...READ, "wiki.write", "documents.write", "memory.write", "domains.manage", "agent.run", "tasks.manage"] as ProjectPermission[]),
  manager: Object.freeze([...READ, "wiki.write", "documents.write", "memory.write", "domains.manage", "agent.run", "tasks.manage", "project.settings.manage", "members.manage", "roles.manage"] as ProjectPermission[]),
})
export const roleRank = (role: ProjectPermissionRole) => ({ viewer: 0, editor: 1, manager: 2 })[role]
export function globalPermissions(account: Account): readonly GlobalPermission[] {
  if (account.status !== "active") return []
  return account.kind === "admin" ? ["projects.create", "accounts.manage"] : account.kind === "user" ? ["projects.create"] : []
}
export interface PermissionDecision { allowed: boolean; reason: "allowed" | "account_unavailable" | "membership_required" | "role_not_granted" | "permission_denied" | "private_grant_required"; permissionRole?: ProjectPermissionRole; workRoleId?: string }
export interface PrivateMemoryGrant { accountId: string; projectId: string; memoryId: string; actions: ("read" | "write")[]; expiresAt: string | null }
/** Pure policy model. Authentication and trusted AccessContext assembly belong to C05–C09. */
export function evaluateProjectPermission(catalog: IdentityCatalog, input: {
  accountId: string; projectId: string; permission: ProjectPermission; workRoleId?: string
  privateMemory?: { id: string; grant?: PrivateMemoryGrant; now: string }
}): PermissionDecision {
  const account = catalog.accounts.find(account => account.id === input.accountId)
  if (!account || account.status !== "active") return { allowed: false, reason: "account_unavailable" }
  const member: ProjectMembership | undefined = catalog.memberships.find(member => member.accountId === input.accountId && member.projectId === input.projectId && member.status === "active")
  if (!member) return { allowed: false, reason: "membership_required" }
  let permissionRole = member.permissionRole, allowed = PERMISSION_MATRIX[member.permissionRole]
  if (input.workRoleId) {
    const role = catalog.workRoles.find(role => role.id === input.workRoleId && role.projectId === input.projectId && role.status === "active")
    if (!role || !member.workRoleIds.includes(role.id) || roleRank(role.permissionRole) > roleRank(member.permissionRole)) return { allowed: false, reason: "role_not_granted" }
    permissionRole = role.permissionRole
    allowed = role.permissions.filter(permission => PERMISSION_MATRIX[permissionRole].includes(permission) && PERMISSION_MATRIX[member.permissionRole].includes(permission))
  }
  const context = { permissionRole, ...(input.workRoleId ? { workRoleId: input.workRoleId } : {}) }
  if (!allowed.includes(input.permission)) return { allowed: false, reason: "permission_denied", ...context }
  if (input.privateMemory) {
    const { grant, id, now } = input.privateMemory, action = input.permission === "memory.read" ? "read" : input.permission === "memory.write" ? "write" : null
    const validTime = Number.isFinite(Date.parse(now))
    if (!action || !grant || grant.accountId !== account.id || grant.projectId !== input.projectId || grant.memoryId !== id || !grant.actions.includes(action)
      || !validTime || (grant.expiresAt !== null && (!Number.isFinite(Date.parse(grant.expiresAt)) || Date.parse(grant.expiresAt) <= Date.parse(now)))) return { allowed: false, reason: "private_grant_required", ...context }
  }
  return { allowed: true, reason: "allowed", ...context }
}
