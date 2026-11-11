import { AuthError, PROJECT_PERMISSIONS, freezeAccessContext, identityId, requireContextPermission } from "../domain"
import type { AccessContext, ContextSelection, IdentityDelegation, IdentitySnapshot, Principal, ProjectPermission } from "../domain"
import { captureAccessContext } from "./access-context"
export interface ContextRepository {
  identities(): Promise<IdentitySnapshot>
  delegations(): Promise<IdentityDelegation[]>
  saveDelegation(grant: IdentityDelegation): Promise<void>
  revokeDelegation(id: string, now: string): Promise<void>
  context(id: string): Promise<AccessContext | null>
  saveContext(context: AccessContext): Promise<void>
}
export function createContextService(repository: ContextRepository, runtime: { id(): string; now(): string }) {
  const capture = async (principal: Principal, projectId: string, selection: ContextSelection = {}) => {
    const snapshot = await repository.identities(), actor = captureAccessContext(snapshot, principal, projectId, runtime)
    const effectiveId = selection.effectiveAccountId ?? principal.accountId
    if (effectiveId === principal.accountId) {
      if (selection.delegationId) throw new AuthError("invalid_argument", "A delegation cannot target the actor itself")
      return captureAccessContext(snapshot, principal, projectId, runtime, selection.workRoleId ?? undefined)
    }
    requireContextPermission(actor, "project.read")
    const grant = (await repository.delegations()).find(grant => grant.id === selection.delegationId && grant.grantorId === effectiveId && grant.granteeId === principal.accountId && grant.projectId === projectId && !grant.revokedAt && Date.parse(grant.expiresAt) > Date.parse(runtime.now()))
    if (!grant || (selection.workRoleId !== undefined && selection.workRoleId !== grant.workRoleId)) throw new AuthError("forbidden", "An active matching identity delegation is required")
    const effective = captureAccessContext(snapshot, { ...principal, accountId: effectiveId }, projectId, runtime, grant.workRoleId ?? undefined)
    return freezeAccessContext({ ...effective, actorId: principal.accountId, actorKind: "agent", permissions: effective.permissions.filter(permission => grant.permissions.includes(permission)), basis: { ...effective.basis, delegationId: grant.id } })
  }
  return {
    capture,
    async list(principal: Principal, projectId: string) {
      captureAccessContext(await repository.identities(), principal, projectId, runtime)
      return (await repository.delegations()).filter(grant => grant.projectId === projectId && (grant.grantorId === principal.accountId || grant.granteeId === principal.accountId))
    },
    async grant(principal: Principal, input: { projectId: string; granteeId: string; workRoleId?: string | null; permissions: ProjectPermission[]; expiresAt: string }) {
      if (principal.channel !== "session") throw new AuthError("forbidden", "Identity delegation issuance requires an interactive session")
      identityId(input.granteeId)
      const snapshot = await repository.identities(), authority = captureAccessContext(snapshot, principal, input.projectId, runtime, input.workRoleId ?? undefined)
      const recipient = snapshot.catalog.accounts.find(account => account.id === input.granteeId && account.status === "active")
      if (!recipient || input.granteeId === principal.accountId || !snapshot.catalog.memberships.some(member => member.accountId === recipient.id && member.projectId === input.projectId && member.status === "active")) throw new AuthError("forbidden", "Delegate must be another active project member")
      requireContextPermission(authority, "project.read")
      if (!Array.isArray(input.permissions) || !input.permissions.length || new Set(input.permissions).size !== input.permissions.length || input.permissions.some(permission => !PROJECT_PERMISSIONS.includes(permission) || !authority.permissions.includes(permission))) throw new AuthError("forbidden", "Delegation exceeds grantor authority")
      const now = runtime.now(), end = Date.parse(input.expiresAt)
      if (!Number.isFinite(end) || end <= Date.parse(now) || end > Date.parse(now) + 7 * 24 * 60 * 60_000) throw new AuthError("invalid_argument", "Delegation expiry must be within the next seven days")
      const grant: IdentityDelegation = { id: runtime.id(), grantorId: principal.accountId, granteeId: input.granteeId, projectId: input.projectId, workRoleId: authority.workRoleId, permissions: [...input.permissions], createdAt: now, expiresAt: new Date(end).toISOString(), revokedAt: null }
      await repository.saveDelegation(grant); return grant
    },
    async revoke(principal: Principal, projectId: string, id: string) {
      const grant = (await repository.delegations()).find(grant => grant.id === id && grant.projectId === projectId)
      if (!grant || (grant.grantorId !== principal.accountId && grant.granteeId !== principal.accountId)) throw new AuthError("not_found", "Delegation not found")
      await repository.revokeDelegation(id, runtime.now())
    },
    async switch(principal: Principal, projectId: string, selection: ContextSelection) {
      const context = await capture(principal, projectId, selection)
      await repository.saveContext(context); return context
    },
    async resolve(principal: Principal, projectId: string, id?: string) {
      if (!id) return capture(principal, projectId)
      const stored = await repository.context(id)
      if (!stored || stored.actorId !== principal.accountId || stored.projectId !== projectId || stored.credential.id !== principal.credentialId || stored.credential.channel !== principal.channel) throw new AuthError("forbidden", "Context is bound to another session or project")
      const current = await capture(principal, projectId, { effectiveAccountId: stored.effectiveAccountId, workRoleId: stored.workRoleId, delegationId: stored.basis.delegationId })
      // Recheck revocation, but an old execution never gains newly granted operations.
      return freezeAccessContext({ ...current, id: stored.id, capturedAt: stored.capturedAt, permissions: current.permissions.filter(permission => stored.permissions.includes(permission)) })
    },
  }
}
