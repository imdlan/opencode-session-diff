/**
 * Plugin entry (TUI side). Loaded by the host through the package.json
 * "./tui" subpath export.
 *
 * Contract (docs §2.6, verified against @opencode/plugin 2.0.32):
 *   export default Plugin.define({ id, setup(ctx) => cleanup })
 *
 * Note: `Plugin` is a namespace export (`export * as Plugin`), so the callable
 * is `Plugin.define` — `Plugin({...})` from earlier doc drafts does not exist.
 */

import { Plugin } from "@opencode/plugin/tui"
import { ChangesPanel } from "./panel"

const STORAGE_KEY = "session-changes"

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

    const stopPanel = ctx.ui.slot({
      append: "sidebar.content",
      render: (input) => (
        <ChangesPanel ctx={ctx} store={store} sessionID={input.sessionID} />
      ),
    })

    return () => {
      stopCommands()
      stopPanel()
    }
  },
})
