import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { useWikiStore } from "@/stores/wiki-store"
import { createCliCapabilities, type CliTransportPorts } from "@/modules/cli/application"
export const nativeCliPorts = (provider: "claude" | "codex"): CliTransportPorts => ({
  process: {
    spawn: payload => invoke(`${provider}_cli_spawn`, payload),
    kill: streamId => invoke(`${provider}_cli_kill`, { streamId }),
  },
  events: { listen: (channel, callback) => listen(channel, callback) },
  workingDirectory: () => useWikiStore.getState().project?.path,
  createId: () => crypto.randomUUID(), development: import.meta.env.DEV,
})
export const cliCapabilities = createCliCapabilities({ detect: provider => invoke(`${provider}_cli_detect`) })
