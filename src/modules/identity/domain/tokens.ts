import type { ProjectPermission } from "./model"
export interface TokenScope { projectId: string; workRoleId: string | null; permissions: ProjectPermission[] }
export interface AgentToken extends TokenScope { id: string; accountId: string; issuerId: string; label: string; prefix: string; digest: string; createdAt: string; expiresAt: string; revokedAt: string | null }
export type PublicAgentToken = Omit<AgentToken, "digest">
export const publicAgentToken = ({ digest: _digest, ...token }: AgentToken): PublicAgentToken => token
