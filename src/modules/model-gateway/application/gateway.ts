import { GatewayError, remaining } from "../domain"
import type { BudgetPolicy, UsageRecord } from "../domain"

export interface UsageJournal {
  append(record: UsageRecord): Promise<void>
  all(): Promise<UsageRecord[]>
}
export interface CallMeta {
  projectId: string
  operation: string
  provider: string
  model: string
}
export interface TokenUsage {
  promptTokens?: number | null
  completionTokens?: number | null
  cachedTokens?: number | null
}
export interface MeterOptions<T> {
  /** Required explicitly: used on budget rejection or primary call failure. */
  fallback?: { meta: CallMeta; call(): Promise<T> }
  usage?(result: T): TokenUsage
}
export interface GatewayOptions {
  /** Unix milliseconds, also used to measure elapsed time. */
  now(): number
  newId(): string
  journal: UsageJournal
  budget?: BudgetPolicy
  logger?: { error(message: string, error: unknown): void }
}
export interface EmbeddingPort<Config> {
  embed(text: string, config: Config, maxRetries: number): Promise<number[]>
  embedBatch(texts: string[], config: Config): Promise<number[][]>
}

function normalizeError(error: unknown): GatewayError {
  if (error instanceof GatewayError) return error
  const seen = new Set<unknown>()
  let current = error
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current)
    const detail = current as { code?: string; name?: string; message?: string; cause?: unknown }
    if (["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENETUNREACH", "ENOTFOUND", "UND_ERR_CONNECT_TIMEOUT"].includes(detail.code ?? "")
      || detail.name === "TimeoutError" || detail.name === "AbortError"
      || /timed?\s*out|timeout/i.test(detail.message ?? "")
      || (current instanceof TypeError && /fetch|network|load failed/i.test(detail.message ?? ""))) {
      return new GatewayError("network_unavailable", "Model network request failed", error)
    }
    current = detail.cause
  }
  return new GatewayError("invalid_response", "Model call failed", error)
}

export function createModelGateway({ now, newId, journal, budget, logger }: GatewayOptions) {
  async function append(record: UsageRecord) {
    try { await journal.append(record) }
    catch (error) {
      // Logging must never conceal the persistence failure.
      try { logger?.error("Usage journal append failed", error) } catch { /* original failure wins */ }
      throw error
    }
  }
  async function meter<T>(meta: CallMeta, call: () => Promise<T>, options: MeterOptions<T> = {}): Promise<T> {
    const started = now()
    let recordMeta = meta
    let degraded = false
    let result!: T
    let failure: GatewayError | undefined
    let usage: TokenUsage = {}
    try {
      try {
        if (budget && remaining(budget) === 0) throw new GatewayError("quota_exceeded")
        result = await call()
      } catch (error) {
        if (!options.fallback) throw error
        degraded = true
        recordMeta = options.fallback.meta
        result = await options.fallback.call()
      }
      usage = options.usage?.(result) ?? {}
    } catch (error) {
      failure = normalizeError(error)
    }
    await append({
      ...recordMeta, id: newId(), at: new Date(started).toISOString(),
      promptTokens: usage.promptTokens ?? null,
      completionTokens: usage.completionTokens ?? null,
      cachedTokens: usage.cachedTokens ?? null,
      latencyMs: Math.max(0, now() - started), outcome: failure ? "failed" : "ok",
      ...(degraded ? { degraded: true } : {}),
      ...(failure ? { errorCode: failure.code } : {}),
    })
    if (failure) throw failure
    return result
  }

  function wrapEmbedding<Config extends { model: string }>(
    eport: EmbeddingPort<Config>,
    context: { projectId: string; provider: string } = { projectId: "unknown", provider: "unknown" },
  ): EmbeddingPort<Config> {
    return {
      embed: (text, config, maxRetries) => meter(
        { ...context, operation: "embed", model: config.model },
        () => eport.embed(text, config, maxRetries),
      ),
      embedBatch: (texts, config) => meter(
        { ...context, operation: "embedBatch", model: config.model },
        () => eport.embedBatch(texts, config),
      ),
    }
  }
  return { meter, wrapEmbedding }
}
