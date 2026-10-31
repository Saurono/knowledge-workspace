import type { DisplayMessage } from "./model"
export function stripPersistedMessageImages(msg: DisplayMessage): DisplayMessage {
  const withoutImages = (() => {
    if (!msg.images || msg.images.length === 0) return msg
    const { images: _images, ...rest } = msg
    return rest
  })()
  if (!withoutImages.agentFileChanges?.some((change) => "beforeContent" in change || "afterContent" in change)) {
    return withoutImages
  }
  return {
    ...withoutImages,
    agentFileChanges: withoutImages.agentFileChanges.map(({
      beforeContent: _before,
      afterContent: _after,
      ...change
    }) => change),
  }
}
