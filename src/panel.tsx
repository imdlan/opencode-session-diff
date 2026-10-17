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
import { SIDEBAR_WIDTH, formatCounts, layoutRow } from "./format"

type PluginContext = Plugin.Context

/** The host pads the 42-column sidebar by 2 columns on each side (v2.0.31
 *  sidebar container: paddingLeft 2 / paddingRight 2), so lines must fit the
 *  38-column content box or the counters wrap onto a second line. */
const CONTENT_WIDTH = SIDEBAR_WIDTH - 8

/** Single bullet glyph for every row (user-requested flat look); the kind is
 *  conveyed by the bullet's color (docs §2.4). */
const ROW_ICON = "•"

export type PanelRenderProps = {
  readonly ctx: PluginContext
  readonly collapsed: boolean
  /** Classified, ordered rows (classifyAll output) for THIS session. */
  readonly rows: readonly ChangedFile[]
  /** Click-to-collapse: the title row is the hit target (host paints a
   *  synchronous snapshot, so the toggle flows back through claim rebuild). */
  readonly onToggle: () => void
}

/**
 * Pure render: `▼ Changes (N)  +A −D` title + per-file rows + truncation row.
 * Empty rows produce nothing (docs §4 空态：整节不渲染).
 */
export function renderPanel(props: PanelRenderProps) {
  const { ctx, collapsed, rows, onToggle } = props
  const { shown, hidden } = limitRows(rows)

  const palette = {
    base: ctx.theme.text.base,
    muted: ctx.theme.text.muted,
    added: ctx.theme.text.feedback.success.base,
    deleted: ctx.theme.text.feedback.error.base,
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
  const title = (
    <text onMouseUp={onToggle}>
      <Colored fg={palette.base}>{`${collapsed ? "▶" : "▼"} Changes (${rows.length})`}</Colored>
      <Counts additions={totals.additions} deletions={totals.deletions} lead="  " />
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
    return [
      <Colored fg={kindColor(row.kind)}>{`${icon} `}</Colored>,
      dir !== "" ? <Colored fg={palette.muted}>{dir}</Colored> : null,
      <Colored fg={palette.base}>{basename}</Colored>,
      <Counts additions={row.additions} deletions={row.deletions} lead={" ".repeat(gap)} />,
    ]
  }

  const body = collapsed ? null : (
    <text>
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