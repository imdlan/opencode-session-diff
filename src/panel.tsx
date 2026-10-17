/**
 * <ChangesPanel> — the sidebar section rendered into the "sidebar.content" slot.
 *
 * Data flow (docs §3): a single `readonly FileDiffInfo[]` signal is the only
 * state. It is seeded by a mount-time `client.session.diff` fetch and replaced
 * wholesale by debounced refetches on round/revert events. Render derives:
 * classify → sort → limit → 42-column lines.
 */

import type { Plugin } from "@opencode/plugin/tui"
import type { FileDiffInfo } from "@opencode/client"
import { StyledText, fg } from "@opentui/core"
import type { Color, TextChunk } from "@opentui/core"
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import type { Store } from "solid-js/store"
import { classifyAll, limitRows, type ChangedFile, type RowKind } from "./classify"
import { formatCounts, layoutRow } from "./format"

type PluginContext = Plugin.Context

/** Docs §2.2: round success is the main refresh point, idle is the fallback,
 *  revert events cover `/undo`. There is no push event for diffs in V2. */
const REFRESH_EVENTS = [
  "session.execution.succeeded",
  "session.idle",
  "session.revert.staged",
  "session.revert.cleared",
  "session.revert.committed",
] as const

const REFRESH_DEBOUNCE_MS = 500

/** Docs §2.4 icons: ✎ modified, ＋ added, － deleted, ● binary (0/0). */
const KIND_ICON: Record<RowKind, string> = { modified: "✎", added: "＋", deleted: "－", binary: "●" }

export type ChangesPanelProps = {
  readonly ctx: PluginContext
  /** Persistent collapse state store (survives TUI restarts, live-synced). */
  readonly store: Store<{ collapsed: boolean }>
  readonly sessionID: string
}

export function ChangesPanel(props: ChangesPanelProps) {
  const ctx = props.ctx
  const [diffs, setDiffs] = createSignal<readonly FileDiffInfo[]>([])

  createEffect(() => {
    const sessionID = props.sessionID
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined

    setDiffs([])
    const refresh = () => {
      if (!alive || !sessionID) return
      ctx.client.session.diff({ sessionID }).then(
        (result) => {
          if (alive) setDiffs(result)
        },
        () => {
          // Transient fetch failure: keep the last good snapshot.
        },
      )
    }

    refresh() // mount-time first fetch
    const scheduleRefresh = () => {
      if (timer !== undefined) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = undefined
        refresh()
      }, REFRESH_DEBOUNCE_MS)
    }
    const stops = REFRESH_EVENTS.map((type) => ctx.data.on(type, scheduleRefresh))
    onCleanup(() => {
      alive = false
      for (const stop of stops) stop()
      if (timer !== undefined) clearTimeout(timer)
    })
  })

  const rows = createMemo(() => classifyAll(diffs()))
  const limited = createMemo(() => limitRows(rows()))
  const totals = createMemo(() => {
    let additions = 0
    let deletions = 0
    for (const row of rows()) {
      additions += row.additions
      deletions += row.deletions
    }
    return { count: rows().length, additions, deletions }
  })

  const palette = {
    base: ctx.theme.text.base,
    muted: ctx.theme.text.muted,
    added: ctx.theme.text.feedback.success.base,
    deleted: ctx.theme.text.feedback.error.base,
  }
  const kindColor = (kind: RowKind): Color =>
    kind === "added" ? palette.added : kind === "deleted" ? palette.deleted : kind === "binary" ? palette.muted : palette.base

  const pushCounts = (chunks: TextChunk[], counts: string, lead: string) => {
    chunks.push(fg(palette.base)(lead))
    const parts = counts.split(" ")
    for (const [index, part] of parts.entries()) {
      if (index > 0) chunks.push(fg(palette.base)(" "))
      chunks.push(fg(part.startsWith("+") ? palette.added : palette.deleted)(part))
    }
  }

  /** `▼ Changes (N)  +A −D` — totals follow the title after two spaces (docs §4). */
  const titleLine = (): StyledText => {
    const mark = props.store.collapsed ? "▶" : "▼"
    const chunks: TextChunk[] = [fg(palette.base)(`${mark} Changes (${totals().count})`)]
    const counts = formatCounts(totals().additions, totals().deletions)
    if (counts !== "") pushCounts(chunks, counts, "  ")
    return new StyledText(chunks)
  }

  /** `  ✎ dir/basename      +a −d` — dir muted, basename base, counters right-aligned. */
  const rowLine = (row: ChangedFile): StyledText => {
    const icon = KIND_ICON[row.kind]
    const counts = formatCounts(row.additions, row.deletions)
    const { path, gap } = layoutRow(icon, row.file, counts)
    const slash = path.lastIndexOf("/")
    const dir = slash === -1 ? "" : path.slice(0, slash + 1)
    const basename = slash === -1 ? path : path.slice(slash + 1)
    const chunks: TextChunk[] = [fg(kindColor(row.kind))(`  ${icon} `)]
    if (dir !== "") chunks.push(fg(palette.muted)(dir))
    chunks.push(fg(palette.base)(basename))
    if (counts !== "") pushCounts(chunks, counts, " ".repeat(gap))
    return new StyledText(chunks)
  }

  const moreLine = (): StyledText => new StyledText([fg(palette.muted)(`  … +${limited().hidden} more`)])

  return (
    <Show when={rows().length > 0}>
      <box flexDirection="column">
        <text content={titleLine()} />
        <Show when={!props.store.collapsed}>
          <For each={limited().shown}>{(row) => <text content={rowLine(row)} />}</For>
          <Show when={limited().hidden > 0}>
            <text content={moreLine()} />
          </Show>
        </Show>
      </box>
    </Show>
  )
}
