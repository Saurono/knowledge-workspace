import { createPageMerger } from "@/modules/wiki/application"
import { parseFrontmatter } from "@/lib/frontmatter"
import { normalizeMalformedWikilinks } from "@/modules/ingestion/domain"
export const { mergePageContent, stripMergeScaffolding } = createPageMerger({
  parseFrontmatter,
  normalizeWikilinks: normalizeMalformedWikilinks,
})
export type { MergeFn, MergePageOptions } from "@/modules/wiki/application"
export { stripBodyWikilinkPathPrefixes } from "@/modules/wiki/domain"
