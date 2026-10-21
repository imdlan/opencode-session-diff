# opencode-session-diff — Development Notes

OpenCode V2 TUI 侧边栏插件：显示当前 session 修改 / 新增 / 删除的文件，附 ± 行数统计。事件驱动，无后台轮询。

- 包名：`opencode-session-diff`；侧边栏板块名：`Changes`；插件 id：`session-changes`
- 平台：OpenCode ≥ 2.0.x（V2 TUI 插件 API）
- 许可：MIT

---

## 1. 范围

**目标**：回答"这个 session 到目前为止改了哪些文件"。

**非目标**：

- 文件内容 diff 查看（交由官方 `/diff` 查看器）
- 全仓库 git 状态（`git status` 的职责）
- 文件读取活动流（其他插件已覆盖）

## 2. 宿主契约（实现依据）

以下结论基于 OpenCode v2.0.31/2.0.32 的包类型与运行行为验证。

### 2.1 数据接口

```
GET /session/{id}/diff
SDK: client.session.diff({ sessionID })
→ readonly FileDiff.Info[]
```

```ts
type FileDiff.Info = {
  file: string
  patch: string
  additions: number
  deletions: number
  status: "added" | "deleted" | "modified"   // 权威分类
}
```

`status` 缺失时（个别版本/边界数据）降级为计数判断：`deletions === 0 → added`，`additions === 0 → deleted`，否则 `modified`；`additions === 0 && deletions === 0` 视为二进制变更。

### 2.2 刷新策略

V2 事件清单中没有 diff 推送事件，采用"事件触发 + 防抖重取"：

```ts
ctx.data.on("session.execution.succeeded", schedule)   // 回合成功（主）
ctx.data.on("session.idle", schedule)                  // 回合结束（兜底）
ctx.data.on("session.revert.staged", schedule)         // /undo 回退
ctx.data.on("session.revert.cleared", schedule)
ctx.data.on("session.revert.committed", schedule)
// schedule: 500ms 防抖后重新拉取 session.diff
```

### 2.3 渲染约束（关键）

宿主只绘制 `slot.render()` **同步返回**的 JSX 快照，挂载后的 Solid 响应式更新不会上屏。因此：

- `panel.tsx` 是纯渲染器，状态集中在 `tui.tsx`
- 状态变化时**重建 claim**：注销旧 `ctx.ui.slot` → 重新注册，宿主会重新调用 `render()`

行内样式与布局的可用形态（均已验证）：

| 需求 | 用法 |
|---|---|
| 行容器 | `<text>`，多行合并为单个 `<text>`，行间 `"\n"`（逐行渲染器会产生额外行距） |
| 行内着色 | `<span style={{ fg }}>`；TextNode 运行时只识别 `style` / `href`，直接传 `fg` 会被忽略 |
| 防换行 | `wrapMode="none"` |
| 鼠标事件 | 文本渲染器支持 `onMouseUp` |

### 2.4 布局与挂载点

- 侧边栏宽度固定 42 列；内容区可用宽度 **37 列**（`42 − paddingLeft 2 − paddingRight 2 − 内容列 paddingRight 1`）
- 板块位置：`after: "sidebar.content"` —— 位于其余内容 claim 之下、footer 之上；与插件启用顺序无关
- slot 输入：`{ sessionID: string }`
- 空数据时整节不渲染

### 2.5 插件入口与构建

```tsx
import { Plugin } from "@opencode/plugin/tui"

export default Plugin.define({
  id: "session-changes",
  setup(ctx) {
    const stop = ctx.ui.slot({ after: "sidebar.content", render: (input) => ... })
    return () => stop()
  },
})
```

- `Plugin` 是 namespace 导出，使用 `Plugin.define`
- `package.json` 必须同时提供 `"."`（合法 server stub）与 `"./tui"` 入口；空 `export {}` 会导致整包加载失败
- 构建时 external 宿主提供的运行时：`@opencode/*`、`@opentui/*`、`solid-js`；插件旁不得携带这些依赖的副本（会触发双运行时）
- `jsxImportSource` 为 `@opentui/solid`

### 2.6 主题与交互

- `ctx.theme` 是活 getter（读取宿主主题 memo）：颜色必须在渲染时读取，并在重建 claim 的 effect 内显式引用主题字段，主题切换才能生效
- 折叠态：`ctx.storage.store("session-changes", { initial: { collapsed: false } })`
- 打开 diff 查看器：`ctx.ui.panel.open("diff")`（分栏，关闭由宿主处理）
- 查看器初始 source 由 `~/.config/opencode/cli.json` 的 `diffs.source` 决定；`turn` 即 `session.diff` 数据源。panel API 无法按调用传 source

## 3. 架构

```
TUI 进程（插件）
  slot(after: sidebar.content)
    └─ renderPanel({ rows, collapsed, activeFile })
          ▲ 状态变化 → 重建 claim
          │
  tui.tsx
    ├─ createSignal<Snapshot>           ← session.diff 拉取结果
    ├─ events: execution/idle/revert    → 防抖重取
    ├─ events: tool.input.ended/success → 最近编辑高亮（5s）
    └─ storage.store("session-changes") → 折叠态

OpenCode server
  session.diff 端点（快照记账）
```

设计要点：

- 单一数据流：分类后的行数组是唯一渲染状态
- 只读：不写文件、不执行命令、无外部网络请求
- 会话切换：slot 输入变化时重新拉取

## 4. UI 规格

```
▼ Changes (4)                              +154 −18
• src/agent/loop.ts                        +28 −9
• src/tools/fs.ts                          +110 −3
• test/loop.test.ts                        +13
• src/legacy/runner.ts                     −6
```

- 标题与文件行无左侧缩进；标题总数与文件计数右对齐到同一右缘
- 图标统一为 `•`，类别以颜色区分：修改/新增/删除/二进制
- 排序：modified > added > deleted，同组按 additions 降序
- 默认显示 8 行，超出显示 `… +M more`
- 点击标题折叠/展开；点击文件列表打开官方 diff 查看器
- 最近编辑的文件整条路径高亮 5 秒（`session.tool.input.ended` 为主触发，`session.tool.success` 与 `filesystem.changed` 兜底）

## 5. 项目结构

```
src/
├── index.ts      # server stub（宿主加载要求）
├── tui.tsx       # 插件入口：slot 注册、事件、claim 重建
├── panel.tsx     # 纯渲染器
├── classify.ts   # FileDiff → 行分类（纯函数）
└── format.ts     # 路径截断、± 计数、右对齐（纯函数）
test/             # bun:test（34 例）
docs/             # 本文档
```

## 6. 构建与依赖

```sh
bun install
bun run build      # dist/index.js、dist/tui.js
bun test
bun run typecheck
```

- devDependencies：`@opencode/plugin`、`@opencode/theme`、`@opentui/solid`、`solid-js`、`typescript`、`@types/bun`
- `prepack` 自动执行构建，npm 发布产物只含 `dist/`、`src/`、README、LICENSE

## 7. 测试

单元测试覆盖纯函数：分类与降级、排序、截断、宽度计算、右对齐、行数上限。

手工验证场景：空会话隐藏、增/改/删计数、二进制文件、超长路径、`/undo` 回退、subagent 改动、会话切换、服务端重连。

## 8. 发布（2026-10-21 实测可行的流程）

账号 `imdlan` 开启了 2FA；`~/.npmrc` 为 granular token（无 whoami 权限，`npm whoami` 401 属预期，不是阻碍）。发布必须走浏览器授权：**非 TTY 下 npm 遇 2FA 直接 EOTP 退出；在 PTY 中会打印授权链接并等待浏览器批准，无需 OTP 动态码。**

```sh
# 1. 前置检查（全绿再发）
bun run typecheck && bun run build && bun test

# 2. 升版本（自动 commit + tag）并推送
npm version patch -m "chore: 发布 v%s"   # 0.x 期间 minor 为功能、patch 为修复
git push --follow-tags origin main

# 3. 带 PTY 发布（后台运行，prepack 会自动构建）
script -q /tmp/npm-publish-tty.log npm publish --access public

# 4. 从日志提取授权链接，交给用户在浏览器打开并批准（登录 imdlan）
LC_ALL=C sed 's/\x1b\[[0-9;?]*[a-zA-Z]//g' /tmp/npm-publish-tty.log | tr '\r' '\n' | grep "npmjs.com/auth"

# 5. 批准后发布自动完成（输出 + opencode-session-diff@X.Y.Z），验证：
npm view opencode-session-diff version   # registry 与 npm 网页有分钟级延迟，重试几次
```

旧方案（`npm stage publish` + Staged Packages 页面批准）不再使用。

## 9. 已知限制

- 官方 diff 查看器不支持按文件聚焦：点击列表打开整个 session diff，使用 `n` / `p` 切换文件
- 仅在 V2 TUI 提供；包内需保留 server stub 以满足宿主加载器
- 侧边栏是否显示由宿主决定（`session.sidebar: "auto"` 且空间足够）

## 10. 参考

- `@opencode/plugin` 类型：`dist/tui/context.d.ts`（slot 表、Context、Keymap）
- `opencode-graph-live` 源码（npm tarball 内含 `src/tui.tsx`）：V2 TUI 插件注册与构建方式
