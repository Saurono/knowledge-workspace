import { expect, it, vi } from "vitest"
import { GatewayError, type UsageRecord } from "@/modules/model-gateway"
import { createMeteredEmbeddingModel } from "./metered-embedding"
it("meters each batch once, including network failure", async () => {
  const records: UsageRecord[] = []
  const model = { embed: vi.fn(), embedBatch: vi.fn().mockResolvedValue([[1]]) }
  const port = createMeteredEmbeddingModel(() => "C:/project", "index", {
    model, journal: { append: async record => { records.push(record) }, all: async () => records },
    newId: () => "id", now: () => 0,
  })
  const config = { enabled: true, endpoint: "https://provider/embeddings", apiKey: "", model: "model-a" }
  await port.embedBatch(["a", "b"], config)
  expect(records).toHaveLength(1)
  expect(records[0]).toMatchObject({ projectId: "C:/project", operation: "index", provider: config.endpoint, model: "model-a", outcome: "ok" })
  records.length = 0
  model.embedBatch.mockRejectedValue(new TypeError("fetch failed"))
  await expect(port.embedBatch(["a"], config)).rejects.toBeInstanceOf(GatewayError)
  expect(records).toHaveLength(1)
  expect(records[0]).toMatchObject({ outcome: "failed", errorCode: "network_unavailable" })
})
