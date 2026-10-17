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

### 2.2 事件推送（核心刷新机制）

```ts
api.event.on("session.diff", (e) => {
  // e.properties: { sessionID: string, diff: Array<FileDiff> }
  // 服务端在 diff 变化时推全量数组 —— 无需重新请求、无需轮询
})
```

备选事件：`file.edited`（单文件粒度，仅作"editing now"标记用）、`session.idle`（兜底）。

### 2.3 免费的会话级汇总

```ts
Session.summary?: { additions: number; deletions: number; files: number; diffs?: Array<FileDiff> }
```

### 2.4 增/删/改判定规则（因 before/after 未填充，只能用计数启发式）

| 条件 | 判定 | 展示 |
|---|---|---|
| `deletions === 0 && additions > 0` | 新增 | `＋` 绿 |
| `additions === 0 && deletions > 0` | 删除 | `－` 红（**纯删除样本未抽到，假设 `+0 −N`，M1 里必须人造场景验证**） |
| `additions > 0 && deletions > 0` | 修改 | `✎` 默认色 + 绿增红删 |
| `additions === 0 && deletions === 0` | 二进制/不可统计 | `●` muted，仅列文件名 |

### 2.5 侧边栏挂载点（slot）

- 宿主 slot 表（`@opencode-ai/plugin/dist/tui.d.ts` 的 `TuiHostSlotMap`）：
  `sidebar_content: { session_id }`、`sidebar_footer: { session_id }`、`sidebar_title: {...}`
- 注册方式（oh-my-opencode-slim 实证可用）：
  ```ts
  api.ui.slot({ append: "sidebar.content", render: (input) => <Panel sessionId={input.session_id}/> })
  ```
- 侧边栏固定宽 **42 列**；非 git 目录 / subagent 子会话（`session.parentID != null`）宿主不显示侧边栏，插件无需处理。
- 空态策略与官方 `opencode.sidebar.context` 一致：无数据时整节隐藏。

### 2.6 TUI 插件契约（双导出，照抄 OMO 模式）

```jsonc
// package.json
{
  "exports": { ".": "./dist/index.js", "./tui": "./dist/tui.js" }
  // v1 宿主另需 "tui" 字段 → 实现时以 OMO graph-live 双样本对照
}
```

- 渲染栈：`@opentui/solid`（JSX）+ solid-js 响应式，构建时 **external**
- 插件形态：`export const tui: TuiPlugin = async (api, options, meta) => {...}`
- `api.client`：完整 `OpencodeClient`；`api.event`：事件总线；`api.theme`：主题色

### 2.7 官方侧边栏现状（背景）

V2.0.0–2.0.32 全系侧边栏仅 3 个内置注册项：`opencode.sidebar.context`（token/花费）、`opencode.sidebar.mcp`、`opencode.sidebar.footer`（getting-started + 目录:分支）。本插件将成为第 4 方内容提供者。V1 桌面端的 "Files Changed (N)" 审查面板即本项目的体验原型。

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
  ✎ PicXure/PicXureApp.swift        +28 −9
  ✎ Views/AnnotationOverlay.swift   +110 −3
  ＋ i18n/locales/en.json            +13
  － legacy/main.swift               −6
```

- 标题行：`▼ Changes (N)` + 汇总 `+A −D`（绿/红，取 `theme.text.feedback.*`）
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
                --external @opencode-ai/plugin --external '@opencode-ai/plugin/*' \
                --external @opencode/plugin --external '@opencode/plugin/*' \
                --external '@opentui/*' --external solid-js",
    "test": "bun test",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@opencode-ai/plugin": "latest",   // ⚠️ 与 @opencode/plugin 二选一，M1 确认官方渠道
    "@opentui/solid": "latest",
    "solid-js": "latest",
    "typescript": "^5"
  }
}
```

注意（来自竞品源码审计）：
- `opencode-graph-live` 声明依赖 `@opencode/plugin`
- `oh-my-opencode-slim` 声明依赖 `@opencode-ai/plugin`
- 两个包名并存，**M1 第一件事：确认哪个是官方发布渠道**（npm view 两者的 maintainer / repository），externals 两者都写不影响。

## 7. 里程碑

| 里程碑 | 内容 | 完成标准 |
|---|---|---|
| **M0 骨架** | 目录 / package.json / tsconfig / 构建跑通 | `bun run build` 产出 dist，`opencode plugin add ./` 可加载（空面板） |
| **M1 数据层** | session.diff 拉取 + session.diff 事件订阅 + classify 纯函数 + 单测 | 本地起服务端改文件，signal 数组正确更新；纯删除场景验证 `+0 −N` 判定 |
| **M2 面板渲染** | panel.tsx 完整 UI + 折叠 kv + 点击跳 diff.open | 侧边栏目视验收（对照第 4 节规格） |
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
