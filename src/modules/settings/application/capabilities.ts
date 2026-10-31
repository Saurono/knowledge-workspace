import { capabilitiesForRuntime } from "../domain"
import type { RuntimeKind } from "../domain"
/** Availability is a runtime capability, not CLI installation, Vault health or user authorization. */
export const createPlatformCapabilities = (detect: () => RuntimeKind) => ({ read: () => Object.freeze(capabilitiesForRuntime(detect())) })
