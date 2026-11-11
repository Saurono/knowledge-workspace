import type { ChatUsageSink } from "@/lib/chat-usage"
import { useWikiStore } from "@/stores/wiki-store"
import { createProjectUsageJournal } from "./journal"
let warned = false
export const projectChatUsageSink: ChatUsageSink = async record => {
  const root = useWikiStore.getState().project?.path ?? null
  if (!root) {
    if (!warned) { warned = true; console.warn("chat usage: no project") }
    return
  }
  await createProjectUsageJournal(root).append({ ...record, id: crypto.randomUUID(), at: new Date().toISOString(), projectId: root, cachedTokens: null })
}
