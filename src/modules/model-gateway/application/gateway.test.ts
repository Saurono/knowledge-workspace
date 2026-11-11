import { describe, expect, it, vi } from "vitest"
import { createModelGateway } from "./gateway"
import type { EmbeddingPort, GatewayOptions, UsageJournal } from "./gateway"
import { GatewayError, remaining } from "../domain"
import type { UsageRecord } from "../domain"

const meta = { projectId: "project", operation: "chat", provider: "provider", model: "model" }
function fixture(extra: Partial<GatewayOptions> = {}) {
  const records: UsageRecord[] = []
  const journal: UsageJournal = {
    append: async record => { records.push(record) },
    all: async () => records.slice(),
  }
  let time = 1_700_000_000_000
  let id = 0
  return { journal, gateway: createModelGateway({ now: () => time++, newId: () => `usage-${++id}`, journal, ...extra }) }
}

describe("model gateway contract", () => {
  it("rejects exhausted budgets without sending and journals the rejection", async () => {
    const { gateway, journal } = fixture({ budget: { limitTokens: 10, usedTokens: 10 } })
    const send = vi.fn(async () => "response")
    await expect(gateway.meter(meta, send)).rejects.toMatchObject({ code: "quota_exceeded" })
    expect(send).not.toHaveBeenCalled()
    expect(await journal.all()).toMatchObject([{ outcome: "failed", errorCode: "quota_exceeded" }])
    expect(remaining({ limitTokens: null, usedTokens: 100 })).toBeNull()
    expect(remaining({ limitTokens: 10, usedTokens: 11 })).toBe(0)
    expect(remaining({ limitTokens: 10, usedTokens: 4 })).toBe(6)
  })

  it("uses only an explicit fallback and marks its actual provider as degraded", async () => {
    const { gateway, journal } = fixture({ budget: { limitTokens: 0, usedTokens: 0 } })
    const send = vi.fn(async () => "primary")
    const fallback = vi.fn(async () => "fallback")
    await expect(gateway.meter(meta, send, { fallback: { meta: { ...meta, provider: "backup", model: "backup-model" }, call: fallback } })).resolves.toBe("fallback")
    expect(send).not.toHaveBeenCalled()
    expect(fallback).toHaveBeenCalledTimes(1)
    expect(await journal.all()).toMatchObject([{ outcome: "ok", degraded: true, provider: "backup", model: "backup-model" }])
  })

  it("journals complete success fields with unknown usage as null", async () => {
    const { gateway, journal } = fixture()
    await expect(gateway.meter(meta, async () => "response")).resolves.toBe("response")
    const rows = await journal.all()
    expect(rows).toEqual([{ ...meta, id: "usage-1", at: "2023-11-14T22:13:20.000Z", promptTokens: null, completionTokens: null, cachedTokens: null, latencyMs: 1, outcome: "ok" }])
    expect(rows[0].latencyMs).toBeGreaterThanOrEqual(0)
  })

  it("preserves supplied token counts including a real zero", async () => {
    const { gateway, journal } = fixture()
    await gateway.meter(meta, async () => ({ promptTokens: 12, completionTokens: 3, cachedTokens: 0 }), { usage: result => result })
    expect(await journal.all()).toMatchObject([{ promptTokens: 12, completionTokens: 3, cachedTokens: 0 }])
  })

  it.each([
    new TypeError("fetch failed"),
    Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" }),
    Object.assign(new Error("fetch failed"), { cause: { code: "ECONNREFUSED" } }),
    Object.assign(new Error("request timeout"), { name: "TimeoutError" }),
  ])("throws and journals network_unavailable for %s", async error => {
    const { gateway, journal } = fixture()
    await expect(gateway.meter(meta, async () => { throw error })).rejects.toMatchObject({ code: "network_unavailable", cause: error })
    expect(await journal.all()).toMatchObject([{ outcome: "failed", errorCode: "network_unavailable", latencyMs: 1, promptTokens: null }])
  })

  it("retains explicit error codes and marks failed fallback attempts", async () => {
    const { gateway, journal } = fixture()
    await expect(gateway.meter(meta, async () => { throw new GatewayError("unauthenticated") })).rejects.toMatchObject({ code: "unauthenticated" })
    await expect(gateway.meter(meta, async () => { throw new Error("bad response") }, {
      fallback: { meta, call: async () => { throw new GatewayError("invalid_response") } },
    })).rejects.toMatchObject({ code: "invalid_response" })
    expect(await journal.all()).toMatchObject([
      { outcome: "failed", errorCode: "unauthenticated" },
      { outcome: "failed", errorCode: "invalid_response", degraded: true },
    ])
  })

  it("wraps structural embedding ports and meters each batch once", async () => {
    const { gateway, journal } = fixture()
    const eport = {
      embed: vi.fn(async (_text: string, _config: { model: string; enabled: boolean }, _maxRetries: number) => [1, 2]),
      embedBatch: vi.fn(async (_texts: string[], _config: { model: string; enabled: boolean }) => [[1, 2], [3, 4]]),
    }
    const port: EmbeddingPort<{ model: string; enabled: boolean }> = gateway.wrapEmbedding(eport, { projectId: "project", provider: "embedding-provider" })
    const config = { model: "embedding-model", enabled: true }
    await expect(port.embedBatch(["a", "b"], config)).resolves.toEqual([[1, 2], [3, 4]])
    expect(eport.embedBatch).toHaveBeenCalledExactlyOnceWith(["a", "b"], config)
    expect(await journal.all()).toMatchObject([{ operation: "embedBatch", promptTokens: null, completionTokens: null, cachedTokens: null }])
    await expect(port.embed("a", config, 2)).resolves.toEqual([1, 2])
    expect(eport.embed).toHaveBeenCalledExactlyOnceWith("a", config, 2)
    expect(await journal.all()).toHaveLength(2)
  })

  it("propagates journal failures even when the optional logger fails", async () => {
    const failure = new Error("journal unavailable")
    const { gateway } = fixture({
      journal: { append: async () => { throw failure }, all: async () => [] },
      logger: { error: () => { throw new Error("logger failed") } },
    })
    await expect(gateway.meter(meta, async () => "response")).rejects.toBe(failure)
  })
})
