import { IdentityError, accountHandle, identityId, identityName, validateIdentityCatalog } from "../domain"
import type { Account, AccountKind, AccountStatus, IdentityCatalog, IdentitySnapshot, ProjectMembership, ProjectPermissionRole, WorkRole, ProjectPermission } from "../domain"
export interface IdentityRepository {
  read(): Promise<IdentitySnapshot>
  update(expectedRevision: number, change: (catalog: IdentityCatalog) => IdentityCatalog): Promise<IdentitySnapshot>
}
/** Trusted administrative composition only; no HTTP routes or authentication are implied here. */
export function createIdentityCatalogService(repository: IdentityRepository, context: { id(): string; now(): string; projectExists(id: string): Promise<boolean> }) {
  const update = (revision: number, change: (catalog: IdentityCatalog) => IdentityCatalog) => {
    if (!Number.isSafeInteger(revision) || revision < 1) return Promise.reject(new IdentityError("invalid_argument", "An identity catalog revision is required"))
    return repository.update(revision, current => validateIdentityCatalog(change(validateIdentityCatalog(current))))
  }
  const checkProject = async (id: string) => { identityId(id); if (!(await context.projectExists(id))) throw new IdentityError("not_found", "Project not found") }
  return {
    read: () => repository.read(),
    createAccount(revision: number, input: { handle: string; displayName: string; kind: AccountKind }) {
      const now = context.now(), account: Account = { id: context.id(), handle: accountHandle(input.handle), displayName: identityName(input.displayName), kind: input.kind, status: "active", createdAt: now, updatedAt: now }
      return update(revision, catalog => ({ ...catalog, accounts: [...catalog.accounts, account] }))
    },
    setAccountStatus(revision: number, id: string, status: AccountStatus) {
      return update(revision, catalog => {
        const account = catalog.accounts.find(account => account.id === id)
        if (!account) throw new IdentityError("not_found", "Account not found")
        if (account.status === status) return catalog
        if (account.kind === "admin" && status === "disabled" && catalog.accounts.filter(account => account.kind === "admin" && account.status === "active").length === 1) throw new IdentityError("last_admin", "The last active administrator cannot be disabled")
        return { ...catalog, accounts: catalog.accounts.map(account => account.id === id ? { ...account, status, updatedAt: context.now() } : account) }
      })
    },
    async saveWorkRole(revision: number, input: { id?: string; projectId: string; name: string; description?: string; permissionRole: ProjectPermissionRole; permissions: ProjectPermission[]; status?: WorkRole["status"] }) {
      await checkProject(input.projectId)
      return update(revision, catalog => {
        const previous = input.id ? catalog.workRoles.find(role => role.id === input.id) : undefined
        if (input.id && !previous) throw new IdentityError("not_found", "Work role not found")
        if (previous && previous.projectId !== input.projectId) throw new IdentityError("invalid_argument", "A work role cannot move between projects")
        const now = context.now(), role: WorkRole = { id: previous?.id ?? context.id(), projectId: input.projectId, name: identityName(input.name), description: input.description ?? "", permissionRole: input.permissionRole, permissions: [...input.permissions], status: input.status ?? previous?.status ?? "active", createdAt: previous?.createdAt ?? now, updatedAt: now }
        return { ...catalog, workRoles: [...catalog.workRoles.filter(item => item.id !== role.id), role] }
      })
    },
    async saveMembership(revision: number, input: { projectId: string; accountId: string; permissionRole: ProjectPermissionRole; workRoleIds: string[]; status?: ProjectMembership["status"] }) {
      await checkProject(input.projectId)
      return update(revision, catalog => {
        const previous = catalog.memberships.find(member => member.projectId === input.projectId && member.accountId === input.accountId), now = context.now()
        const member: ProjectMembership = { id: previous?.id ?? context.id(), projectId: input.projectId, accountId: input.accountId, permissionRole: input.permissionRole, workRoleIds: [...input.workRoleIds], status: input.status ?? previous?.status ?? "active", createdAt: previous?.createdAt ?? now, updatedAt: now }
        return { ...catalog, memberships: [...catalog.memberships.filter(item => item.id !== member.id), member] }
      })
    },
  }
}
