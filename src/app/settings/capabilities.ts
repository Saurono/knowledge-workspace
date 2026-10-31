import { isTauri } from "@tauri-apps/api/core"
import { createPlatformCapabilities } from "@/modules/settings/application"
export const platformCapabilities = createPlatformCapabilities(() => {
  if (import.meta.env.MODE === "demo" || (typeof location !== "undefined" && location.pathname.endsWith("/preview.html"))) return "preview"
  return isTauri() ? "desktop" : "web"
})
