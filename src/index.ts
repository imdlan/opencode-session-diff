/**
 * Server-side entry (package.json "." subpath).
 *
 * V2 host loader prefers the server entrypoint when probing exports
 * (PluginModule.load: `h = c.server`; a missing/invalid one fails the whole
 * package, TUI side included). TUI-only packages are not loadable — the
 * verified pattern (opencode-graph-live 0.1.2 on v2.0.31) ships a no-op
 * server stub here and the real UI via "./tui".
 */

import { Plugin } from "@opencode/plugin"

export default Plugin.define({
  id: "session-changes",
  async setup(): Promise<void> {},
})
