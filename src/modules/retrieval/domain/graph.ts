export interface RetrievalNode {
  readonly id: string
  readonly title: string
  readonly type: string
  readonly path: string
  readonly sources: readonly string[]
  readonly outLinks: ReadonlySet<string>
  readonly inLinks: ReadonlySet<string>
}

export interface RetrievalGraph {
  readonly nodes: ReadonlyMap<string, RetrievalNode>
  readonly dataVersion: number
}
