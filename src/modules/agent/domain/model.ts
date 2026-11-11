export type ChatAgentEventStage =
  | "understanding"
  | "routing"
  | "tool_call"
  | "tool_result"
  | "searching_wiki"
  | "searching_graph"
  | "searching_web"
  | "searching_anytxt"
  | "reading_context"
  | "writing"

export interface ChatAgentEvent {
  stage: ChatAgentEventStage
  query?: string
  tool?: ChatAgentToolName
  message?: string
  count?: number
  status?: "running" | "success" | "error" | "skipped"
  timestamp?: number
}

export type ChatAgentMode = "fast" | "standard" | "deep" | "local_first"
export type ChatRetrievalMode = "standard" | "smart" | "faithful"

/**
 * A turn-scoped local retrieval boundary composed by the trusted workspace
 * adapter. This is not shared-service authorization: the native command
 * validates every path against its resolved project root and run identity.
 * An empty pair of allowlists is an explicit empty scope.
 */
export interface AgentRetrievalScope {
  projectRoot: string
  runId: string
  allowedWikiPaths: string[]
  allowedRawSourcePaths: string[]
}

export type ChatAgentToolName =
  | "project_files"
  | "project_file_read"
  | "wiki_search"
  | "graph_search"
  | "web_search"
  | "anytxt_search"
  | "shell_exec"
  | "unknown_tool"

export interface ChatUserInputOption {
  label: string
  value: string
  description?: string
  recommended?: boolean
}

export type ChatUserInputFieldType = "single" | "multi" | "text" | "textarea" | "confirm"

export interface ChatUserInputField {
  id: string
  type: ChatUserInputFieldType
  label: string
  description?: string
  placeholder?: string
  options?: ChatUserInputOption[]
  defaultValue?: unknown
}

export interface ChatUserInputRequest {
  requestId: string
  title: string
  description?: string
  fields: ChatUserInputField[]
}

export interface ChatAgentStep {
  id: string
  type: "understanding" | "routing" | "tool_call" | "tool_result" | "final"
  tool?: ChatAgentToolName
  query?: string
  message?: string
  count?: number
  status?: "running" | "success" | "error" | "skipped"
  timestamp?: number
}

export interface ChatAgentFileChange {
  id: string
  path: string
  tool: string
  operation: "created" | "modified"
  additions: number
  deletions: number
  diff: string
  timestamp: number
  /** Runtime-only rollback snapshot. It is deliberately removed by persist.ts. */
  beforeContent?: string | null
  /** Runtime-only post-write snapshot used to reject stale or unsafe undo. */
  afterContent?: string
}

export interface BackendAgentReference {
  title: string
  path: string
  kind: string
  snippet?: string
  score?: number
  knowledgeContext?: {
    relatedTo?: string[]
    outgoingLinks?: string[]
    backlinks?: string[]
  }
}

export interface BackendAgentToolEvent {
  tool: string
  status: string
  detail?: string
  timestamp?: number
}

export interface BackendAgentEventPayload {
  sessionId: string
  runId?: string
  event: {
    type: string
    text?: string
    tool?: string
    input?: string
    output?: string
    message?: string
    reference?: BackendAgentReference
    request?: ChatUserInputRequest
    sessionId?: string
    path?: string
    existedBefore?: boolean
    previousContent?: string
  }
}

export interface BackendAgentResponse {
  sessionId: string
  mode?: string
  message: string | { role?: string; content?: string }
  references?: BackendAgentReference[]
  toolEvents?: BackendAgentToolEvent[]
  userInputRequest?: ChatUserInputRequest
}

export interface AvailableAgentSkill {
  id: string
  name: string
  description?: string
  source: string
}


export interface MessageImage {
  mediaType: string
  dataBase64: string
}

export interface Conversation {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  selectedSkills?: string[]
  contextFiles?: string[]
}

export interface MessageReference {
  title: string
  path: string
  kind?: "wiki" | "external" | "workspace"
  source?: string
  url?: string
  snippet?: string
  graphRelations?: string[]
}

export interface DisplayMessage {
  id: string
  role: "user" | "assistant" | "system"
  content: string
  timestamp: number
  conversationId: string
  references?: MessageReference[]  // pages cited in this response, saved at creation time
  agentSteps?: ChatAgentStep[]  // agent tool calls and routing decisions saved with assistant replies
  agentFileChanges?: ChatAgentFileChange[]  // concrete project files changed by this Agent turn
  userInputRequest?: ChatUserInputRequest  // dynamic schema-driven form requested by backend Agent
  images?: MessageImage[]  // images attached to a user message (vision input)
  contextFiles?: string[]  // absolute project files explicitly attached to this user turn
}
