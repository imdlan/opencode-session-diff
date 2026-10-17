/**
 * 42-column sidebar layout helpers (pure functions, no host imports).
 *
 * The sidebar slot is fixed at 42 columns (docs §2.5). Every row is:
 *   "  " + icon + " " + path + gap + counts
 * with the counters right-aligned. Path truncation cuts directory segments
 * from the left first so the basename always survives (docs §4, matrix #6).
 */

export const SIDEBAR_WIDTH = 42

/** Terminal display width: East-Asian aware, covering the glyphs this panel
 *  emits (fullwidth ＋/－ icons count as 2 columns). */
export function visibleWidth(input: string): number {
  let width = 0
  for (const char of input) {
    width += isWide(char.codePointAt(0) ?? 0) ? 2 : 1
  }
  return width
}

function isWide(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) || // Hangul Jamo
    (code >= 0x2e80 && code <= 0x303e) || // CJK radicals / Kangxi / symbols
    (code >= 0x3041 && code <= 0x33ff) || // Hiragana .. CJK compatibility
    (code >= 0x3400 && code <= 0x4dbf) || // CJK extension A
    (code >= 0x4e00 && code <= 0x9fff) || // CJK unified ideographs
    (code >= 0xa000 && code <= 0xa4cf) || // Yi
    (code >= 0xac00 && code <= 0xd7a3) || // Hangul syllables
    (code >= 0xf900 && code <= 0xfaff) || // CJK compatibility ideographs
    (code >= 0xfe30 && code <= 0xfe4f) || // CJK compatibility forms
    (code >= 0xff00 && code <= 0xff60) || // fullwidth forms (＋ －)
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1f64f) || // emoji
    (code >= 0x1f900 && code <= 0x1f9ff) ||
    (code >= 0x20000 && code <= 0x3fffd) // CJK extension B+
  )
}

/** Truncate a slash-separated path to `maxWidth` columns. Directory segments
 *  are dropped from the left (basename stays complete, docs §4); a basename
 *  that alone overflows the budget keeps its tail behind an ellipsis. */
export function truncatePath(path: string, maxWidth: number): string {
  if (maxWidth <= 0) return ""
  if (visibleWidth(path) <= maxWidth) return path
  const slash = path.lastIndexOf("/")
  const basename = slash === -1 ? path : path.slice(slash + 1)
  if (slash === -1 || visibleWidth(basename) > maxWidth) {
    return "…" + clipTail(basename, maxWidth - 1)
  }
  const segments = path.slice(0, slash).split("/")
  let candidate = path
  while (segments.length > 0 && visibleWidth(candidate) > maxWidth) {
    segments.shift()
    candidate = segments.length === 0 ? basename : segments.join("/") + "/" + basename
  }
  return candidate
}

/** Keep the trailing characters of `text` that fit `maxWidth` columns. */
function clipTail(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return ""
  const chars = [...text]
  let width = 0
  let start = chars.length
  for (let i = chars.length - 1; i >= 0; i -= 1) {
    const step = visibleWidth(chars[i] as string)
    if (width + step > maxWidth) break
    width += step
    start = i
  }
  return chars.slice(start).join("")
}

/** `+a −d` with U+2212 minus; zero counters are omitted, 0/0 yields "". */
export function formatCounts(additions: number, deletions: number): string {
  const parts: string[] = []
  if (additions > 0) parts.push(`+${additions}`)
  if (deletions > 0) parts.push(`−${deletions}`)
  return parts.join(" ")
}

export type RowLayout = {
  /** Path after 42-column truncation. */
  readonly path: string
  /** Spaces between path and counters; 0 when there are no counters. */
  readonly gap: number
}

/** Fit one sidebar row: truncate the path so that indent + icon + path +
 *  gap + counts lands exactly on `width` (default 42) columns. */
export function layoutRow(icon: string, path: string, counts: string, width: number = SIDEBAR_WIDTH): RowLayout {
  const used = 2 /* indent */ + visibleWidth(icon) + 1 /* space after icon */
  const countsWidth = visibleWidth(counts)
  const budget = width - used - (countsWidth > 0 ? countsWidth + 1 /* min gap */ : 0)
  const truncated = truncatePath(path, Math.max(budget, 1))
  const gap = countsWidth > 0 ? Math.max(width - used - visibleWidth(truncated) - countsWidth, 1) : 0
  return { path: truncated, gap }
}
