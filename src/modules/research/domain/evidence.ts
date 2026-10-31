const MIN_RESEARCH_CONTENT_CHARS = 120
const MIN_RESEARCH_BLOCK_CHARS = 40

export interface ResearchSynthesisValidation {
  valid: boolean
  cleaned: string
  citedSourceIndexes: number[]
  error: string | null
}

export function noResearchSourcesTaskPatch(sourceErrors: string[]): {
  status: "done" | "error"
  synthesis: string
  error: string | null
} {
  // If every selected source produced zero usable results and at least
  // one source failed, surface the failure state explicitly. Otherwise
  // the UI shows "completed" for a task that could not actually search.
  if (sourceErrors.length > 0) {
    return {
      status: "error",
      synthesis: "",
      error: sourceErrors.join("\n"),
    }
  }
  return {
    status: "done",
    synthesis: "No research sources found.",
    error: null,
  }
}

export function rejectedResearchSourcesTaskPatch(
  candidateCount: number,
  sourceErrors: string[],
): { status: "error"; synthesis: string; error: string } {
  return {
    status: "error",
    synthesis: "",
    error: [
      `${candidateCount} candidate source(s) were found, but all were rejected by the relevance and evidence-quality gate. Refine the research topic or queries and retry.`,
      ...sourceErrors,
    ].join("\n"),
  }
}

/**
 * Remove private reasoning before validating or persisting model output. Keep
 * this shared with the completion gate so content cannot pass validation and
 * then become empty after a different save-time cleanup.
 */
export function cleanResearchSynthesis(content: string): string {
  return content
    .replace(/<think(?:ing)?>\s*[\s\S]*?<\/think(?:ing)?>\s*/gi, "")
    .replace(/<think(?:ing)?>\s*[\s\S]*$/gi, "")
    .trim()
}

function meaningfulCharacterCount(content: string): number {
  // Unicode letters and numbers work across languages without relying on
  // localized section names or language-specific tokenization.
  return (content.match(/[\p{L}\p{N}]/gu) ?? []).length
}

/** Return one-based source indexes cited with Markdown-style [N] markers. */
export function citedResearchSourceIndexes(content: string, sourceCount: number): number[] {
  const cited = new Set<number>()
  for (const match of content.matchAll(/\[([\d,\-\s]+)\]/g)) {
    for (const part of match[1].split(",")) {
      const range = part.trim().match(/^(\d+)\s*-\s*(\d+)$/)
      if (range) {
        const start = Number(range[1])
        const end = Number(range[2])
        if (start <= end && end - start <= sourceCount) {
          for (let index = start; index <= end; index++) {
            if (index >= 1 && index <= sourceCount) cited.add(index)
          }
        }
        continue
      }
      const index = Number(part.trim())
      if (Number.isInteger(index) && index >= 1 && index <= sourceCount) cited.add(index)
    }
  }
  return [...cited].sort((a, b) => a - b)
}

/**
 * A completed research task must contain substantive prose and cite at least
 * one collected source. This is deliberately language-neutral: it evaluates
 * Unicode text structure rather than requiring named English/Chinese sections.
 */
export function validateResearchSynthesis(
  content: string,
  sourceCount: number,
): ResearchSynthesisValidation {
  const cleaned = cleanResearchSynthesis(content)
  const blocks = cleaned
    .split(/\n\s*\n/)
    .map((block) => block.replace(/^\s{0,3}#{1,6}\s+/gm, ""))
    .map(meaningfulCharacterCount)
    .filter((count) => count >= MIN_RESEARCH_BLOCK_CHARS)
  const meaningfulChars = meaningfulCharacterCount(cleaned)
  const citedSourceIndexes = citedResearchSourceIndexes(cleaned, sourceCount)

  if (meaningfulChars < MIN_RESEARCH_CONTENT_CHARS || blocks.length === 0) {
    return {
      valid: false,
      cleaned,
      citedSourceIndexes,
      error: "The research synthesis was empty or incomplete. Please retry.",
    }
  }
  if (sourceCount > 0 && citedSourceIndexes.length === 0) {
    return {
      valid: false,
      cleaned,
      citedSourceIndexes,
      error: "The research synthesis did not cite any collected sources. Please retry.",
    }
  }
  return { valid: true, cleaned, citedSourceIndexes, error: null }
}
