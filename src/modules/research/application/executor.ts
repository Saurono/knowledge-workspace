import type { TaskExecutionContext, TaskExecutor } from "@/modules/tasks"
import {
  noResearchSourcesTaskPatch,
  rejectedResearchSourcesTaskPatch,
  validateResearchSynthesis,
  type ResearchTask,
  type ResearchSource,
} from "../domain"

export interface ResearchInput<Model, Search> {
  projectPath: string
  topic: string
  model: Model
  search: Search
  queries: string[]
}
export interface ResearchSources {
  results: ResearchSource[]
  errors: string[]
  candidateCount: number
  rejectedCount: number
}
export interface ResearchOutput {
  savedPath: string | null
  synthesis: string
  sources: ResearchSource[]
}
export interface ResearchPorts<Model, Search> {
  collect(input: ResearchInput<Model, Search>, signal: AbortSignal): Promise<ResearchSources>
  readWikiIndex(projectPath: string): Promise<string>
  languageDirective(topic: string): string
  synthesize(
    model: Model,
    messages: Array<{ role: "system" | "user"; content: string }>,
    onToken: (token: string) => void,
    signal: AbortSignal,
  ): Promise<void>
  save(
    input: ResearchInput<Model, Search>,
    synthesis: string,
    references: string,
    context: TaskExecutionContext,
  ): Promise<string>
  update(taskId: string, patch: Partial<ResearchTask>): void
}
export const RESEARCH_EXECUTOR = "research.synthesize"
export function createResearchExecutor<Model, Search>(
  ports: ResearchPorts<Model, Search>,
): TaskExecutor<ResearchInput<Model, Search>, ResearchOutput> {
  return {
    async execute(input, context) {
      const publish = (patch: Partial<ResearchTask>) => {
        context.assertCurrent()
        ports.update(context.taskId, patch)
        if (patch.status) context.progress(patch.status)
      }
      publish({ status: "searching" })
      const found = await ports.collect(input, context.signal)
      context.assertCurrent()
      const sources = found.results
      publish({ webResults: sources })
      if (sources.length === 0) {
        const patch =
          found.candidateCount > 0 && found.rejectedCount === found.candidateCount
            ? rejectedResearchSourcesTaskPatch(found.candidateCount, found.errors)
            : noResearchSourcesTaskPatch(found.errors)
        publish(patch)
        if (patch.status === "error") throw new Error(patch.error!)
        return { savedPath: null, synthesis: patch.synthesis, sources }
      }
      publish({ status: "synthesizing" })
      let wikiIndex = ""
      try {
        wikiIndex = await ports.readWikiIndex(input.projectPath)
      } catch {
        /* no index yet */
      }
      context.assertCurrent()
      const systemPrompt = [
        "You are a research assistant. Synthesize the collected research sources into a comprehensive wiki page.",
        "",
        ports.languageDirective(input.topic),
        "",
        "## Cross-referencing (IMPORTANT)",
        "- The wiki already has existing pages listed in the Wiki Index below.",
        "- When your synthesis mentions an entity or concept that exists in the wiki, ALWAYS use [[wikilink]] syntax to link to it.",
        "- For example, if the wiki has an entity 'anthropic', write [[anthropic]] when mentioning it.",
        "- This is critical for connecting new research to existing knowledge in the graph.",
        "",
        "## Writing Rules",
        "- Organize into clear sections with headings",
        "- Cite sources using [N] notation",
        "- Note contradictions or gaps",
        "- Suggest additional sources worth finding",
        "- Neutral, encyclopedic tone",
        "",
        wikiIndex
          ? `## Existing Wiki Index (link to these pages with [[wikilink]])\n${wikiIndex}`
          : "",
      ]
        .filter(Boolean)
        .join("\n")
      const searchContext = sources
        .map((r, i) => `[${i + 1}] **${r.title}** (${r.source})\n${r.snippet}`)
        .join("\n\n")
      let accumulated = ""
      await ports.synthesize(
        input.model,
        [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `Research topic: **${input.topic}**\n\n## Research Sources\n\n${searchContext}\n\nSynthesize into a wiki page.`,
          },
        ],
        (token) => {
          try {
            context.assertCurrent()
          } catch {
            return
          }
          accumulated += token
          publish({ synthesis: accumulated })
        },
        context.signal,
      )
      context.assertCurrent()
      const validation = validateResearchSynthesis(accumulated, sources.length)
      if (!validation.valid) {
        publish({ status: "error", synthesis: validation.cleaned, error: validation.error })
        throw new Error(validation.error!)
      }
      publish({ status: "saving", synthesis: validation.cleaned })
      const references = validation.citedSourceIndexes
        .map((index) => {
          const source = sources[index - 1]
          return `${index}. [${source.title}](${source.url}) — ${source.source}`
        })
        .join("\n")
      const savedPath = await ports.save(input, validation.cleaned, references, context)
      publish({ status: "done", savedPath })
      return { savedPath, synthesis: validation.cleaned, sources }
    },
  }
}
