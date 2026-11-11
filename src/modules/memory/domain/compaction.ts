import type { MemoryRecord, MemoryRevision } from "./model"

export interface ArchivedRevision { version: number; data: MemoryRevision }

// 稳定校验和，不是密码学摘要。FNV-1a 64 over UTF-8 bytes.
export function stableDigest(input: string): string {
  let hash = 0xcbf29ce484222325n
  for (const byte of new TextEncoder().encode(input)) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n)
  }
  return hash.toString(16).padStart(16, "0")
}

export function compactRevisions(
  record: MemoryRecord,
  options?: { keep?: number; threshold?: number },
): { record: MemoryRecord; archived: ArchivedRevision[] } {
  const threshold = options?.threshold ?? 8
  const keep = options?.keep ?? 5
  if (record.revisions.length <= threshold) return { record, archived: [] }
  if (!Number.isInteger(keep) || keep < 1 || keep >= record.revisions.length) {
    throw new Error("Invalid revision keep count")
  }
  const revisions = record.revisions.slice(-keep)
  const older = record.revisions.slice(0, -keep).sort((a, b) => a.version - b.version)
  // Explicit field order also makes nested source serialization stable.
  const serialized = JSON.stringify(older.map(r => ({
    version: r.version, title: r.title, content: r.content, at: r.at,
    source: { kind: r.source.kind, actorId: r.source.actorId, ref: r.source.ref },
    changeNote: r.changeNote,
  })))
  return {
    record: { ...record, revisions, revisionCompaction: {
      upToVersion: older[older.length - 1].version,
      keptFrom: revisions[0].version, digest: stableDigest(serialized),
    } },
    archived: older.map(data => ({ version: data.version, data })),
  }
}
