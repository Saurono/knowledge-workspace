import type { Account, IdentitySnapshot } from "./model"
export class AuthError extends Error {
  constructor(public readonly code: "invalid_argument" | "unauthenticated" | "forbidden" | "conflict" | "not_found" | "too_many_requests", message: string) { super(message); this.name = "AuthError" }
}
export interface LoginSession { id: string; accountId: string; digest: string; createdAt: string; expiresAt: string; lastSeenAt: string; revokedAt: string | null }
export interface Principal { accountId: string; credentialId: string; channel: "session" | "token" }
export interface SessionIdentity { account: Account; principal: Principal; expiresAt: string }
export interface AccountInput { handle: string; displayName: string; kind: Account["kind"]; password?: string }
export interface RegistrationResult { snapshot: IdentitySnapshot; account: Account }
export function requirePassword(value: unknown): string {
  if (typeof value !== "string" || value.length < 12 || value.length > 256) throw new AuthError("invalid_argument", "Password must contain 12–256 characters")
  return value
}
