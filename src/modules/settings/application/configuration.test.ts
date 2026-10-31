import { expect, it, vi } from "vitest"
import { createSettingsService } from "./configuration"
import { capabilitiesForRuntime } from "../domain"
import type { SettingsStore } from "./ports"
import type { SourceWatchConfig } from "../domain"
it("serializes project override updates and recovers its queue after a storage failure", async () => {
  const values = new Map<string, unknown>()
  const set = vi.fn(async (key: string, value: unknown) => { values.set(key, value) })
  const store: SettingsStore = { get: async <T>(key: string) => values.get(key) as T | undefined, set, save: async () => {}, delete: async key => values.delete(key) }
  const service = createSettingsService({ open: async () => store, normalizePath: value => value, normalizeSourceWatch: value => value as SourceWatchConfig, defaultZoom: 1, clampZoom: value => value })
  set.mockRejectedValueOnce(new Error("storage unavailable"))
  await expect(service.saveProjectLlmOverride("failed", { enabled: true, presetId: "openai", model: "failed" })).rejects.toThrow("unavailable")
  await Promise.all([
    service.saveProjectLlmOverride("first", { enabled: true, presetId: "openai", model: "one" }),
    service.saveProjectLlmOverride("second", { enabled: true, presetId: "openai", model: "two" }),
  ])
  expect(await service.loadProjectLlmOverride("first")).toMatchObject({ model: "one" })
  expect(await service.loadProjectLlmOverride("second")).toMatchObject({ model: "two" })
})
it("distinguishes preview simulation, local installation uncertainty and absent Web bridges", () => {
  expect(capabilitiesForRuntime("preview")).toMatchObject({ files: "simulated", cli: "simulated", sharedApi: "unknown" })
  expect(capabilitiesForRuntime("desktop")).toMatchObject({ files: "available", cli: "unknown" })
  expect(capabilitiesForRuntime("web")).toMatchObject({ files: "unavailable", shell: "unavailable" })
})
