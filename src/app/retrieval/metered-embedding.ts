import { createModelGateway } from "@/modules/model-gateway"
import type { GatewayOptions, UsageJournal } from "@/modules/model-gateway"
import type { EmbeddingModelPort } from "@/modules/retrieval/application"
import { createProjectUsageJournal } from "../model-usage"
import { nativeEmbeddingPorts } from "./native-ports"

export function createMeteredEmbeddingModel(project: () => string | null, operation: string, deps: Partial<GatewayOptions> & { model?: EmbeddingModelPort } = {}): EmbeddingModelPort {
  const model = deps.model ?? nativeEmbeddingPorts.model
  const wrap = (config: Parameters<EmbeddingModelPort["embed"]>[1]) => {
    const root = project()
    if (!root) {
      // Without a project there is no honest persistence destination.
      console.warn("Skipping embedding usage journal: no current project")
      return model
    }
    const target = deps.journal ?? createProjectUsageJournal(root)
    const journal: UsageJournal = { all: () => target.all(), append: record => target.append({ ...record, operation }) }
    return createModelGateway({ now: Date.now, newId: () => crypto.randomUUID(), budget: { limitTokens: null, usedTokens: 0 }, ...deps, journal })
      .wrapEmbedding(model, { projectId: root, provider: config.endpoint })
  }
  return {
    embed: (text, config, retries) => wrap(config).embed(text, config, retries),
    embedBatch: (texts, config) => wrap(config).embedBatch(texts, config),
  }
}
