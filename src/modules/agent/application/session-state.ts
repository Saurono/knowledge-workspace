import type { Conversation, DisplayMessage, MessageImage, MessageReference, ChatAgentStep, ChatAgentFileChange, ChatUserInputRequest, ChatAgentMode, ChatRetrievalMode } from "../domain"
export interface ChatState {
  conversations: Conversation[]
  activeConversationId: string | null
  messages: DisplayMessage[]
  isStreaming: boolean
  streamingContent: string
  mode: "chat" | "ingest"
  ingestSource: string | null
  maxHistoryMessages: number
  useWebSearch: boolean
  useAnyTxtSearch: boolean
  agentMode: ChatAgentMode
  retrievalMode: ChatRetrievalMode
  selectedSkills: string[]
  selectedContextFiles: string[]
  disabledSkills: string[]

  // Conversation management
  createConversation: () => string
  deleteConversation: (id: string) => void
  setActiveConversation: (id: string | null) => void
  renameConversation: (id: string, title: string) => void

  // Message management
  addMessage: (role: DisplayMessage["role"], content: string, images?: MessageImage[]) => void
  addMessageToConversation: (conversationId: string, role: DisplayMessage["role"], content: string, images?: MessageImage[], contextFiles?: string[]) => void
  setMessages: (messages: DisplayMessage[]) => void
  setConversations: (conversations: Conversation[]) => void
  setStreaming: (streaming: boolean) => void
  appendStreamToken: (token: string) => void
  finalizeStream: (content: string, references?: MessageReference[], agentSteps?: ChatAgentStep[], userInputRequest?: ChatUserInputRequest, agentFileChanges?: ChatAgentFileChange[]) => void
  finalizeStreamForConversation: (conversationId: string, content: string, references?: MessageReference[], agentSteps?: ChatAgentStep[], userInputRequest?: ChatUserInputRequest, agentFileChanges?: ChatAgentFileChange[]) => void
  setMode: (mode: ChatState["mode"]) => void
  setIngestSource: (path: string | null) => void
  clearMessages: () => void
  setMaxHistoryMessages: (n: number) => void
  setUseWebSearch: (enabled: boolean) => void
  setUseAnyTxtSearch: (enabled: boolean) => void
  setAgentMode: (mode: ChatAgentMode) => void
  setRetrievalMode: (mode: ChatRetrievalMode) => void
  setSelectedSkills: (skills: string[]) => void
  setSelectedContextFiles: (paths: string[]) => void
  setDisabledSkills: (skills: string[]) => void
  removeLastAssistantMessage: () => void  // for regenerate: remove last assistant reply

  // Helpers
  getActiveMessages: () => DisplayMessage[]
}

export interface ChatStatePorts {
  set(change: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>)): void
  get(): ChatState
  now(): number
  messageId(): string
  conversationId(): string
  label(key: string): string
}
export function createChatSessionState(ports: ChatStatePorts): ChatState {
  const { set, get } = ports
  return {
  conversations: [],
  activeConversationId: null,
  messages: [],
  isStreaming: false,
  streamingContent: "",
  mode: "chat",
  ingestSource: null,
  maxHistoryMessages: 10,
  useWebSearch: false,
  useAnyTxtSearch: false,
  agentMode: "standard",
  retrievalMode: "standard",
  selectedSkills: [],
  selectedContextFiles: [],
  disabledSkills: [],

  createConversation: () => {
    const id = ports.conversationId()
    const now = ports.now()
    const newConversation: Conversation = {
      id,
      title: ports.label("chat.newConversation"),
      createdAt: now,
      updatedAt: now,
      selectedSkills: [],
      contextFiles: [],
    }
    set((state) => ({
      conversations: [newConversation, ...state.conversations],
      activeConversationId: id,
      isStreaming: false,
      streamingContent: "",
      selectedSkills: [],
      selectedContextFiles: [],
    }))
    return id
  },

  deleteConversation: (id) =>
    set((state) => {
      const remaining = state.conversations.filter((c) => c.id !== id)
      const newActiveId =
        state.activeConversationId === id
          ? (remaining[0]?.id ?? null)
          : state.activeConversationId
      return {
        conversations: remaining,
        messages: state.messages.filter((m) => m.conversationId !== id),
        activeConversationId: newActiveId,
        selectedSkills: remaining.find((conversation) => conversation.id === newActiveId)?.selectedSkills ?? [],
        selectedContextFiles: remaining.find((conversation) => conversation.id === newActiveId)?.contextFiles ?? [],
      }
    }),

  setActiveConversation: (id) =>
    set((state) => ({
      activeConversationId: id,
      streamingContent: "",
      selectedSkills: state.conversations.find((conversation) => conversation.id === id)?.selectedSkills ?? [],
      selectedContextFiles: state.conversations.find((conversation) => conversation.id === id)?.contextFiles ?? [],
    })),

  renameConversation: (id, title) =>
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === id ? { ...c, title, updatedAt: ports.now() } : c
      ),
    })),

  addMessage: (role, content, images) => {
    const activeConversationId = get().activeConversationId
    if (!activeConversationId) return
    get().addMessageToConversation(activeConversationId, role, content, images)
  },

  addMessageToConversation: (conversationId, role, content, images, contextFiles) =>
    set((state) => {
      const { conversations } = state
      if (!conversations.some((conversation) => conversation.id === conversationId)) return state

      const newMessage: DisplayMessage = {
        id: ports.messageId(),
        role,
        content,
        timestamp: ports.now(),
        conversationId,
        ...(images && images.length > 0 ? { images } : {}),
        ...(contextFiles && contextFiles.length > 0 ? { contextFiles } : {}),
      }

      // Auto-set title from first user message (first 50 chars)
      const convMessages = state.messages.filter(
        (m) => m.conversationId === conversationId && m.role === "user"
      )
      const updatedConversations =
        role === "user" && convMessages.length === 0
          ? conversations.map((c) =>
              c.id === conversationId
                ? {
                    ...c,
                    // Image-only first message has empty text; fall
                    // back to a generic title so the sidebar entry
                    // isn't blank.
                    title: content.slice(0, 50) || (images && images.length > 0 ? ports.label("chat.imageMessage") : c.title),
                    updatedAt: ports.now(),
                  }
                : c
            )
          : conversations.map((c) =>
              c.id === conversationId
                ? { ...c, updatedAt: ports.now() }
                : c
            )

      return {
        messages: [...state.messages, newMessage],
        conversations: updatedConversations,
      }
    }),

  setMessages: (messages) => set({ messages }),

  setConversations: (conversations) =>
    set((state) => ({
      conversations,
      selectedSkills: conversations.find((conversation) => conversation.id === state.activeConversationId)?.selectedSkills ?? [],
      selectedContextFiles: conversations.find((conversation) => conversation.id === state.activeConversationId)?.contextFiles ?? [],
    })),

  setStreaming: (isStreaming) => set((state) => ({
    isStreaming,
    // Each new run owns its own stream buffer. Without this reset, a newly
    // created conversation can briefly render tokens left by another
    // conversation until the next token arrives.
    ...(isStreaming ? { streamingContent: "" } : state.streamingContent ? {} : {}),
  })),

  appendStreamToken: (token) =>
    set((state) => ({
      streamingContent: state.streamingContent + token,
    })),

  finalizeStream: (content, references, agentSteps, userInputRequest, agentFileChanges) => {
    const activeConversationId = get().activeConversationId
    if (!activeConversationId) {
      set({
        isStreaming: false,
        streamingContent: "",
      })
      return
    }
    get().finalizeStreamForConversation(
      activeConversationId,
      content,
      references,
      agentSteps,
      userInputRequest,
      agentFileChanges,
    )
  },

  finalizeStreamForConversation: (conversationId, content, references, agentSteps, userInputRequest, agentFileChanges) =>
    set((state) => {
      const { conversations } = state
      if (!conversations.some((conversation) => conversation.id === conversationId)) {
        return {
          isStreaming: false,
          streamingContent: "",
        }
      }

      const newMessage: DisplayMessage = {
        id: ports.messageId(),
        role: "assistant" as const,
        content,
        timestamp: ports.now(),
        conversationId,
        references,
        agentSteps,
        ...(agentFileChanges && agentFileChanges.length > 0 ? { agentFileChanges } : {}),
        ...(userInputRequest ? { userInputRequest } : {}),
      }

      return {
        isStreaming: false,
        streamingContent: "",
        messages: [...state.messages, newMessage],
        conversations: conversations.map((c) =>
          c.id === conversationId
            ? { ...c, updatedAt: ports.now() }
            : c
        ),
      }
    }),

  setMode: (mode) => set({ mode }),

  setIngestSource: (ingestSource) => set({ ingestSource }),

  clearMessages: () =>
    set((state) => ({
      messages: state.messages.filter(
        (m) => m.conversationId !== state.activeConversationId
      ),
    })),

  setMaxHistoryMessages: (maxHistoryMessages) => set({ maxHistoryMessages }),

  setUseWebSearch: (useWebSearch) => set({ useWebSearch }),

  setUseAnyTxtSearch: (useAnyTxtSearch) => set({ useAnyTxtSearch }),

  setAgentMode: (agentMode) => set({ agentMode }),

  setRetrievalMode: (retrievalMode) => set({ retrievalMode }),

  setSelectedSkills: (selectedSkills) =>
    set((state) => ({
      selectedSkills,
      conversations: state.activeConversationId
        ? state.conversations.map((conversation) =>
            conversation.id === state.activeConversationId
              ? { ...conversation, selectedSkills }
              : conversation
          )
        : state.conversations,
    })),

  setSelectedContextFiles: (selectedContextFiles) =>
    set((state) => ({
      selectedContextFiles,
      conversations: state.activeConversationId
        ? state.conversations.map((conversation) =>
            conversation.id === state.activeConversationId
              ? { ...conversation, contextFiles: selectedContextFiles }
              : conversation
          )
        : state.conversations,
    })),

  setDisabledSkills: (disabledSkills) => set({ disabledSkills }),

  removeLastAssistantMessage: () =>
    set((state) => {
      const activeId = state.activeConversationId
      if (!activeId) return state
      const activeMessages = state.messages.filter((m) => m.conversationId === activeId)
      // Find last assistant message
      const lastAssistantIdx = [...activeMessages].reverse().findIndex((m) => m.role === "assistant")
      if (lastAssistantIdx === -1) return state
      const msgToRemove = activeMessages[activeMessages.length - 1 - lastAssistantIdx]
      return {
        messages: state.messages.filter((m) => m.conversationId !== activeId || m.id !== msgToRemove.id),
      }
    }),

  getActiveMessages: () => {
    const { messages, activeConversationId } = get()
    if (!activeConversationId) return []
    return messages.filter((m) => m.conversationId === activeConversationId)
  },
}
}
