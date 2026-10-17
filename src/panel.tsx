/**
 * Sidebar section renderer for the "sidebar.content" slot.
 *
 * Rendering contract (v2.0.31 host, visually verified):
 * - The host paints only what `render()` returns synchronously. Solid updates
 *   after mount (Show insertion, signal-driven text changes, <For> growth)
 *   never reach the screen — the host treats the claim's JSX as a one-shot
 *   snapshot. So this module is a PURE renderer of `{collapsed, rows}`; all
 *   state lives in tui.tsx, and every state change rebuilds the claim
 *   (de-register + re-register the slot) so the host calls `render()` again
 *   with fresh content.
 * - One `<text>` per line; colored segments are `<span fg>` children of that
 *   text (the local @opentui/solid 0.6.6 types do not declare `fg`, hence the
 *   cast — the host runtime accepts it; visually verified). A bare `<span>`
 *   outside a `<text>` renders an "orphan text" error box; `<text
 *   content={StyledText}>` paints nothing; a `<box>` root stops painting
 *   shortly after mount — all dead ends from the M2 draft, replaced here.
 */

import type { Plugin } from "@opencode/plugin/tui"
import type { Color } from "@opentui/core"
import { For, Show } from "solid-js"
import { limitRows, type ChangedFile, type RowKind } from "./classify"
import { SIDEBAR_WIDTH, formatCounts, gapToRight, layoutRow } from "./format"

type PluginContext = Plugin.Context

/** Exact content width inside the sidebar (host layout, v2.0.31):
 *  42 sidebar − 2 paddingLeft − 2 paddingRight = 38 inner, minus 1 more
 *  paddingRight on the content column = 37 usable columns. The previous 34
 *  was a conservative value from the indented draft and left a visible gap
 *  between right-aligned counters and the sidebar edge. */
const CONTENT_WIDTH = SIDEBAR_WIDTH - 5

/** Single bullet glyph for every row (user-requested flat look); the kind is
 *  conveyed by the bullet's color (docs §2.4). */
const ROW_ICON = "•"

export type PanelRenderProps = {
  readonly ctx: PluginContext
  readonly collapsed: boolean
  /** Classified, ordered rows (classifyAll output) for THIS session. */
  readonly rows: readonly ChangedFile[]
  /** Most recently edited file (highlighted); undefined when none recent. */
  readonly activeFile?: string
  /** Click-to-collapse: the title row is the hit target. */
  readonly onToggle: () => void
  /** Click a file row: open the built-in diff viewer for this session. */
  readonly onOpenDiff: () => void
}

/**
 * Pure render: `▼ Changes (N)  +A −D` title + per-file rows + truncation row.
 * Empty rows produce nothing (docs §4 空态：整节不渲染).
 */
export function renderPanel(props: PanelRenderProps) {
  const { ctx, collapsed, rows, activeFile, onToggle, onOpenDiff } = props
  const { shown, hidden } = limitRows(rows)

  const palette = {
    base: ctx.theme.text.base,
    muted: ctx.theme.text.muted,
    added: ctx.theme.text.feedback.success.base,
    deleted: ctx.theme.text.feedback.error.base,
    active: ctx.theme.text.feedback.warning.base,
  }
  const kindColor = (kind: RowKind): Color =>
    kind === "added" ? palette.added : kind === "deleted" ? palette.deleted : kind === "binary" ? palette.muted : palette.base

  /** Colored inline segment. TextNode renderables (spans) only honor the
   *  `style` and `href` props at runtime — a raw `fg` prop is silently
   *  dropped (verified in @opentui/solid's setProperty). Hence `style`.
   *  Must stay inside a `<text>` parent. */
  const Colored = (p: { readonly fg: Color; readonly children?: string }) => (
    <span style={{ fg: p.fg } as never}>{p.children}</span>
  )

  const totals = rows.reduce(
    (acc, row) => ({ additions: acc.additions + row.additions, deletions: acc.deletions + row.deletions }),
    { additions: 0, deletions: 0 },
  )

  /** `+A` green / `−D` red spans, zero counters omitted (formatCounts). */
  const Counts = (p: { readonly additions: number; readonly deletions: number; readonly lead: string }) => {
    const counts = formatCounts(p.additions, p.deletions)
    if (counts === "") return null
    return (
      <>
        {p.lead}
        <For each={counts.split(" ")}>
          {(part, index) => (
            <>
              {index() > 0 ? " " : null}
              <Colored fg={part.startsWith("+") ? palette.added : palette.deleted}>{part}</Colored>
            </>
          )}
        </For>
      </>
    )
  }

  /** `▼ Changes (N)  +A −D` — totals follow the title after two spaces (docs §4).
   *  Click anywhere on the title toggles collapse. */
  /** `▼ Changes (N)` + right-aligned `+A −D` totals ending on the same right
   *  edge as the file rows (CONTENT_WIDTH). Click anywhere on the title
   *  toggles collapse. */
  const titleLeft = `${collapsed ? "▶" : "▼"} Changes (${rows.length})`
  const titleCounts = formatCounts(totals.additions, totals.deletions)
  const title = (
    <text onMouseUp={onToggle} wrapMode="none">
      <Colored fg={palette.base}>{titleLeft}</Colored>
      <Counts additions={totals.additions} deletions={totals.deletions} lead={" ".repeat(gapToRight(titleLeft, titleCounts, CONTENT_WIDTH))} />
    </text>
  )

  /** Row segments: `• dir/basename      +a −d` — bullet muted-by-kind, dir muted, basename base,
   *  counters right-aligned. Returned as inline segments so every row can be
   *  packed into ONE multi-line <text>: separate per-row text renderables are
   *  stacked with the host container's gap, which doubled the line spacing. */
  const rowSegments = (row: ChangedFile) => {
    const icon = ROW_ICON
    const counts = formatCounts(row.additions, row.deletions)
    const { path, gap } = layoutRow(icon, row.file, counts, CONTENT_WIDTH)
    const slash = path.lastIndexOf("/")
    const dir = slash === -1 ? "" : path.slice(0, slash + 1)
    const basename = slash === -1 ? path : path.slice(slash + 1)
    // Recently-edited file: the whole bullet turns warning-colored and the
    // basename brightens, so the live target stands out from kind colors.
    // The event may report an absolute path while rows are project-relative.
    const isActive =
      activeFile !== undefined && (row.file === activeFile || activeFile.endsWith(`/${row.file}`))
    return [
      <Colored fg={isActive ? palette.active : kindColor(row.kind)}>{`${icon} `}</Colored>,
      dir !== "" ? <Colored fg={palette.muted}>{dir}</Colored> : null,
      <Colored fg={isActive ? palette.active : palette.base}>{basename}</Colored>,
      <Counts additions={row.additions} deletions={row.deletions} lead={" ".repeat(gap)} />,
    ]
  }

  const body = collapsed ? null : (
    <text wrapMode="none" onMouseUp={onOpenDiff}>
      {shown.flatMap((row, index) => [index > 0 ? "\n" : "", ...rowSegments(row)])}
      {hidden > 0 ? "\n" : ""}
      {hidden > 0 ? <Colored fg={palette.muted}>{`… +${hidden} more`}</Colored> : null}
    </text>
  )

  return (
    <Show when={rows.length > 0}>
      {title}
      {body}
    </Show>
  )
}