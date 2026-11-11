export interface ChatUsageRecord {
  provider: string
  model: string
  operation: "chat"
  promptChars: number
  completionChars: number
  promptTokens: number | null
  completionTokens: number | null
  latencyMs: number
  outcome: "ok" | "failed"
  errorCode?: string
}
export type ChatUsageSink = (record: ChatUsageRecord) => void | Promise<void>
let sink: ChatUsageSink | undefined
let warned = false
export function setChatUsageSink(value: ChatUsageSink) { sink = value }
export async function recordChatUsage(record: ChatUsageRecord): Promise<void> {
  try {
    if (sink) await sink(record)
    else if (!warned) { warned = true; console.warn("chat usage sink 未注册") }
  } catch (error) { console.warn("chat usage journal failed", error) }
}
