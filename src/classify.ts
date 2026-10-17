/**
 * FileDiff → sidebar row classification (pure functions, no host imports).
 *
 * Rules come from docs/DEVELOPMENT.md §2.4:
 * - `status` ("added" | "deleted" | "modified") is the authoritative field of
 *   the V2 client schema.
 * - When the server response omits `status` (observed on 2.0.31 raw HTTP),
 *   fall back to the ±count heuristic: deletions === 0 → added,
 *   additions === 0 → deleted, otherwise modified.
 * - additions === 0 && deletions === 0 is a binary blob (or an empty patch):
 *   rendered as `●` in muted color, with no counters to show either way.
 */

export type DiffStatus = "added" | "deleted" | "modified"

export type RowKind = "modified" | "added" | "deleted" | "binary"

/** Structural subset of the client's FileDiffInfo; `status` is optional so the
 *  downgrade heuristic stays testable without host types. */
export type DiffInput = {
  readonly file: string
  readonly additions: number
  readonly deletions: number
  readonly status?: DiffStatus
}

export type ChangedFile = {
  readonly file: string
  readonly kind: RowKind
  readonly additions: number
  readonly deletions: number
}

/** Sidebar shows at most this many rows, then `… +M more` (docs §4). */
export const DEFAULT_ROW_LIMIT = 8

const KIND_RANK: Record<RowKind, number> = { modified: 0, added: 1, deleted: 2, binary: 3 }

export function classifyFile(diff: DiffInput): ChangedFile {
  const additions = diff.additions
  const deletions = diff.deletions
  let kind: RowKind
  if (additions === 0 && deletions === 0) {
    kind = "binary"
  } else if (diff.status === "added" || diff.status === "deleted" || diff.status === "modified") {
    kind = diff.status
  } else {
    kind = deletions === 0 ? "added" : additions === 0 ? "deleted" : "modified"
  }
  return { file: diff.file, kind, additions, deletions }
}

/** Classify and order: modified > added > deleted > binary, then by additions
 *  desc (deletions desc as tiebreak, then path asc for stable output). */
export function classifyAll(diffs: readonly DiffInput[]): ChangedFile[] {
  return diffs.map(classifyFile).sort((a, b) =>
    KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
    b.additions - a.additions ||
    b.deletions - a.deletions ||
    (a.file < b.file ? -1 : a.file > b.file ? 1 : 0),
  )
}

export function limitRows(
  rows: readonly ChangedFile[],
  limit: number = DEFAULT_ROW_LIMIT,
): { shown: ChangedFile[]; hidden: number } {
  const safeLimit = Math.max(limit, 0)
  return { shown: rows.slice(0, safeLimit), hidden: Math.max(rows.length - safeLimit, 0) }
}
