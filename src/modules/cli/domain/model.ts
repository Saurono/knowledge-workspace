/** CLI protocol input; image blocks are preserved for Claude and omitted explicitly in Codex prompts. */
export type CliContentBlock = { type: "text"; text: string } | { type: "image"; mediaType: string; dataBase64: string }
export interface CliMessage { role: "system" | "user" | "assistant"; content: string | CliContentBlock[] }
export interface CliModelConfig { model: string; localCliIsolation?: boolean; codexCliTimeoutMinutes?: number }
export interface CliCapability { installed: boolean; version: string | null; path: string | null; error: string | null }
