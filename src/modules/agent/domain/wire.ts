import type { DisplayMessage } from "./model"
export type WireContentBlock = { type: "text"; text: string } | { type: "image"; mediaType: string; dataBase64: string }
export interface WireChatMessage { role: "system" | "user" | "assistant"; content: string | WireContentBlock[] }
export function chatMessagesToLLM(messages: DisplayMessage[]): WireChatMessage[] {
  return messages.map((m) => {
    // No images → keep the legacy string shape. Providers and the
    // single-string fast paths in the translators stay unchanged,
    // and existing tests that assert `content: "..."` keep passing.
    if (!m.images || m.images.length === 0) {
      return { role: m.role, content: m.content }
    }
    // Images present → emit a WireContentBlock[]. Text first (so the
    // model reads the prompt before the images), then one image
    // block per attachment. An empty text (image-only message)
    // still gets a text block — harmless, and keeps the shape
    // uniform.
    const blocks: WireContentBlock[] = [
      { type: "text", text: m.content },
      ...m.images.map((img): WireContentBlock => ({
        type: "image",
        mediaType: img.mediaType,
        dataBase64: img.dataBase64,
      })),
    ]
    return { role: m.role, content: blocks }
  })
}
