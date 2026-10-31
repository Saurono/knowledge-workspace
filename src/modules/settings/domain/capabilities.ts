export type RuntimeKind = "desktop" | "web" | "preview"
export type CapabilityState = "available" | "unavailable" | "simulated" | "unknown"
export interface PlatformCapabilityState {
  runtime: RuntimeKind
  files: CapabilityState
  watchers: CapabilityState
  shell: CapabilityState
  vault: CapabilityState
  cli: CapabilityState
  sharedApi: CapabilityState
}
export function capabilitiesForRuntime(runtime: RuntimeKind): PlatformCapabilityState {
  const local = runtime === "preview" ? "simulated" : runtime === "desktop" ? "available" : "unavailable"
  return { runtime, files: local, watchers: local, shell: local, vault: local, cli: runtime === "desktop" ? "unknown" : local, sharedApi: "unknown" }
}
