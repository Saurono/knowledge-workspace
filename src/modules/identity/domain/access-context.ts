import { AuthError } from "./auth"
import type { Principal } from "./auth"
import type { ProjectPermission } from "./model"
export interface AccessContext {
  readonly id: string
  readonly actorId: string
  readonly effectiveAccountId: string
  readonly projectId: string
  readonly workRoleId: string | null
  readonly credential: Readonly<{ channel: Principal["channel"]; id: string }>
  readonly permissions: readonly ProjectPermission[]
  readonly basis: Readonly<{ membershipId: string; catalogRevision: number; tokenId: string | null; delegationId: string | null }>
  readonly capturedAt: string
}
export function freezeAccessContext(context: AccessContext): AccessContext {
  return Object.freeze({ ...context, credential: Object.freeze({ ...context.credential }), permissions: Object.freeze([...context.permissions]), basis: Object.freeze({ ...context.basis }) })
}
export function requireContextPermission(context: AccessContext, permission: ProjectPermission) {
  if (!context.permissions.includes(permission)) throw new AuthError("forbidden", "Operation is outside the effective authorization scope")
}
