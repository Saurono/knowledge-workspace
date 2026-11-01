export interface MemoryAccess { visibility: "project" | "role" | "private"; ownerId: string; workRoleIds?: string[] }
export function validMemoryAccess(value: unknown): value is MemoryAccess {
  if (!value || typeof value !== "object") return false
  const access = value as MemoryAccess, id = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)
  return ["project", "role", "private"].includes(access.visibility) && id(access.ownerId) && (access.workRoleIds === undefined || (Array.isArray(access.workRoleIds) && access.workRoleIds.every(id) && new Set(access.workRoleIds).size === access.workRoleIds.length)) && (access.visibility !== "role" || !!access.workRoleIds?.length)
}
