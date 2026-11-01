export const ACCOUNT_KINDS = ["user", "agent", "admin"] as const
export type AccountKind = typeof ACCOUNT_KINDS[number]
export type AccountStatus = "active" | "disabled"
export type ProjectPermissionRole = "viewer" | "editor" | "manager"
export const PROJECT_PERMISSIONS = ["project.read", "wiki.read", "wiki.write", "documents.read", "documents.write", "memory.read", "memory.write", "domains.manage", "agent.run", "tasks.manage", "project.settings.manage", "members.manage", "roles.manage"] as const
export type ProjectPermission = typeof PROJECT_PERMISSIONS[number]
export type GlobalPermission = "projects.create" | "accounts.manage"
export interface Account {
  id: string; handle: string; displayName: string; kind: AccountKind; status: AccountStatus
  createdAt: string; updatedAt: string
}
export interface WorkRole {
  id: string; projectId: string; name: string; description: string; status: "active" | "retired"
  permissionRole: ProjectPermissionRole; permissions: ProjectPermission[]
  createdAt: string; updatedAt: string
}
export interface ProjectMembership {
  id: string; projectId: string; accountId: string; status: "active" | "revoked"
  permissionRole: ProjectPermissionRole; workRoleIds: string[]
  createdAt: string; updatedAt: string
}
export interface IdentityCatalog { schemaVersion: 1; accounts: Account[]; memberships: ProjectMembership[]; workRoles: WorkRole[] }
export interface IdentitySnapshot { revision: number; catalog: IdentityCatalog }
export class IdentityError extends Error {
  constructor(public readonly code: "invalid_argument" | "not_found" | "conflict" | "last_admin", message: string, public readonly actualRevision?: number) { super(message); this.name = "IdentityError" }
}
export const emptyIdentityCatalog = (): IdentityCatalog => ({ schemaVersion: 1, accounts: [], memberships: [], workRoles: [] })
export const accountLoginChannel = (kind: AccountKind) => kind === "agent" ? "api_token" as const : "interactive" as const
export function identityId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)) throw new IdentityError("invalid_argument", "Invalid identity or project identifier")
  return value
}
export function accountHandle(value: unknown): string {
  if (typeof value !== "string") throw new IdentityError("invalid_argument", "Account handle is required")
  const handle = value.normalize("NFKC").trim().toLowerCase()
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(handle)) throw new IdentityError("invalid_argument", "Account handle must be 3–64 lowercase letters, numbers, dots, underscores or hyphens")
  return handle
}
export function identityName(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 120) throw new IdentityError("invalid_argument", "A display name of 1–120 characters is required")
  return value.trim()
}
