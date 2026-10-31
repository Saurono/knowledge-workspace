import type { SourceWatchConfig } from "../domain"
export interface SettingsStore {
  get<T>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
  save(): Promise<void>
  delete(key: string): Promise<unknown>
}
export interface SettingsPorts {
  open(): Promise<SettingsStore>
  normalizeSourceWatch(config?: Partial<SourceWatchConfig> | null): SourceWatchConfig
  normalizePath(path: string): string
  defaultZoom: number
  clampZoom(level: number): number
}
