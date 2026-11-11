export interface ImageRef {
  url: string
  alt: string
}

export interface SearchResult {
  projectId?: string
  path: string
  title: string
  snippet: string
  titleMatch: boolean
  score: number
  vectorScore?: number
  images: ImageRef[]
  content?: string
  graphRelatedTo?: string[]
}

export interface BackendSearchResponse {
  deniedCount?: number
  // Reserved for result badges/debug UI. The backend already returns these
  // signals so API and WebView search share the same retrieval contract.
  mode: "keyword" | "vector" | "hybrid"
  results: SearchResult[]
  tokenHits: number
  vectorHits: number
  graphHits?: number
}

export interface RetrievalEvidence extends SearchResult {
  citation: number
  text: string
}
