import { invoke } from "@tauri-apps/api/core"
import type { VerifiedPageIndexCommit, VerifiedPageIndexPort } from "@/modules/retrieval/application"

type InvokeCommand = typeof invoke

/** Native verified commit/check transport. The Tauri commands own page path validation and evidence. */
export function createVerifiedPageIndexPort(invokeCommand: InvokeCommand = invoke): VerifiedPageIndexPort {
  return {
    commitPage: input => invokeCommand<VerifiedPageIndexCommit>("embed_wiki_page_verified", {
      projectPath: input.projectPath,
      relativePath: input.relativePath,
      config: input.config,
      force: input.force ?? false,
    }),
    verifyPage: input => invokeCommand("verify_page_index_commit", {
      projectPath: input.projectPath,
      relativePath: input.relativePath,
      config: input.config,
      expected: input.expected,
    }),
  }
}

export const verifiedPageIndexPort = createVerifiedPageIndexPort()
