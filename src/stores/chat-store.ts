import { create } from "zustand"
import i18n from "@/i18n"
import { createChatSessionState, type ChatState } from "@/modules/agent/application"
export type { MessageImage, Conversation, MessageReference, DisplayMessage } from "@/modules/agent/domain"
export { chatMessagesToLLM } from "@/modules/agent/domain"
let messageCounter = 0
export const useChatStore = create<ChatState>((set, get) => createChatSessionState({
  set, get, now: Date.now, label: key => i18n.t(key),
  messageId: () => `msg_${Date.now()}_${++messageCounter}_${Math.random().toString(36).slice(2, 8)}`,
  conversationId: () => `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
}))
