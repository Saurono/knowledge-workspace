import { expect, it } from "vitest"
import { accountFixture } from "./testing"

it("preserves creation on edit and resets creation after deletion", async () => {
  const f = await accountFixture()
  try {
    await f.bootstrap()
    const { cookie } = await f.login()
    const project = await f.json("/projects", "POST", { name: "timestamps" }, cookie)
    const path = `/projects/${project.data.id}/wiki/page?path=wiki/x.md`
    const first = await f.json(path, "PUT", { content: "first" }, cookie, { "If-None-Match": "*" })
    expect(first.response.status).toBe(200)
    f.clock("2026-11-01T00:00:01.000Z")
    const second = await f.json(path, "PUT", { content: "second" }, cookie, { "If-Match": first.response.headers.get("etag")! })
    expect(second.data.createdAt).toBe(first.data.createdAt)
    expect(second.data.updatedAt > first.data.updatedAt).toBe(true)
    expect((await f.request(path, "DELETE", undefined, cookie, { "If-Match": second.response.headers.get("etag")! })).status).toBe(200)
    f.clock("2026-11-01T00:00:02.000Z")
    const third = await f.json(path, "PUT", { content: "third" }, cookie, { "If-None-Match": "*" })
    expect(third.data.createdAt > second.data.createdAt).toBe(true)
  } finally { await f.close() }
})
