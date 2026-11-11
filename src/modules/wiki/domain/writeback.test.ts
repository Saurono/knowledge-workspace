import { describe, expect, it } from "vitest"
import { isResolutionVerified, assertWritebackTransition, type WikiWritebackDraft } from "./writeback"
describe("writeback verification evidence", () => {
  it("requires an explicit verification event bound to both target and environment", () => {
    const observations = [{ id: "o1", tool: "shell.exec", outcome: "succeeded" as const, occurredAt: "2026-11-09", targetHash: "a".repeat(64) }]
    expect(isResolutionVerified(observations, "a".repeat(64), "win")).toBe(false)
    expect(isResolutionVerified([{ ...observations[0], verification: { kind: "bound-executor" as const, targetHash: "a".repeat(64), environment: "linux", observedAt: "now" } }], "a".repeat(64), "win")).toBe(false)
    expect(isResolutionVerified([{ ...observations[0], verification: { kind: "user-manual" as const, targetHash: "a".repeat(64), environment: "win", observedAt: "now" } }], "a".repeat(64), "win")).toBe(true)
  })
})

it.each([["a", "win", true], ["b", "win", false], ["a", "linux", false]] as const)("executor binding %s/%s", (hash, environment, expected) => {
 expect(isResolutionVerified([{ id: "o", tool: "exec", outcome: "succeeded", occurredAt: "now", verification: { kind: "bound-executor", targetHash: hash.repeat(64), environment, observedAt: "now" } }], "a".repeat(64), "win")).toBe(expected)
})

const illegal = [["conflict", "published"], ...(["rejected", "published"] as const).flatMap(from => (["draft", "conflict", "rejected", "published"] as const).map(to => [from, to] as const))] as const
it.each(illegal)("rejects %s to %s without mutation", (from, to) => {
 const current = { status: from } as WikiWritebackDraft
 const next = { status: to } as WikiWritebackDraft
 expect(() => assertWritebackTransition(current, next)).toThrow("Illegal")
 expect(current.status).toBe(from)
 expect(next.status).toBe(to)
})

