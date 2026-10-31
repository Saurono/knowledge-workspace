import { createClaudeCliTransport } from "@/modules/cli/application"
import type { LlmConfig } from "@/stores/wiki-store"
import type { ChatMessage, RequestOverrides } from "@/lib/llm-providers"
import type { StreamCallbacks } from "@/lib/llm-client"
import { nativeCliPorts } from "./native-ports"
const transport = createClaudeCliTransport(nativeCliPorts("claude"))
export function streamClaudeCodeCli(config: LlmConfig, messages: ChatMessage[], callbacks: StreamCallbacks, signal?: AbortSignal, overrides?: RequestOverrides) {
  return transport.streamClaudeCodeCli(config, messages, callbacks, signal, overrides)
}
