import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { createAgentRuntime } from "@/modules/agent/application"
import type { BackendAgentEventPayload } from "@/modules/agent/domain"
import type { LlmConfig } from "@/stores/wiki-store"
export const agentRuntime = createAgentRuntime<LlmConfig>({
  listen: handler => listen<BackendAgentEventPayload>("agent-event", event => handler(event.payload)),
  start: input => invoke("agent_start_turn_stream", { ...input }),
  turn: input => invoke("agent_start_turn", { ...input }),
  cancel: identity => invoke("agent_cancel_turn", { ...identity }),
  skills: projectPath => invoke("agent_list_skills", { projectPath }),
  setTimer: (callback, milliseconds) => setTimeout(callback, milliseconds),
  clearTimer: timer => clearTimeout(timer as ReturnType<typeof setTimeout>),
})
