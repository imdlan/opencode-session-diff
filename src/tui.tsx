/**
 * Plugin entry (TUI side). Loaded by the host through the package.json
 * "./tui" subpath export.
 *
 * Contract (docs §2.6, verified against @opencode/plugin 2.0.32):
 *   export default Plugin.define({ id, setup(ctx) => cleanup })
 *
 * Note: `Plugin` is a namespace export (`export * as Plugin`), so the callable
 * is `Plugin.define` — `Plugin({...})` from earlier doc drafts does not exist.
 *
 * Architecture (v2.0.31, visually verified): the host paints only what
 * `slot.render()` returns synchronously — Solid updates after mount never
 * reach the screen (delayed <Show> insertions and signal-driven text updates
 * both stay invisible). So instead of reactive in-panel state, the panel
 * claim is REBUILT whenever displayed content changes:
 *
 *   render(input.sessionID) → remember session, fetch session.diff
 *     → fetch resolves with rows → rebuild claim (stop + re-register)
 *     → host calls render() again → now paints the fetched snapshot.
 *
 * The first paint renders nothing (empty rows → docs §4 empty state); once
 * the diff resolves, the rebuild paints the real section. Refreshes are
 * debounced (docs §2.2) on round/revert events. Collapse state persists via
 * ctx.storage and also flows through claim rebuilds.
 */

import { Plugin } from "@opencode/plugin/tui"
import { createSignal, createEffect, untrack } from "solid-js"
import { classifyAll, sameRows, type ChangedFile } from "./classify"
import { renderPanel } from "./panel"

const STORAGE_KEY = "session-changes"

/** Debounced event-driven refetch triggers: round success is the main
 *  refresh point, idle is the fallback, revert events cover `/undo`. There
 *  is no push event for diffs in V2 (docs §2.2). */
const REFRESH_EVENTS = [
  "session.execution.succeeded",
  "session.idle",
  "session.revert.staged",
  "session.revert.cleared",
  "session.revert.committed",
] as const

const REFRESH_DEBOUNCE_MS = 500

/** How long a file stays highlighted after the last filesystem change. */
const EDIT_HIGHLIGHT_MS = 5_000

export default Plugin.define({
  id: "session-changes",
  setup(ctx) {
    const [store, mutate] = ctx.storage.store<{ collapsed: boolean }>(STORAGE_KEY, { initial: { collapsed: false } })

    const toggleCollapsed = () => {
      void mutate((draft) => {
        draft.collapsed = !draft.collapsed
      })
    }

    // Ctrl+P command for collapse/expand. A row-click "diff.open" jump is
    // deferred: the route/command name is still unverified (docs §10), so the
    // panel stays display-only as the documented fallback.
    const stopCommands = ctx.ui.slot({
      append: "app",
      render: () => {
        ctx.keymap.layer(() => ({
          mode: "global",
          commands: [
            {
              id: "session-changes.toggle",
              title: "Changes: toggle collapse",
              description: "Collapse or expand the session changes sidebar section",
              group: "session-changes",
              palette: true,
              run: toggleCollapsed,
            },
          ],
        }))
        return null
      },
    })

    // --- snapshot state ---------------------------------------------------
    // Displayed content = (active sessionID, its classified rows, collapsed).
    // Bumping the tuple identity drives the claim-rebuild effect below.
    type Snapshot = {
      readonly sessionID: string
      readonly rows: readonly ChangedFile[]
      readonly collapsed: boolean
    }
    const [snapshot, setSnapshot] = createSignal<Snapshot>({ sessionID: "", rows: [], collapsed: false })

    /** Sessions already fetched once — prevents refetch loops when a session
     *  genuinely has no changes (empty rows must not re-trigger fetches). */
    const fetchedSessions = new Set<string>()

    let stopPanel: (() => void) | undefined
    let disposed = false
    let inFlight = false

    const fetchAndRebuild = (sessionID: string) => {
      if (inFlight || !sessionID) return
      inFlight = true
      fetchedSessions.add(sessionID)
      ctx.client.session.diff({ sessionID }).then(
        (result) => {
          inFlight = false
          if (disposed) return
          setSnapshot((prev) => {
            const rows = classifyAll(result)
            // Skip churn: identical content keeps the claim as-is.
            if (prev.sessionID === sessionID && sameRows(prev.rows, rows)) return prev
            return { ...prev, sessionID, rows }
          })
        },
        () => {
          // Transient fetch failure: keep the last good snapshot.
          inFlight = false
        },
      )
    }

    // --- currently-edited highlight (filesystem.changed → 5s decay) --------
    const [edited, setEdited] = createSignal<string | undefined>(undefined)
    let editedTimer: ReturnType<typeof setTimeout> | undefined
    const stopFilesystem = ctx.data.on("filesystem.changed", (event) => {
      const file = event.data?.file
      if (!file) return
      setEdited(file)
      if (editedTimer !== undefined) clearTimeout(editedTimer)
      editedTimer = setTimeout(() => {
        editedTimer = undefined
        setEdited(undefined)
      }, EDIT_HIGHLIGHT_MS)
    })

    // --- open the built-in diff viewer -------------------------------------
    // The viewer route is named "diff" (verified in the 2.0.31 binary). Like
    // the host's own diff.open command, prefer the session panel; fall back to
    // a plugin route when no panel can open (e.g. home route).
    const openDiff = () => {
      if (ctx.ui.panel.open("diff")) return
      const route = ctx.ui.router.current()
      const sessionID = route.type === "session" ? route.sessionID : untrack(() => snapshot()).sessionID
      ctx.ui.router.navigate({ type: "plugin", name: "diff", data: { sessionID, returnRoute: route } })
    }

    // --- panel claim (rebuilt on snapshot / collapse / theme change) --------
    createEffect(() => {
      const snap = snapshot()
      const collapsed = store.collapsed // tracked: toggle rebuilds the claim
      const activeFile = edited() // tracked: highlight changes rebuild the claim
      // Track theme tokens: `ctx.theme` is a live getter over the host's theme
      // signal (verified: `get theme(){return themes.currentTokens()}`), so a
      // theme resolve/switch re-runs this effect and the claim is rebuilt with
      // the fresh palette instead of keeping the startup snapshot.
      void ctx.theme.text.base
      void ctx.theme.text.muted
      void ctx.theme.text.feedback.success.base
      void ctx.theme.text.feedback.error.base
      if (disposed) return
      stopPanel?.()
      // Anchored `after` the content boundary: sibling of the content slot
      // inside its container, i.e. below every content claim (OMO-Slim's
      // block included) and above the footer. `append` rendered above OMO
      // because claims order by plugin enable order, not by registration time.
      stopPanel = ctx.ui.slot({
        after: "sidebar.content",
        render: (input) => {
          const sessionID = input.sessionID
          if (sessionID !== snap.sessionID) {
            // Defer the signal write out of the host's render call.
            queueMicrotask(() => {
              if (disposed) return
              if (untrack(() => snapshot()).sessionID !== sessionID) {
                setSnapshot({ sessionID, rows: [], collapsed: untrack(() => snapshot()).collapsed })
              }
              if (!fetchedSessions.has(sessionID)) fetchAndRebuild(sessionID)
            })
          }
          const rows = sessionID === snap.sessionID ? snap.rows : []
          return renderPanel({ ctx, collapsed, rows, activeFile, onToggle: toggleCollapsed, onOpenDiff: openDiff })
        },
      })
      // Session revealed on a previous pass but never fetched (e.g. events
      // raced ahead of the first render).
      if (snap.sessionID !== "" && !fetchedSessions.has(snap.sessionID)) {
        fetchAndRebuild(snap.sessionID)
      }
    })

    let timer: ReturnType<typeof setTimeout> | undefined
    const scheduleRefresh = () => {
      if (timer !== undefined) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = undefined
        fetchAndRebuild(untrack(() => snapshot()).sessionID)
      }, REFRESH_DEBOUNCE_MS)
    }
    const stops = REFRESH_EVENTS.map((type) => ctx.data.on(type, scheduleRefresh))

    return () => {
      disposed = true
      stopCommands()
      stopPanel?.()
      for (const stop of stops) stop()
      stopFilesystem()
      if (timer !== undefined) clearTimeout(timer)
      if (editedTimer !== undefined) clearTimeout(editedTimer)
    }
  },
})