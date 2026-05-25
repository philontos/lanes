# Auto 优先重构 — 设计

日期：2026-05-25
分支背景：`feat/sdk-orchestrator-mvp`

## 目标

把 **auto 模式**（SDK orchestrator 在 Docker 里 headless 运行 lanes）提升为仓库的
一等、顶层入口；同时退役 **manual 模式**（`install.sh` 把斜杠命令 symlink 进
`~/.claude/commands/` 供 CLI 交互式使用的那套）。并补上实时、类 CLI 的流式可观测性，
让一次 auto 运行能边跑边看到正在发生的事。

### 两种模式的定义

- **auto** — `./run.sh "<请求>"` → `sdk/docker/run-auto.sh` → `lanes-docker.sh`
  → `docker run` 镜像（入口为 `npx tsx src/run.ts --auto …`）→ Claude Agent SDK
  headless 驱动 lane。这是今后的优先方向。
- **manual** — `install.sh` 把 `commands/{forge,sprint,compass,…}` symlink/copy 进
  `~/.claude/commands/`，在 Claude Code CLI 里手动当斜杠命令跑。本轮移除。

## 已确认接受的后果

SDK orchestrator 目前**只实现了 spec 这一个 phase**
（`sdk/src/orchestrator.ts`："MVP only implements the spec phase"）。完整的 forge
流水线（spec → plan → impl → review → ship）只存在于 manual 的斜杠命令形态里。
现在删掉 `install.sh` 意味着**完整流水线暂时不可用**，直到 SDK orchestrator 把其余
phase 补齐。用户已确认接受——现在就删。

## 范围

### A. 顶层入口（两个根脚本）

- 新增 `./setup.sh`（仓库根）——瘦转发器，解析自身目录后 `exec`
  `sdk/docker/setup.sh "$@"`。
- 新增 `./run.sh`（仓库根）——瘦转发器，`exec` `sdk/docker/run-auto.sh "$@"`，
  把 `"<请求>" [worktree]` 原样透传。
- 脚本真身**留在 `sdk/docker/`**（与 `Dockerfile` 就近——它们用相对路径引用
  build context 和 `-f` 路径）。不重写任何路径。
- 转发器解析自身位置以便不依赖 CWD：
  `SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; exec "$SCRIPT_DIR/sdk/docker/<真身>.sh" "$@"`。

### B. 移除 manual 模式

- 删除 `install.sh` 和 `uninstall.sh`（仓库根）。
- **保留** `commands/`（forge/sprint/compass + `skills.json`）——auto 模式会把它
  挂进容器的 `/root/.claude/commands`，并读取 `skills.json` 与 lane 文件。必需。
- **保留** `principles.md` —— `src/run.ts` 会读它。
- `sdk/docker/setup.sh` 已经校验 Docker + `claude` CLI，由它接替 auto 模式的
  "doctor"/预检角色。原 `install.sh` 的依赖自检（git/superpowers/gh/glab/jq）随之
  一并去掉。
- 没有 CI 或代码引用 `install.sh`/`uninstall.sh`（grep 已验证）；只有 `README.md`
  引用它们，在 D 中重写。

### C. 流式可观测性（`sdk/src/`）

问题：`orchestrator.ts` 消费了 SDK 的消息流，但除了最后的 `result` 之外把每条消息都
丢弃了，导致一次 auto 运行在结束前什么都不打印。`docker run` 是前台跑的，所以只要
打印就会实时流到终端——我们只需在消息到达时就打印。

- 新增 `sdk/src/streamLog.ts` —— 一个纯函数格式化器
  `formatMessage(m): string | null`，把单条 SDK 消息转成一行简洁、类 CLI 的文本
  （返回 null 表示跳过）：
  - assistant 文本 → 原文本
  - tool_use → `→ 工具名(<简要参数>)`
  - tool_result → 截断后的结果（限长，如 200 字符，单行）
  - 其它/未知类型 → null（跳过）
- 在 `orchestrator.ts` 的 `for await` 循环里调用该格式化器，对非 null 的行
  `console.log`，同时仍捕获最终的 `result`。
- 保留 `run.ts` 现有的最后一行 `PHASE RESULT: <subtype>`。
- 默认 verbosity：简洁（每个事件一行，长工具结果截断）。原始/全量 dump 本轮不做。

### D. README 重写

- 重写根 `README.md`，围绕 auto 为主（且唯一受支持）路径：一次性 `./setup.sh`，
  之后每个任务 `./run.sh "<请求>"`。
- 移除 Install / Update / Uninstall 这些斜杠命令章节，以及 Layout 里的
  `install.sh`/`uninstall.sh` 行。
- 保留"三条 lane"（forge/sprint/compass）的概念说明——容器里跑的就是它们——但
  如实说明 SDK orchestrator 目前**只跑 spec phase**，其余 phase 待补。

## 不在范围内

- 在 SDK orchestrator 里实现非 spec 的 phase（plan/impl/review/ship）。
- 统一的 `./lanes` 调度器（已选两个根脚本方案）。
- 把脚本真身从 `sdk/docker/` 物理挪走。
- 原始/verbose 日志模式、日志落盘、结构化（JSON）日志。

## 测试

- `streamLog.ts` 是纯函数 → 用现有 vitest（`sdk/test/`、`sdk/vitest.config.ts`）
  对 `formatMessage` 做单测，覆盖样例消息（assistant 文本、tool_use、tool_result、
  截断边界）。
- 对两个新根转发器做 `bash -n` 语法检查。
- 手动冒烟（可选，有副作用）：`./run.sh "<很小的请求>"`，确认流式行实时出现、且
  spec 被产出。

## 风险

- 截断工具结果可能藏掉有用细节——对简洁默认可接受；原始模式延后。
- 删 `install.sh` 会在 SDK 追平前移除唯一可用的完整流水线路径——上文已明确接受。
