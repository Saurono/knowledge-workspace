import { expect, it } from "vitest"
import { proposeWrite, type MemoryWriteProposal } from "./recall"

const proposal = (): MemoryWriteProposal => ({
  kind: "create",
  payload: { title: "Title", content: "Content", domainIds: [] },
  evidence: [{ source: "test", ref: "source" }],
  requestedBy: { kind: "agent", id: "agent" },
})

it("defaults an omitted proposal category to context without throwing", () => {
  const input = proposal()
  expect(() => proposeWrite(input)).not.toThrow()
  expect(proposeWrite(input).payload.category).toBe("context")
})

it("normalizes an unknown proposal category to context", () => {
  const input = proposal()
  input.payload.category = "乱写"
  expect(proposeWrite(input).payload.category).toBe("context")
})
