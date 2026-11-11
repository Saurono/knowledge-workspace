# Retrieval baseline 20261110

这是契约层基线（mock 索引），不代表真实 Rust 检索质量。真实模型快照另开卡。

30 documents (15 zh / 15 en), 40 queries: exact 30, paraphrase 2, multi-hop 2, empty 2, domain 2, unauthorized 2.

| Metric | Measured value |
| --- | --- |
| recall@5 | 0.9714285714285714 |
| recall@10 | 0.9714285714285714 |
| citationHitRate | 0.9714285714285714 |
| emptyFalsePositiveRate | 0 |
| unauthorizedReturnCount | 0 |

Recall is macro averaged over 35 queries with nonempty relevance sets. Citation hit rate is the macro fraction of expected documents present as numbered, nonempty evidence. Empty false positives count any result on the five queries with empty relevance sets, including domain and access exclusions. Multi-hop relevance requires both the source page and its linked companion; this mock does not traverse links, explaining the missed companion pages.

Regression: on unchanged fixtures and script, any decrease greater than 0 in recall or citation hit rate, or any increase greater than 0 in empty false positives, is regression. Any unauthorized result is failure (exit 1); other metrics have no executable threshold.

Assertions: every query checks scope and domain forwarding; scope-zh and scope-en each require deniedCount=1. The aggregate unauthorizedReturnCount must be zero. The mock deliberately returns unauthorized candidates, so the real service performs access filtering. Domain filtering is implemented by the mock index, not by the service. Fake embedding is deterministic and used only for vectorScore metadata; ranking is fixed title matching, with ID tie breaking.

Validation: evaluator twice EXIT_CODE=0, identical output; tsc --build EXIT_CODE=0; retrieval vitest and module boundaries recorded in delivery. No network or Rust dependency. This demonstrates fixture repeatability, public-service access isolation, and bounded citation generation. It cannot demonstrate production relevance, embeddings, fusion, or real-model quality.
