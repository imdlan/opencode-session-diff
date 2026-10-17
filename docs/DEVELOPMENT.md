# opencode-session-changes 开发文档

> OpenCode V2 TUI 侧边栏插件：实时显示当前 session 修改 / 新增 / 删除的文件清单（含 ±行数统计），事件驱动，零轮询。

- 包名：`opencode-session-changes`
- 目标平台：OpenCode ≥ 2.0.x（TUI 插件体系）
- 许可：MIT
- 状态：开发中（本文档为唯一实现依据，所有 API 结论均已实证）

---

## 1. 项目定位

在 TUI 侧边栏（`Ctrl+X B`）中增加一个 **"Changes"** 区块，回答一个问题：

> 这个 session 到目前为止，改了什么、新增了什么、删除了什么？

数据源为服务端 session 快照记账（`session.diff`），非客户端事件推断。

### 1.1 与竞品的差异

| 竞品 | 数据语义 | 本项目差异 |
|---|---|---|
| `opencode-graph-live` | 实时活动流（正在读/改哪些文件、touch 次数） | 无增删改分类、无 ±统计、重启丢失；本项目为持久变更汇总 |
| `opencode-skill-audit` | skill 调用审计 + 文件时间线 | 面向合规审计，非变更汇总 |
| `opencode-turn-stats` / `opencode-tui-usage` 等 | token/用量 | 完全不同赛道 |

**市场结论（2026-10 实测 npm）：session 级增删改侧边栏面板为空白。**

### 1.2 非目标（v1 不做）

- 文件内容 diff 查看（已有官方 `/diff` 查看器，点击跳转即可）
- 跨 session / 全仓库 git 状态（`git status` 类工具的职责）
- read 活动流（graph-live 已覆盖）

---

## 2. 已验证的技术事实（实现依据，勿凭记忆改）

以下全部经本机 OpenCode **v2.0.31** 二进制反查 + 本地 SDK 类型（`@opencode-ai/sdk` dist/gen/types.gen.d.ts）+ 真实 API 抽样（200 session，4 个含 diff）验证。

### 2.1 数据 API

```
GET /session/{id}/diff          （SDK: client.session.diff({ path: { id } })）
query?: { directory?: string, messageID?: string }   # messageID 可做"到此消息为止"过滤，v1 不用
200:  Array<FileDiff>
```

```ts
type FileDiff = {
  file: string        // 相对路径，如 "PicXure/Views/AnnotationOverlay.swift"
  before: string      // ⚠️ SDK 有声明，但 2.0.31 服务端不填充（全 undefined）
  after: string       // ⚠️ 同上
  additions: number
  deletions: number
}
```

### 2.2 刷新机制（V2 实证修正）

> ⚠️ V1 SDK 的 `EventSessionDiff` 全量推送事件在 **V2 @opencode/client 事件清单中不存在**（已核对完整事件 union）。刷新采用"事件触发 + 防抖重取"：

```ts
// 拉取（Promise 客户端）：
await ctx.client.session.diff({ sessionID })   // → readonly FileDiff.Info[]

// 刷新触发点（ctx.data.on）：
"session.execution.succeeded"   // 回合成功（主刷新点）
"session.idle"                  // 回合结束（兜底）
"session.revert.staged" | "session.revert.cleared" | "session.revert.committed"   // undo 后回退
```

防抖 500ms 合并连发；重取为一次轻量 GET，回合粒度足够。

### 2.3 免费的会话级汇总

```ts
Session.summary?: { additions: number; deletions: number; files: number; diffs?: Array<FileDiff> }
```

### 2.4 增/删/改判定规则（V2 权威字段）

V2 `@opencode/schema` 的 `FileDiff.Info` **直接携带 status 枚举**（已核对 schema 源码）：

```ts
type FileDiff.Info = {
  file: string
  patch: string          // unified diff 文本（侧边栏不用，仅备用）
  additions: number
  deletions: number
  status: "added" | "deleted" | "modified"   // ← 权威分类，无需推断
}
```

| status | 图标 | 着色 |
|---|---|---|
| `modified` | `•` | 默认色（`text.base`）+ `+a` 绿 `−d` 红 |
| `added` | `•` | 绿（`feedback.success.base`） |
| `deleted` | `•` | 红（`feedback.error.base`） |
| 二进制（additions=0 && deletions=0） | `•` | muted |

> 统一小圆点 `•`，类别只靠颜色区分（用户要求的扁平观感）；行首无缩进，左缘对齐标题。

> 注：裸 HTTP `/api/session/:id/diff` 实测响应不含 `before/after` 填充值，但 V2 client schema 承诺 `status`；实现时以实际返回为准，若 `status` 缺失再降级为 ±计数启发式（`del===0 → added`，`add===0 → deleted`）。

### 2.5 侧边栏挂载点（slot）

- 宿主 slot 表（`@opencode-ai/plugin/dist/tui.d.ts` 的 `TuiHostSlotMap`）：
  `sidebar_content: { session_id }`、`sidebar_footer: { session_id }`、`sidebar_title: {...}`
- 注册方式（oh-my-opencode-slim 实证可用）：
  ```ts
  api.ui.slot({ append: "sidebar.content", render: (input) => <Panel sessionId={input.session_id}/> })
  ```
- 侧边栏固定宽 **42 列**；非 git 目录 / subagent 子会话（`session.parentID != null`）宿主不显示侧边栏，插件无需处理。
- 空态策略与官方 `opencode.sidebar.context` 一致：无数据时整节隐藏。

### 2.6 TUI 插件契约（V2 官方 `@opencode/plugin@2.0.32` 实证）

**依赖包裁定**：`@opencode/plugin`（2.0.x，thdxr/sst 维护，与 CLI 同版本线）是 **V2 官方包**；`@opencode-ai/plugin`（1.19.x）是 V1 包（oh-my-opencode-slim 依赖它）。本项目用 `@opencode/plugin`。

```tsx
import { Plugin, usePlugin } from "@opencode/plugin/tui"

// ⚠️ Plugin 是 namespace 导出（export * as Plugin），不可直接调用；
// 正确形态为 Plugin.define（已实证 @opencode/plugin 2.0.32）：
export default Plugin.define({
  id: "session-changes",
  setup(ctx) {                                    // ctx: Plugin.Context
    const stop = ctx.ui.slot({
      append: "sidebar.content",                  // slot: "sidebar.content" | "sidebar.footer" | ...
      render: (input: { sessionID: string }) => <ChangesPanel ctx={ctx} sessionId={input.sessionID} />,
    })
    return () => stop()                           // Cleanup
  },
})
```

实现期实证补充（M2，均已按此落地）：
- `jsxImportSource` 为 `@opentui/solid`（npm 无 `@opencode/solid` 包）
- `ctx.theme` 的颜色是 `@opentui/core` 的 `RGBA` 对象（非字符串）；`theme.text.feedback.success/error.base`、`text.base`、`text.muted` 路径有效
- peer 依赖需补 `@opencode/theme@2.0.32`（ResolvedTheme 类型解析）与 `@types/bun`
- 行内多色文本：`<text>` 行内嵌 `<span fg>`（局部 0.6.6 类型未声明 span 的 `fg`，需 cast；宿主运行时支持，已目视验证）。⚠️ M2 草稿中的 `StyledText + content` 与裸 `<span>` 均不可用，见 §2.8

- `Plugin.Context` 关键字段（dist/tui/context.d.ts 已核对）：
  - `ctx.client: OpenCodeClient`（promise 客户端，`client.session.diff({sessionID})`）
  - `ctx.data.on(type, handler)` 事件订阅（事件 union 见 @opencode/client promise/generated/types.d.ts）
  - `ctx.theme: ResolvedTheme` / `ctx.themeMode`（`theme.text.feedback.*` 取色）
  - `ctx.storage.store<T>(key, {initial}) → [store, mutate]`（持久化折叠态，跨 TUI 实例同步）
  - `ctx.keymap`（Ctrl+P 命令注册，M3 用）
  - `ctx.ui.slot(claim)` / `ctx.ui.router` / `ctx.ui.panel` / `ctx.ui.dialog`
- 渲染：`@opentui/solid` JSX + `solid-js`（For/Show/createSignal/createMemo/onCleanup）
- 宿主发现：package.json `exports["./tui"]` 子路径（exports-map 探测，graph-live 同款）
- 参考实现：opencode-graph-live 源码（npm tarball 内 src/tui.tsx）

### 2.7 官方侧边栏现状（背景）

V2.0.0–2.0.32 全系侧边栏仅 3 个内置注册项：`opencode.sidebar.context`（token/花费）、`opencode.sidebar.mcp`、`opencode.sidebar.footer`（getting-started + 目录:分支）。本插件将成为第 4 方内容提供者。V1 桌面端的 "Files Changed (N)" 审查面板即本项目的体验原型。

### 2.8 E2E 验收实证（v2.0.31 真机，2026-10-17）

**M2 侧边栏验收已通过**：恢复含改动会话后，侧边栏顶部稳定显示
`▼ Changes (1)  +60 −28` / `  ✎ docs/DEVELOPMENT.md    +60 −28`（30 秒+ 不消失、无错误框）。以下为本轮推翻草稿假设的实测结论，实现必须按此：

1. **宿主渲染契约（最关键）**：宿主只绘制 `slot.render()` **同步返回**的 JSX 快照。挂载后的 Solid 响应式更新（延迟 `Show` 插入、signal 文本更新、`For` 增长）**一律不上屏**。因此 `panel.tsx` 是纯渲染器，状态在 `tui.tsx`；数据变化时**重建 claim**（stop 旧 `ctx.ui.slot` → 重新注册），宿主重调 `render()` 得到新快照。
2. **可用行内元素**：行 = `<text>`；色段 = `<text>` 内嵌 `<span style={{ fg }}>`（⚠️ 2026-10-17 修正：TextNode 运行时只识别 `style`/`href` 两个属性，裸 `fg` 会被 `setProperty` **静默丢弃**——此前草稿的 cast 传 `fg` 导致浅色模式下文字全白；`style` 需按本地类型 cast）。**禁用**：`<text content={StyledText}>`（不绘制）、裸 `<span>` 无 `<text>` 父级（Orphan text error 错误框）、`<box>` 根节点（挂载后数秒停止绘制）。
3. **布局宽度**：宿主侧栏布局精确推导：`width 42 − paddingLeft 2 − paddingRight 2 = 38`，内容列再 `paddingRight 1` → **可用 37 列**（`CONTENT_WIDTH = SIDEBAR_WIDTH - 5`；旧值 34 是缩进草稿期的保守值，会造成右侧计数与边框间的可见空隙）。两个文本元素均设 `wrapMode="none"` 防意外换行。**位置**：`after: "sidebar.content"`（内容区边界之后的同级节点 = 全部内容 claim（含 OMO-Slim 板块）下方、footer 之上）。实测排序：`append` 渲染在 OMO 上方（claim 按插件 enable 顺序，非注册时间），`prepend` 顶部，`after: "sidebar.footer"` 落到 footer 之下。
4. **插件包入口**：`exports["."]` 必须是**合法 server stub**（`Plugin.define({ id, async setup(){} })`，graph-live 模式）；空 `export {}` 会使整包（含 TUI 侧）加载失败。
5. **本地路径不是合法插件来源**：`plugins` 条目必须是通过校验的 npm/git 说明符，绝对路径被**静默过滤**（`opencode plugin list` 不可见）；`opencode plugin add` 同样拒绝本地路径。本地开发走"安装器缓存植入"：
   ```
   ~/.cache/opencode/npm/<target>/<ts>/package.json        # {"dependencies": {"<pkg>": "0.1.0"}}
   ~/.cache/opencode/npm/<target>/<ts>/node_modules/<pkg>/ # 仅 package.json + dist（不含 node_modules！）
   ```
   首轮 reconcile 以 `install=false` 的 resolve 直接命中缓存、零网络。
6. **⚠️ 包名冲突（M4 阻塞）**：npm 上 `opencode-session-changes@1.0.0` 已被第三方（kdbsoft，`github.com/kdbsoft/opencode-session-changes`）占用。把裸名写入 `plugins` 会让宿主**下载并加载该第三方代码**（其 tui 入口因缺 react 加载失败，服务端入口却成功）。发布前必须改名（如 `opencode-session-changes-tui` 或 scoped 包），并更新文档/README。
7. **模块解析**：宿主对 `@opencode/*`、`@opentui/*`、`solid-js` 做运行期映射（磁盘优先，找不到时回落宿主内置实例）。若插件旁存在 node_modules 副本会被优先解析 → 双运行时 → 元素成为宿主无法协调的"外来对象"（短时绘制后被丢弃）。发布物与本地 staging 均不得携带这些运行时依赖（保持 external + devDependency）。
8. **主题色响应式**：`ctx.theme` 是活 getter（`get theme(){return themes.currentTokens()}`，currentTokens 为 memo，可被 Solid 追踪）。palette 必须在 `render()` 调用时读取（不得在 setup 时快照），并在重建 claim 的 `createEffect` 内显式读取主题令牌字段——主题解析/切换时该 effect 重跑、claim 以新调色板重建。标题行 `onMouseUp` 已接点击折叠（文本渲染器支持鼠标事件）。
9. **行距**：每行一个 `<text>` 渲染器时，宿主容器在渲染器之间附加间距（行距接近双倍）。解决：所有文件行合并进**单个多行 `<text>`**，行间以 `"\n"` 分隔；标题仍单独一个 `<text>`（承载点击事件）。


---

## 3. 架构设计

```
┌─ TUI 进程（插件） ─────────────────────────────┐
│                                                 │
│  slot(sidebar.content)                          │
│    └─ <ChangesPanel sessionId>                  │
│         │  createSignal<Array<FileDiff>>        │
│         ├─ mount: client.session.diff({id})     │
│         ├─ event "session.diff" → setDiff(全量) │
│         ├─ event "file.edited" → live 标记      │
│         └─ render: 分类 → 排序 → 截断           │
│                                                 │
│  持久化（折叠态）: api.kv / storage.store       │
└─────────────────────────────────────────────────┘
          │ HTTP / SSE
┌─ OpenCode server（不动） ───────────────────────┘
   snapshot 记账：session.diff 端点 + EventSessionDiff 推送
```

要点：

1. **单一数据流**：`Array<FileDiff>` 为唯一状态，REST 初始化 + 事件全量覆盖，无增量合并逻辑。
2. **会话切换**：slot render 的 `input.session_id` 变化时重新 mount/重取（Solid 组件 key 化）。
3. **无副作用**：只读，不写文件、不 exec、无网络外呼（审计友好）。

## 4. UI 规格（42 列宽约束）

```
▼ Changes (4)  +154 −18
• PicXure/PicXureApp.swift        +28 −9
• Views/AnnotationOverlay.swift   +110 −3
• i18n/locales/en.json            +13
• legacy/main.swift               −6
```

- 标题行与文件行均**无左侧缩进**，左缘对齐（板块外围无额外水平外边距）

- 标题行：`▼ Changes (N)` + 汇总 `+A −D`（绿/红，取 `theme.text.feedback.*`）；**点击标题行折叠/展开**（`onMouseUp`，折叠态同 `Ctrl+P → Changes: toggle collapse`）
- 行：图标 + 路径（basename 高亮 `theme.text.base`，目录前缀 muted，超长 truncate 优先砍目录段）+ 右对齐 `+a −d`
- 排序：修改 > 新增 > 删除，同组按 additions 降序
- 上限：默认显示前 N=8 行 + `… +M more`；`Ctrl+P` 命令 `Changes: cycle limit`（8/16/all）
- 折叠态 `▶ Changes (4) +154 −18` 记忆到 kv
- 点击行 → `api.keymap.dispatchCommand("diff.open")` 打开官方 diff 查看器（route 名 M2 验证）
- "editing now"：最近 2s 内 `file.edited` 命中的文件前加 `●` spinner 字符（可选，M3）
- 空态（diff 空数组）：整节不渲染

## 5. 项目结构

```
opencode-session-changes/
├── package.json
├── tsconfig.json
├── bunfig.toml                # 如需
├── .gitignore                 # node_modules/ dist/
├── README.md                  # 上架门面：GIF + 一行安装
├── LICENSE                    # MIT
├── src/
│   ├── index.ts               # server 侧导出（保持无 tui 键，仅防宿主误加载）
│   ├── tui.tsx                # 插件入口：注册 slot + 事件订阅
│   ├── panel.tsx              # <ChangesPanel> 渲染组件
│   ├── classify.ts            # FileDiff → {kind: mod|add|del|bin, ...} 纯函数
│   └── format.ts              # 路径截断 / ±计数格式化（纯函数，单测重点）
├── test/
│   └── classify.test.ts       # bun:test
└── docs/
    └── DEVELOPMENT.md         # 本文档
```

## 6. 构建与依赖

```jsonc
// package.json 关键字段
{
  "name": "opencode-session-changes",
  "version": "0.1.0",
  "type": "module",
  "exports": { ".": "./dist/index.js", "./tui": "./dist/tui.js" },
  "scripts": {
    "build": "bun build ./src/index.ts --outdir ./dist --target bun && \
              bun build ./src/tui.tsx --outdir ./dist --target bun \
                --external @opencode/plugin --external '@opencode/plugin/*' \
                --external @opencode/client --external '@opencode/*' \
                --external '@opentui/*' --external solid-js",
    "test": "bun test",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@opencode/plugin": "2.0.32",     // V2 官方包（已裁定）
    "@opentui/solid": "latest",
    "solid-js": "latest",
    "typescript": "^5"
  }
}
```

构建 externals 与 graph-live 一致（宿主运行时提供全部依赖）。

## 7. 里程碑

| 里程碑 | 内容 | 完成标准 |
|---|---|---|
| **M0 骨架** | 目录 / package.json / tsconfig / 构建跑通 | `bun run build` 产出 dist，`opencode plugin add ./` 可加载（空面板） |
| **M1 数据层** | session.diff 拉取 + session.diff 事件订阅 + classify 纯函数 + 单测 | 本地起服务端改文件，signal 数组正确更新；纯删除场景验证 `+0 −N` 判定 |
| **M2 面板渲染** | panel.tsx 完整 UI + 折叠 kv + 点击跳 diff.open | 侧边栏目视验收（对照第 4 节规格）— **已通过（2026-10-17 E2E，见 §2.8）**；diff.open 跳转延至 M3 |

> 注：M2 面板因宿主"仅绘制 render() 同步快照"的约束，实现为纯渲染器 + 数据变化重建 claim（§2.8）；M1 的事件驱动防抖重取语义不变。
| **M3 打磨** | editing-now 标记 / limit 循环 / truncate 策略 / 非 git 目录静默 | 边界场景全绿（第 8 节矩阵） |
| **M4 发布** | README + GIF + LICENSE + npm publish（0.1.0） | `opencode plugin add opencode-session-changes@latest` 干净环境可用 |

## 8. 测试矩阵（M3 验收用）

| # | 场景 | 期望 |
|---|---|---|
| 1 | 新会话无任何编辑 | Changes 节隐藏 |
| 2 | 编辑文本文件 | `✎` + 正确 ±数 |
| 3 | 新建文本文件 | `＋`，del=0 |
| 4 | **删除文件（git rm / 工具删除）** | `－`，验证是否 `+0 −N`（若否，回到 2.4 重定规则） |
| 5 | 二进制（png） | `●` 0/0，不崩溃 |
| 6 | 超长路径（>42 列） | truncate 砍目录段，basename 完整 |
| 7 | >8 个文件 | 截断 + `… +M more` |
| 8 | `/undo` revert 后 | 列表与 ±数回退 |
| 9 | subagent 修改的文件 | 计入父会话面板 |
| 10 | 非 git 目录会话 | 节隐藏，无报错 |
| 11 | 会话切换（tab 切换） | 面板数据随 session_id 切换 |
| 12 | 大 diff（50+ 文件） | 渲染不卡顿（事件全量替换，无增量计算） |
| 13 | 服务端重启 | 重连后 mount 重取恢复 |

## 9. 发布清单

- [ ] `npm whoami` 确认账号；`npm publish`（首次不带 tag）
- [ ] README：一句话定位 / GIF（vt 录制，asciinema 或 vhs） / 安装一行 / 快捷键表 / FAQ（为什么不含 read？为什么和 git status 数字可能不同——session 快照 vs 工作区）
- [ ] repository 字段指 GitHub 仓库；license MIT
- [ ] 版本策略：0.x 期 minor 为功能、patch 为修复；1.0 待 API 稳定观察一个 minor 周期
- [ ] keywords：`opencode`、`opencode-plugin`、`tui`、`sidebar`、`diff`、`session`

## 10. 风险与开放问题

| 风险 | 影响 | 缓解 |
|---|---|---|
| `session.diff` 端点行为在后续版本变化（如开始填充 before/after） | 判定规则需升级 | classify.ts 纯函数隔离，规则单点维护；before/after 可用时优先用 |
| `@opencode/plugin` vs `@opencode-ai/plugin` 包名分叉 | 构建失败 / 运行时找不到宿主 API | externals 双写 + M1 确认 |
| diff.open 跳转的 route/命令名未定 | 点击行为不可用 | M2 从二进制核实；不可用则降级为仅展示 |
| EventSessionDiff 在大 diff 时全量推送频率 | 渲染压力 | Solid 细粒度响应 + 50ms 节流 setDiff |
| 宿主 slot 表更名（sidebar_content ↔ sidebar.content） | 面板消失 | 双注册尝试 + 宿主版本探测 |

---

## 附录 A：关键证据索引（复现方法）

```sh
# 侧边栏内置注册项（任意版本）
strings -n 6 "$(which opencode)" | perl -ne 'while (/(id:"opencode\.sidebar\.[a-z_.]+")/g){print "$1\n"}' | sort -u

# SDK 类型
ls ~/.config/opencode/node_modules/oh-my-opencode-slim/node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts

# 实测 session.diff
opencode api get "/api/session/<id>/diff"

# 事件类型清单
grep -n "EventSessionDiff\|FileDiff" <sdk>/dist/gen/types.gen.d.ts
```

## 附录 B：参考实现

- `oh-my-opencode-slim` `dist/tui.js:12792` — `ctx.ui.slot({append:"sidebar.content", render})` 注册范式
- `opencode-graph-live` `src/tui.tsx`（npm tarball 含源码）— 构建 scripts 与 externals 范式；其 UI 为反面教材（用户实测"很差"）
