import type { ProjectPermission } from "./model"
export interface IdentityDelegation { id: string; grantorId: string; granteeId: string; projectId: string; workRoleId: string | null; permissions: ProjectPermission[]; createdAt: string; expiresAt: string; revokedAt: string | null }
export interface ContextSelection { effectiveAccountId?: string; workRoleId?: string | null; delegationId?: string | null }
