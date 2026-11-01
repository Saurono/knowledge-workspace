export interface MemoryGrant { id: string; projectId: string; memoryId: string; ownerId: string; accountId: string; actions: ("read" | "write")[]; expiresAt: string; revokedAt: string | null }
