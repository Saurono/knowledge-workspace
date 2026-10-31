import { applyTextSelectionEdit, readFile } from "@/commands/fs"
/** Desktop actions injected at the application boundary; transport is not part of the editor. */
export const applyEditorSelection = (...args: Parameters<typeof applyTextSelectionEdit>) =>
  applyTextSelectionEdit(...args)
export const readEditorReference = (path: string) => readFile(path)
