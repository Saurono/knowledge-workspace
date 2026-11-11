import { expect, it, vi } from "vitest"
import { createWebPlatform } from "@/app/platform/web"

// Static rendering does not run the effect that fetches graph nodes.
it("fetches graph summaries with an encoded project and optional limit", async () => {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(
    JSON.stringify({ data: { items: [] }, meta: {} }), { status: 200 },
  ))
  const platform = createWebPlatform("https://example.test", "", fetcher)
  await platform.api.memoryGraph("project /1", { limit: 2000 })
  await platform.api.memoryGraph("project /1")
  expect(fetcher.mock.calls.map(([url, options]) => [String(url), options?.method])).toEqual([
    ["https://example.test/api/v1/projects/project%20%2F1/memories/graph?limit=2000", "GET"],
    ["https://example.test/api/v1/projects/project%20%2F1/memories/graph", "GET"],
  ])
})
