import { AuthError, PROJECT_PERMISSIONS, evaluateProjectPermission, freezeAccessContext, identityId } from "../domain"
import type { AccessContext, IdentitySnapshot, Principal } from "../domain"
/** Principal is supplied exclusively by the server credential verifier. */
export function captureAccessContext(snapshot: IdentitySnapshot, principal: Principal, projectId: string, runtime: { id(): string; now(): string }, workRoleId?: string): AccessContext {
  identityId(projectId)
  const { catalog, revision } = snapshot, account = catalog.accounts.find(account => account.id === principal.accountId && account.status === "active")
  if (!account) throw new AuthError("unauthenticated", "Account unavailable")
  const member = catalog.memberships.find(member => member.projectId === projectId && member.accountId === account.id && member.status === "active")
  if (!member) throw new AuthError("forbidden", "Project membership required")
  const scope = principal.scope
  if (principal.channel === "token" && (!scope || scope.projectId !== projectId)) throw new AuthError("forbidden", "Project exceeds Token scope")
  const selected = workRoleId ?? scope?.workRoleId ?? undefined
  if (scope?.workRoleId && selected !== scope.workRoleId) throw new AuthError("forbidden", "Work role exceeds Token scope")
  if (selected && evaluateProjectPermission(catalog, { accountId: account.id, projectId, workRoleId: selected, permission: "project.read" }).reason === "role_not_granted") throw new AuthError("forbidden", "Work role is not granted")
  const permissions = PROJECT_PERMISSIONS.filter(permission => (!scope || scope.permissions.includes(permission)) && evaluateProjectPermission(catalog, { accountId: account.id, projectId, workRoleId: selected, permission }).allowed)
  return freezeAccessContext({ id: runtime.id(), actorId: account.id, effectiveAccountId: account.id, projectId, workRoleId: selected ?? null, credential: { channel: principal.channel, id: principal.credentialId }, permissions, basis: { membershipId: member.id, catalogRevision: revision, tokenId: principal.channel === "token" ? principal.credentialId : null, delegationId: null }, capturedAt: runtime.now() })
}
