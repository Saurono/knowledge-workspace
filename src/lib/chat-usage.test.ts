import { it, expect, vi } from "vitest"
it("writes, isolates failures and warns once", async () => {
 vi.resetModules()
 const { setChatUsageSink, recordChatUsage } = await import("./chat-usage")
 const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
 const record = { provider: "custom", model: "m", operation: "chat" as const, promptChars: 0, completionChars: 0, promptTokens: null, completionTokens: null, latencyMs: 0, outcome: "ok" as const }
 await recordChatUsage(record); await recordChatUsage(record)
 expect(warn).toHaveBeenCalledTimes(1)
 const sink = vi.fn(); setChatUsageSink(sink); await recordChatUsage(record)
 expect(sink).toHaveBeenCalledWith(record)
 setChatUsageSink(() => { throw Error("disk") })
 await expect(recordChatUsage(record)).resolves.toBeUndefined()
 warn.mockRestore()
})
