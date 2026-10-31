import type { CliCapability } from "../domain"
export interface CliCapabilityPort { detect(provider: "claude" | "codex"): Promise<CliCapability> }
export const createCliCapabilities = (port: CliCapabilityPort) => ({ detect: (provider: "claude" | "codex") => port.detect(provider) })
