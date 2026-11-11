import assert from "node:assert/strict"
import { test } from "node:test"
import { SHARED_TOOL_OPERATIONS } from "../src/shared-tools.js"

test("shared tools expose read-only memory summaries and graph", () => {
  assert.equal(SHARED_TOOL_OPERATIONS.kw_memory_summaries, "memory.summaries")
  assert.equal(SHARED_TOOL_OPERATIONS.kw_memory_graph, "memory.graph")
})

test("shared tools preserve all seven existing mappings", () => {
  assert.equal(SHARED_TOOL_OPERATIONS.kw_wiki_list, "wiki.list")
  assert.equal(SHARED_TOOL_OPERATIONS.kw_wiki_read, "wiki.read")
  assert.equal(SHARED_TOOL_OPERATIONS.kw_wiki_write, "wiki.write")
  assert.equal(SHARED_TOOL_OPERATIONS.kw_documents, "documents.list")
  assert.equal(SHARED_TOOL_OPERATIONS.kw_memories, "memory.list")
  assert.equal(SHARED_TOOL_OPERATIONS.kw_search, "search")
  assert.equal(SHARED_TOOL_OPERATIONS.kw_switch_context, "context.switch")
})

test("shared tool names are unique and use the kw_ prefix", () => {
  const names = Object.keys(SHARED_TOOL_OPERATIONS)
  assert.equal(new Set(names).size, names.length)
  for (const name of names) assert.ok(name.startsWith("kw_"))
})

test("shared operations use only allowed prefixes or exact operations", () => {
  for (const operation of Object.values(SHARED_TOOL_OPERATIONS)) {
    assert.ok(
      /^(wiki\.|documents\.|memory\.)/.test(operation) || operation === "search" || operation === "context.switch",
    )
  }
})
