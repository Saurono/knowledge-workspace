import { expect, it } from "vitest"
import { createAgentOutputTracker } from "./outputs"
it("never offers destructive rollback for a shell snapshot or unknown previous content", async () => {
  const tracker = createAgentOutputTracker({ read: async () => "after", now: () => 1, unknownSnapshot: "unknown" }, "r")
  tracker.reference("a"); tracker.changed("b", "write", true)
  const changes = await tracker.flush()
  expect(changes.map(change => [change.path, change.beforeContent, change.afterContent, change.operation])).toEqual([["a", undefined, undefined, "modified"], ["b", undefined, undefined, "modified"]])
})
it("retains event order and known before/after snapshots", async () => {
  const tracker = createAgentOutputTracker({ read: async path => path, now: () => 1, unknownSnapshot: "unknown" }, "r")
  tracker.changed("b", "write", false); tracker.changed("a", "write", true, "before")
  expect((await tracker.flush()).map(change => [change.path, change.operation, change.beforeContent])).toEqual([["b", "created", null], ["a", "modified", "before"]])
})
