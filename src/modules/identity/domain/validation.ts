import { ACCOUNT_KINDS, PROJECT_PERMISSIONS, IdentityError, identityId, accountHandle, identityName } from "./model"
import type { IdentityCatalog } from "./model"
import { PERMISSION_MATRIX, roleRank } from "./policy"
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value)
const unique = (values: string[]) => new Set(values).size === values.length
const time = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value))
export function validateIdentityCatalog(value: unknown): IdentityCatalog {
  const fail = (message: string): never => { throw new IdentityError("invalid_argument", message) }
  if (!object(value) || value.schemaVersion !== 1 || !Array.isArray(value.accounts) || !Array.isArray(value.memberships) || !Array.isArray(value.workRoles)) return fail("Unsupported identity catalog")
  const catalog = value as unknown as IdentityCatalog
  for (const account of catalog.accounts) {
    if (!object(account)) return fail("Invalid account")
    identityId(account.id)
    if (accountHandle(account.handle) !== account.handle || identityName(account.displayName) !== account.displayName || !ACCOUNT_KINDS.includes(account.kind) || !["active", "disabled"].includes(account.status) || !time(account.createdAt) || !time(account.updatedAt)) return fail("Invalid account fields")
  }
  if (!unique(catalog.accounts.map(account => account.id)) || !unique(catalog.accounts.map(account => account.handle))) return fail("Account identity and handle must be unique")
  for (const role of catalog.workRoles) {
    if (!object(role)) return fail("Invalid work role")
    identityId(role.id); identityId(role.projectId)
    if (identityName(role.name) !== role.name) return fail("Work role name must be normalized")
    if (!Object.prototype.hasOwnProperty.call(PERMISSION_MATRIX, role.permissionRole) || !["active", "retired"].includes(role.status) || typeof role.description !== "string" || role.description.length > 2000 || !Array.isArray(role.permissions) || !unique(role.permissions) || role.permissions.some(permission => !PROJECT_PERMISSIONS.includes(permission) || !PERMISSION_MATRIX[role.permissionRole].includes(permission)) || !time(role.createdAt) || !time(role.updatedAt)) return fail("Invalid work role permissions")
  }
  if (!unique(catalog.workRoles.map(role => role.id)) || !unique(catalog.workRoles.map(role => `${role.projectId}\0${role.name.normalize("NFKC").toLowerCase().trim()}`))) return fail("Work roles must be unique within their project")
  for (const member of catalog.memberships) {
    if (!object(member)) return fail("Invalid membership")
    identityId(member.id); identityId(member.projectId); identityId(member.accountId)
    if (!catalog.accounts.some(account => account.id === member.accountId) || !Object.prototype.hasOwnProperty.call(PERMISSION_MATRIX, member.permissionRole) || !["active", "revoked"].includes(member.status) || !Array.isArray(member.workRoleIds) || !unique(member.workRoleIds) || !time(member.createdAt) || !time(member.updatedAt)) return fail("Invalid project membership")
    for (const id of member.workRoleIds) {
      const role = catalog.workRoles.find(role => role.id === id && role.projectId === member.projectId)
      if (!role || roleRank(role.permissionRole) > roleRank(member.permissionRole)) return fail("A work role exceeds its membership grant")
    }
  }
  if (!unique(catalog.memberships.map(member => member.id)) || !unique(catalog.memberships.map(member => `${member.projectId}\0${member.accountId}`))) return fail("Only one membership may exist for an account in a project")
  return catalog
}
