import { beforeEach, describe, expect, it, vi } from "vitest"
const structural = vi.hoisted(() => vi.fn())
vi.mock("@/lib/lint", () => ({
  runStructuralLint: structural,
  runSemanticLint: vi.fn().mockResolvedValue([]),
}))
import {
  runMaintenanceCheck,
  cancelMaintenanceTask,
  canCancelMaintenanceTask,
} from "./maintenance-tasks"
import { useWikiStore } from "@/stores/wiki-store"
import { useActivityStore } from "@/stores/activity-store"
import { DEFAULT_LINT_CONFIG } from "./lint-config"
beforeEach(() => {
  useWikiStore.setState({ project: { id: "one", name: "One", path: "/one" } })
  useActivityStore.setState({ items: [] })
  structural.mockReset()
})
describe("maintenance task lifetime", () => {
  it("can be cancelled from the task manager without a mounted Wiki view", async () => {
    structural.mockImplementation(
      (_path, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () =>
            reject(new DOMException("Cancelled", "AbortError")),
          )
        }),
    )
    const result = runMaintenanceCheck(
      "/one",
      DEFAULT_LINT_CONFIG,
      false,
      useWikiStore.getState().llmConfig,
    )
    const id = useActivityStore.getState().items[0].id
    expect(canCancelMaintenanceTask(id)).toBe(true)
    cancelMaintenanceTask(id)
    expect(await result).toBeNull()
    expect(canCancelMaintenanceTask(id)).toBe(false)
    expect(useActivityStore.getState().items[0].detail).toBe("Cancelled")
  })
  it("discards completed findings when the active project changes", async () => {
    let finish!: (value: []) => void
    structural.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const result = runMaintenanceCheck(
      "/one",
      DEFAULT_LINT_CONFIG,
      false,
      useWikiStore.getState().llmConfig,
    )
    useWikiStore.setState({ project: { id: "two", name: "Two", path: "/two" } })
    finish([])
    expect(await result).toBeNull()
  })
})
