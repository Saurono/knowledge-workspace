import { describe, expect, it } from "vitest"
import { formatSourceTimestamp } from "./source-time"

describe("formatSourceTimestamp", () => {
  it("keeps missing or malformed timeline values explicitly unknown", () => {
    expect(formatSourceTimestamp(null, "未知")).toBe("未知")
    expect(formatSourceTimestamp("not-a-date", "未知")).toBe("未知")
  })
  it("formats known timestamps as localized date and time", () => {
    expect(formatSourceTimestamp("2026-11-01T10:00:00.000Z", "未知", "en-US")).not.toBe("未知")
  })
})
