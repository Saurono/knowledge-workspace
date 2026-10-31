import { readFile, listDirectory } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import { parseFrontmatter } from "@/lib/frontmatter"
import { buildRetrievalGraph, calculateRelevance } from "@/lib/graph-relevance"
import { detectCommunities } from "@/lib/wiki-graph-analysis"
import { createWikiGraphQuery } from "@/modules/star-map/application"
import { analyzeCommunities } from "./community-analysis"
export const { buildWikiGraph } = createWikiGraphQuery({
  read: path => readFile(path), list: path => listDirectory(path), normalizePath, parseFrontmatter,
  retrieval: buildRetrievalGraph, relevance: calculateRelevance, analyze: analyzeCommunities, fallback: detectCommunities,
})
