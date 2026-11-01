import type { Account, AccountInput, AccessContext, AuditPage, ContextSelection, IdentityDelegation, IdentitySnapshot, Principal, ProjectMembership, ProjectPermission, PublicAgentToken, SessionIdentity, TokenScope, WorkRole } from "../domain"
export interface IdentityTransport { request<T>(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<T> }
export interface ContextOption { id: string; label: string; selection: ContextSelection; context: AccessContext }
export interface ProjectIdentityDirectory { revision: number; members: ProjectMembership[]; roles: WorkRole[]; accounts: Pick<Account, "id" | "handle" | "displayName" | "kind" | "status">[] }
export function createIdentityClient(transport: IdentityTransport) {
  const root = (project: string) => `/projects/${encodeURIComponent(project)}`
  const query = (input: Record<string, string | number | undefined>) => { const params = new URLSearchParams(); for (const [key, value] of Object.entries(input)) if (value !== undefined && value !== "") params.set(key, String(value)); return params.size ? "?" + params.toString() : "" }
  return {
    status: () => transport.request<{ initialized: boolean }>("GET", "/auth/status"),
    bootstrap: (input: { handle: string; displayName: string; password: string }, key: string) => transport.request<{ account: Account }>("POST", "/auth/bootstrap", input, { "X-KW-Setup-Key": key }),
    login: (handle: string, password: string) => transport.request<{ account: Account; expiresAt: string }>("POST", "/auth/login", { handle, password }),
    logout: () => transport.request<null>("POST", "/auth/logout", {}),
    me: () => transport.request<SessionIdentity>("GET", "/auth/me"),
    changePassword: (oldPassword: string, newPassword: string) => transport.request<null>("POST", "/auth/password", { oldPassword, newPassword }),
    accounts: () => transport.request<IdentitySnapshot>("GET", "/admin/accounts"),
    createAccount: (revision: number, input: AccountInput) => transport.request<IdentitySnapshot>("POST", "/admin/accounts", { ...input, revision }),
    setAccountStatus: (revision: number, id: string, status: Account["status"]) => transport.request<IdentitySnapshot>("PUT", `/admin/accounts/${encodeURIComponent(id)}/status`, { revision, status }),
    tokens: () => transport.request<PublicAgentToken[]>("GET", "/auth/tokens"),
    createToken: (input: TokenScope & { accountId: string; label: string; expiresAt: string }) => transport.request<{ token: PublicAgentToken; secret: string }>("POST", "/auth/tokens", input),
    revokeToken: (id: string) => transport.request<null>("DELETE", `/auth/tokens/${encodeURIComponent(id)}`),
    access: (project: string) => transport.request<AccessContext>("GET", `${root(project)}/access`),
    options: (project: string) => transport.request<ContextOption[]>("GET", `${root(project)}/access/options`),
    switchContext: (project: string, selection: ContextSelection) => transport.request<AccessContext>("POST", `${root(project)}/contexts`, selection),
    directory: (project: string, part: "members" | "roles" = "members") => transport.request<ProjectIdentityDirectory>("GET", `${root(project)}/${part}`),
    saveMember: (project: string, revision: number, input: Pick<ProjectMembership, "accountId" | "permissionRole" | "workRoleIds" | "status">) => transport.request<ProjectIdentityDirectory>("PUT", `${root(project)}/members`, { ...input, revision }),
    saveRole: (project: string, revision: number, input: Pick<WorkRole, "name" | "description" | "permissionRole" | "permissions" | "status"> & { id?: string }) => transport.request<ProjectIdentityDirectory>("PUT", `${root(project)}/roles`, { ...input, revision }),
    delegations: (project: string) => transport.request<IdentityDelegation[]>("GET", `${root(project)}/delegations`),
    grantDelegation: (project: string, input: { granteeId: string; workRoleId: string | null; permissions: ProjectPermission[]; expiresAt: string }) => transport.request<IdentityDelegation>("POST", `${root(project)}/delegations`, input),
    revokeDelegation: (project: string, id: string) => transport.request<null>("DELETE", `${root(project)}/delegations/${encodeURIComponent(id)}`),
    audit: (project: string | undefined, input: { before?: number; result?: string; actor?: string } = {}, admin = false) => transport.request<AuditPage>("GET", `${project ? root(project) + "/audit" : admin ? "/admin/audit" : "/auth/audit"}${query(input)}`),
  }
}
export type IdentityClient = ReturnType<typeof createIdentityClient>
export type VerifiedPrincipal = Principal
