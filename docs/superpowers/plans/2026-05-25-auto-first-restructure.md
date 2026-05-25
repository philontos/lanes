# Auto 优先重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 auto 模式（SDK+Docker）提升为唯一一等顶层入口，移除 manual 模式安装路径，并给 orchestrator 加上实时流式日志。

**Architecture:** 根目录加两个瘦转发脚本（`./setup.sh`、`./run.sh`）exec 进 `sdk/docker/` 的真身；删 `install.sh`/`uninstall.sh`；新增纯函数 `sdk/src/streamLog.ts` 把 SDK 消息流逐条格式化成类 CLI 的行，在 `orchestrator.ts` 的消息循环里实时打印；重写 README。

**Tech Stack:** Bash, TypeScript (ESM, `tsx`), vitest, `@anthropic-ai/claude-agent-sdk`, Docker。

参考设计：`docs/superpowers/specs/2026-05-25-auto-first-restructure-design.md`

---

### Task 1: 流式日志格式化器 `streamLog.ts`（TDD）

**Files:**
- Create: `sdk/src/streamLog.ts`
- Test: `sdk/test/streamLog.test.ts`

签名（对 spec `string|null` 的细化）：`formatMessage(m: any): string[]` —— 返回 0..N 行，空数组表示跳过。一个 assistant 消息可能同时含 text 与 tool_use block，故返回数组。`result` 类型返回 `[]`（由 `run.ts` 收尾，避免重复）。

- [ ] **Step 1: 写失败测试**

Create `sdk/test/streamLog.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { formatMessage } from "../src/streamLog.js";

describe("formatMessage", () => {
  it("renders assistant text blocks as-is", () => {
    const m = { type: "assistant", message: { content: [{ type: "text", text: "正在写 spec" }] } };
    expect(formatMessage(m)).toEqual(["正在写 spec"]);
  });

  it("renders a tool_use block as an arrow line with truncated json args", () => {
    const m = { type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "/x/y.ts" } }] } };
    expect(formatMessage(m)).toEqual([`→ Read({"file_path":"/x/y.ts"})`]);
  });

  it("emits one line per block when text and tool_use coexist", () => {
    const m = { type: "assistant", message: { content: [
      { type: "text", text: "先读文件" },
      { type: "tool_use", name: "Glob", input: { pattern: "**/*.ts" } },
    ] } };
    expect(formatMessage(m)).toEqual(["先读文件", `→ Glob({"pattern":"**/*.ts"})`]);
  });

  it("renders a string tool_result truncated to one line", () => {
    const long = "a".repeat(250);
    const m = { type: "user", message: { content: [{ type: "tool_result", content: long }] } };
    const out = formatMessage(m);
    expect(out).toHaveLength(1);
    expect(out[0].startsWith("  ⤷ ")).toBe(true);
    expect(out[0].length).toBeLessThanOrEqual(4 + 200 + 1); // prefix + 200 chars + ellipsis
    expect(out[0].endsWith("…")).toBe(true);
  });

  it("collapses newlines in tool_result content to a single line", () => {
    const m = { type: "user", message: { content: [{ type: "tool_result", content: "line1\n\nline2" }] } };
    expect(formatMessage(m)).toEqual(["  ⤷ line1 line2"]);
  });

  it("flattens array tool_result content (text blocks) before truncating", () => {
    const m = { type: "user", message: { content: [{ type: "tool_result", content: [{ type: "text", text: "hello" }] }] } };
    expect(formatMessage(m)).toEqual(["  ⤷ hello"]);
  });

  it("returns [] for result messages (run.ts prints the final line)", () => {
    expect(formatMessage({ type: "result", subtype: "success", result: "done" })).toEqual([]);
  });

  it("returns [] for unknown/malformed messages", () => {
    expect(formatMessage({ type: "system" })).toEqual([]);
    expect(formatMessage(null)).toEqual([]);
    expect(formatMessage({ type: "assistant", message: {} })).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run (from `sdk/`): `npx vitest run test/streamLog.test.ts`
Expected: FAIL —— `Failed to resolve import "../src/streamLog.js"` / `formatMessage is not a function`。

- [ ] **Step 3: 写最小实现**

Create `sdk/src/streamLog.ts`:

```ts
const MAX_RESULT = 200;
const MAX_ARGS = 80;

function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function truncate(s: string, max: number): string {
  const t = oneLine(s);
  return t.length > max ? t.slice(0, max) + "…" : t;
}

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((b: any) => (b?.type === "text" ? b.text ?? "" : "")).join("");
  }
  return "";
}

// Format one SDK message into 0..N CLI-style lines. Empty array = skip.
// `result` is intentionally skipped — run.ts prints the final PHASE RESULT line.
export function formatMessage(m: any): string[] {
  if (!m || typeof m !== "object") return [];

  if (m.type === "assistant") {
    const blocks = m.message?.content;
    if (!Array.isArray(blocks)) return [];
    const lines: string[] = [];
    for (const b of blocks) {
      if (b?.type === "text" && typeof b.text === "string" && b.text.trim()) {
        lines.push(b.text);
      } else if (b?.type === "tool_use") {
        lines.push(`→ ${b.name}(${truncate(JSON.stringify(b.input ?? {}), MAX_ARGS)})`);
      }
    }
    return lines;
  }

  if (m.type === "user") {
    const blocks = m.message?.content;
    if (!Array.isArray(blocks)) return [];
    const lines: string[] = [];
    for (const b of blocks) {
      if (b?.type === "tool_result") {
        lines.push(`  ⤷ ${truncate(resultText(b.content), MAX_RESULT)}`);
      }
    }
    return lines;
  }

  return [];
}
```

- [ ] **Step 4: 运行测试确认通过**

Run (from `sdk/`): `npx vitest run test/streamLog.test.ts`
Expected: PASS（8 个用例全绿）。

- [ ] **Step 5: 提交**

```bash
git add sdk/src/streamLog.ts sdk/test/streamLog.test.ts
git commit -m "feat(sdk): streamLog formatter for live SDK message output"
```

---

### Task 2: 把 streamLog 接入 orchestrator 消息循环

**Files:**
- Modify: `sdk/src/orchestrator.ts:38-51`

- [ ] **Step 1: 改循环，实时打印**

在 `orchestrator.ts` 顶部 import 区加：

```ts
import { formatMessage } from "./streamLog.js";
```

把现有循环：

```ts
  let result: any;
  for await (const m of query({
    prompt,
    options: {
      cwd: opts.worktreeDir,
      model: resolveModel(skills, opts.phase),
      permissionMode: "default",
      canUseTool: makeCanUseTool(principles, { logPath: join(laneDir, "decision-log.md"), denyLogPath: join(laneDir, "denied-tools.log") }),
      plugins: [{ type: "local", path: SUPERPOWERS }],
    },
  })) {
    if (m.type === "result") result = m;
  }
  return result;
```

改成（仅循环体增加打印；options 不变）：

```ts
  let result: any;
  for await (const m of query({
    prompt,
    options: {
      cwd: opts.worktreeDir,
      model: resolveModel(skills, opts.phase),
      permissionMode: "default",
      canUseTool: makeCanUseTool(principles, { logPath: join(laneDir, "decision-log.md"), denyLogPath: join(laneDir, "denied-tools.log") }),
      plugins: [{ type: "local", path: SUPERPOWERS }],
    },
  })) {
    for (const line of formatMessage(m)) console.log(line);
    if (m.type === "result") result = m;
  }
  return result;
```

- [ ] **Step 2: 类型检查通过**

Run (from `sdk/`): `npx tsc --noEmit`
Expected: 无错误退出（exit 0）。

- [ ] **Step 3: 跑全量测试确认无回归**

Run (from `sdk/`): `npx vitest run`
Expected: 全绿（含 Task 1 的 streamLog 用例 + 既有 canUseTool/judge/phases/state 用例）。

- [ ] **Step 4: 提交**

```bash
git add sdk/src/orchestrator.ts
git commit -m "feat(sdk): stream live activity log during auto run"
```

---

### Task 3: 顶层转发脚本 `./setup.sh` + `./run.sh`

**Files:**
- Create: `setup.sh`（仓库根）
- Create: `run.sh`（仓库根）

- [ ] **Step 1: 写 `setup.sh`**

Create `setup.sh`（仓库根）：

```bash
#!/usr/bin/env bash
# setup.sh — one-time setup for lanes auto mode (SDK + Docker).
# Thin forwarder to sdk/docker/setup.sh; run this once before ./run.sh.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/sdk/docker/setup.sh" "$@"
```

- [ ] **Step 2: 写 `run.sh`**

Create `run.sh`（仓库根）：

```bash
#!/usr/bin/env bash
# run.sh — run a lanes auto cycle (SDK + Docker).
# Usage: ./run.sh "<free-text request>" [worktree-dir]
# Thin forwarder to sdk/docker/run-auto.sh. Run ./setup.sh once first.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/sdk/docker/run-auto.sh" "$@"
```

- [ ] **Step 3: 加可执行位**

Run (from repo root): `chmod +x setup.sh run.sh`

- [ ] **Step 4: 语法检查 + 端到端验证转发**

Run: `bash -n setup.sh && bash -n run.sh && echo "syntax OK"`
Expected: 打印 `syntax OK`。

Run: `./run.sh --help`
Expected: 打印 `run-auto.sh` 的注释帮助（证明转发链 `run.sh → sdk/docker/run-auto.sh` 通，且不触发 docker）。

- [ ] **Step 5: 提交**

```bash
git add setup.sh run.sh
git commit -m "feat: top-level ./setup.sh + ./run.sh entry points for auto mode"
```

---

### Task 4: 移除 manual 模式安装脚本

**Files:**
- Delete: `install.sh`
- Delete: `uninstall.sh`

注意：**只删这两个脚本**。`commands/`、`principles.md` 保留（auto 模式依赖，挂载进容器）。

- [ ] **Step 1: 确认没有别处引用（除 README，下个 Task 处理）**

Run (from repo root): `grep -rn -E 'install\.sh|uninstall\.sh' --include='*.sh' --include='*.ts' --include='*.json' --include='Makefile' . | grep -v node_modules | grep -v package-lock`
Expected: 仅可能出现在 `.claude/settings.local.json` 之外无业务引用；若仅剩 README（.md，未在上面 include 内）则视为通过。无 `.sh`/`.ts`/`.json` 业务引用。

- [ ] **Step 2: 删除**

Run (from repo root): `git rm install.sh uninstall.sh`
Expected: `rm 'install.sh'` / `rm 'uninstall.sh'`。

- [ ] **Step 3: 提交**

```bash
git commit -m "chore: remove manual-mode install/uninstall scripts (auto is primary)"
```

---

### Task 5: 重写根 README 为 auto 主路径

**Files:**
- Modify: `README.md`（仓库根）

目标：以 auto 为主（且唯一受支持）路径；移除 Install/Update/Uninstall 斜杠命令章节与 Layout 中的 `install.sh`/`uninstall.sh` 行；保留"三条 lane"概念说明，但如实标注 SDK orchestrator 目前只跑 spec phase。

- [ ] **Step 1: 替换 Prerequisites / Install / Update / Uninstall / Use 区块**

把 `README.md` 中从 `## Prerequisites`（约 49 行）到 `## Compass — from anywhere ...` 结束（约 150 行）这一整段，替换为下面的 auto 模式说明：

````markdown
## Prerequisites

| Dependency      | Severity | Notes                                                      |
|-----------------|----------|------------------------------------------------------------|
| Docker Desktop  | hard     | auto runs the orchestrator inside a Linux container        |
| Claude Code CLI | hard     | `claude setup-token` issues the long-lived OAuth token     |
| Pro/Max 订阅    | hard     | required by `claude setup-token`                           |

`./setup.sh` verifies Docker + the `claude` CLI, starts Docker Desktop if it is
down, and obtains/saves the OAuth token for you. It is the preflight/doctor for
auto mode.

## Setup (one-time)

```bash
git clone https://github.com/philontos/lanes.git ~/Develop/personal/lanes
cd ~/Develop/personal/lanes
./setup.sh
```

`./setup.sh` will:
1. Verify Docker is available (and start Docker Desktop if it isn't).
2. Verify the `claude` CLI is on PATH.
3. Run `claude setup-token` for you and auto-capture the printed token
   (falling back to manual paste), saved to `~/.config/lanes/oauth-token`
   (outside the repo, never committed).
4. Build the `lanes-sdk-orchestrator:latest` Docker image.

## Run

```bash
./run.sh "add a /healthz endpoint returning 200 OK"
```

Optional second argument targets an existing worktree; without it a temporary
scratch directory is created:

```bash
./run.sh "refactor auth module" ~/worktrees/my-feature
```

The run streams a live, CLI-style activity log (assistant output, tool calls,
truncated tool results) to your terminal as it works, then prints the produced
`.lane/spec.md`.

> **Current capability:** the SDK orchestrator runs the **spec phase only**.
> The remaining forge phases (plan → impl → review → ship) are not yet wired
> into auto mode.
````

- [ ] **Step 2: 更新 Layout 区块**

把 Layout 代码块末尾的：

```
install.sh                           install / re-install
uninstall.sh                         remove symlinks
```

替换为：

```
setup.sh                             one-time auto-mode setup (forwards to sdk/docker/setup.sh)
run.sh                               run an auto cycle (forwards to sdk/docker/run-auto.sh)
sdk/                                 SDK orchestrator + Docker (auto mode engine)
```

并把 Layout 开头注释 `commands/   installed into ~/.claude/commands/` 改为
`commands/   lane definitions (forge/sprint/compass); mounted into the container by auto mode`。

- [ ] **Step 3: 校正首段与 Status 段措辞**

把首段里描述安装/交互式斜杠命令的措辞，改为说明 lanes 通过 auto 模式（SDK+Docker）headless 运行；保留三条 lane 的 ASCII 流程图。把 `## Status` 段中 "Implemented"（指 manual 斜杠命令完整流水线）改为如实反映：完整流水线的 lane 逻辑存在于 `commands/`，但 auto orchestrator 目前只驱动 spec phase，其余 phase 待接入。

- [ ] **Step 4: 人工通读校验**

Run: `grep -nE 'install\.sh|uninstall\.sh|/forge:approve|~/.claude/commands' README.md`
Expected: 不再出现把它们当作用户操作入口的残留（`commands/` 作为内部目录说明可保留，但不应再有"运行 install.sh / 安装斜杠命令"指引）。逐条人工确认剩余命中项均为概念性说明而非操作指引。

- [ ] **Step 5: 提交**

```bash
git add README.md
git commit -m "docs: rewrite README around auto mode (SDK+Docker) as primary path"
```

---

## Self-Review notes

- **Spec coverage:** A→Task 3；B→Task 4；C→Task 1+2；D→Task 5。全覆盖。
- **类型一致性:** `formatMessage(m): string[]` 在 Task 1 定义、Task 2 按 `for (const line of formatMessage(m))` 消费，一致。
- **保留项:** `commands/`、`principles.md` 在 Task 4 明确不删；README Layout 注释相应更新。
- **无 docker 依赖的验证:** Task 3 用 `./run.sh --help` 验证转发；setup 链用 `bash -n`。streamLog 纯函数单测；orchestrator 用 `tsc --noEmit` + 全量测试。
