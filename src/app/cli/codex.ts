import { createCodexCliTransport } from "@/modules/cli/application"
import type { LlmConfig } from "@/stores/wiki-store"
import type { ChatMessage, RequestOverrides } from "@/lib/llm-providers"
import type { StreamCallbacks } from "@/lib/llm-client"
import { nativeCliPorts } from "./native-ports"
const transport = createCodexCliTransport(nativeCliPorts("codex"))
export function streamCodexCli(config: LlmConfig, messages: ChatMessage[], callbacks: StreamCallbacks, signal?: AbortSignal, overrides?: RequestOverrides) {
  return transport.streamCodexCli(config, messages, callbacks, signal, overrides)
}
