export interface UsageRecord {
  id: string
  at: string
  projectId: string
  operation: string
  provider: string
  model: string
  promptChars?: number
  completionChars?: number
  promptTokens: number | null
  completionTokens: number | null
  cachedTokens: number | null
  latencyMs: number | null
  outcome: "ok" | "failed"
  errorCode?: string
  /** True only when an explicitly supplied fallback was invoked. */
  degraded?: boolean
}

export type GatewayErrorCode = "quota_exceeded" | "network_unavailable" | "invalid_response" | "unauthenticated"
export class GatewayError extends Error {
  readonly cause?: unknown
  constructor(readonly code: GatewayErrorCode, message: string = code, cause?: unknown) {
    super(message)
    this.name = "GatewayError"
    this.cause = cause
  }
}

/** Caller-owned snapshot for the project being metered; unknown usage is never estimated. */
export interface BudgetPolicy {
  limitTokens: number | null
  usedTokens: number
}
export function remaining(policy: BudgetPolicy): number | null {
  return policy.limitTokens === null ? null : Math.max(0, policy.limitTokens - policy.usedTokens)
}
