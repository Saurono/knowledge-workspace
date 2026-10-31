export function parseCodexCliLine(rawLine: string): string | null {
  const line = rawLine.trim()
  if (!line) return null

  let evt: unknown
  try {
    evt = JSON.parse(line)
  } catch {
    return null
  }

  if (!evt || typeof evt !== "object") return null
  const obj = evt as Record<string, unknown>
  if (obj.type !== "item.completed") return null

  const item = obj.item as Record<string, unknown> | undefined
  if (item?.type !== "agent_message") return null
  return typeof item.text === "string" && item.text.length > 0 ? item.text : null
}
