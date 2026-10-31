export interface CliCallbacks { onToken(token: string): void; onDone(): void; onError(error: Error): void }
export interface CliOverrides { temperature?: unknown; top_p?: unknown; top_k?: unknown; max_tokens?: unknown; stop?: unknown }
export interface CliTransportPorts {
  process: { spawn(payload: Record<string, unknown>): Promise<unknown>; kill(streamId: string): Promise<unknown> }
  events: { listen<T>(channel: string, callback: (event: { payload: T }) => void): Promise<() => void> }
  workingDirectory(): string | undefined
  createId(): string
  development: boolean
}
