import type { BackendAgentReference, MessageReference, BackendAgentToolEvent, ChatAgentEvent, BackendAgentResponse, AvailableAgentSkill, ChatAgentStep } from "./model"
export function backendReferenceToMessageReference(ref: BackendAgentReference): MessageReference {
  const isWiki = ref.kind === "wiki" || ref.path.startsWith("wiki/")
  const isWeb = ref.kind === "web" || /^https?:\/\//i.test(ref.path)
  const isWorkspace = ref.kind === "workspace" || ref.path.startsWith("agent-workspace/")
  const source =
    isWorkspace ? "Workspace"
      : ref.kind === "anytxt" ? "AnyTXT"
      : ref.kind === "web" ? "Web"
        : ref.kind === "source" ? "Source"
          : ref.kind === "graph" ? "Graph"
            : undefined
  return {
    title: ref.title,
    path: ref.path,
    kind: isWiki ? "wiki" : isWorkspace ? "workspace" : "external",
    source,
    url: isWeb ? ref.path : undefined,
    snippet: ref.snippet,
    graphRelations: ref.knowledgeContext?.relatedTo,
  }
}


export function backendToolToAgentStep(event: BackendAgentToolEvent, index: number) {
  if (event.tool === "agent.plan_tools") {
    return {
      id: `backend-${index}-${event.tool}-${event.status}`,
      type: "routing" as const,
      message: event.detail ?? event.tool,
      status: event.status === "failed" ? "error" as const : "success" as const,
      timestamp: event.timestamp,
    }
  }
  if (event.tool === "llm.generate") {
    return {
      id: `backend-${index}-${event.tool}-${event.status}`,
      type: "final" as const,
      message: event.detail ?? event.tool,
      status: event.status === "failed" ? "error" as const
        : event.status === "started" ? "running" as const
          : "success" as const,
      timestamp: event.timestamp,
    }
  }
  const tool = normalizeBackendToolName(event.tool)
  return {
    id: `backend-${index}-${event.tool}-${event.status}`,
    type: event.status === "started" ? "tool_call" as const : "tool_result" as const,
    tool,
    message: event.detail ?? event.tool,
    status: event.status === "failed" ? "error" as const
      : event.status === "available" ? "skipped" as const
        : event.status === "started" ? "running" as const
          : "success" as const,
    timestamp: event.timestamp,
  }
}

export function normalizeBackendToolName(tool: string) {
  const normalized = tool.split(".").join("_")
  if (normalized === "wiki_search") return "wiki_search" as const
  if (normalized === "wiki_read_page") return "project_file_read" as const
  if (normalized === "wiki_write_page") return "project_files" as const
  if (normalized === "workspace_write_file") return "project_files" as const
  if (normalized === "workspace_append_file") return "project_files" as const
  if (normalized === "skills_load") return "project_file_read" as const
  if (normalized === "context_attach") return "project_file_read" as const
  if (normalized === "skill_read_file") return "project_file_read" as const
  if (normalized === "source_search") return "project_file_read" as const
  if (normalized === "graph_search") return "graph_search" as const
  if (normalized === "web_search") return "web_search" as const
  if (normalized === "anytxt_search") return "anytxt_search" as const
  if (normalized === "shell_exec") return "shell_exec" as const
  if (normalized === "deep_research_run") return "project_file_read" as const
  return "unknown_tool" as const
}

export function backendToolToAgentEvent(event: BackendAgentToolEvent): ChatAgentEvent {
  if (event.tool === "agent.plan_tools") {
    return {
      stage: "routing",
      message: event.detail ?? event.tool,
      status: event.status === "failed" ? "error" : "success",
      timestamp: event.timestamp,
    }
  }
  if (event.tool === "llm.generate") {
    return {
      stage: "writing",
      message: event.detail ?? event.tool,
      status: event.status === "failed" ? "error"
        : event.status === "started" ? "running"
          : "success",
      timestamp: event.timestamp,
    }
  }
  const tool = normalizeBackendToolName(event.tool)
  const stage =
    tool === "web_search" ? "searching_web"
      : tool === "anytxt_search" ? "searching_anytxt"
        : tool === "graph_search" ? "searching_graph"
          : tool === "project_file_read" ? "reading_context"
            : tool === "wiki_search" ? "searching_wiki"
              : event.status === "started" ? "tool_call"
                : "tool_result"
  return {
    stage,
    tool,
    message: event.detail ?? event.tool,
    status: event.status === "failed" ? "error"
      : event.status === "started" ? "running"
        : event.status === "available" ? "skipped"
          : "success",
    timestamp: event.timestamp,
  }
}

export function backendResponseText(response: BackendAgentResponse): string {
  if (typeof response.message === "string") return response.message
  return response.message?.content ?? ""
}

export function enabledSkillIds(skills: AvailableAgentSkill[], disabledSkills: string[]): Set<string> {
  const disabled = new Set(disabledSkills)
  return new Set(skills.filter((skill) => !disabled.has(skill.id)).map((skill) => skill.id))
}

export function summarizeAgentStepsForResume(steps: ChatAgentStep[] = []): string {
  const lines = steps
    .filter((step) => step.message?.trim())
    .slice(-12)
    .map((step) => {
      const label = step.tool ?? step.type
      const status = step.status ?? "success"
      return `- ${label} ${status}: ${step.message?.trim()}`
    })
  return lines.length > 0 ? lines.join("\n") : "- No prior tool observations were saved."
}

export function compactChatHistoryForResume(
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>,
  maxMessages: number,
): { role: "user" | "assistant"; content: string }[] {
  return messages
    .filter((message): message is { role: "user" | "assistant"; content: string } =>
      message.role === "user" || message.role === "assistant"
    )
    .slice(-maxMessages)
    .map((message) => ({
      role: message.role,
      content: message.content,
    }))
}
