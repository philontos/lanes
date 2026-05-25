# Auto 大场景模式 — 设计

日期：2026-05-25

## 目标

让 auto 模式能服务**大需求**(0→1 MVP、大重构、一组关键 feature),从任意工程目录
通过全局 `lanes` 命令发起。一次无人值守运行自链 `spec → plan → impl → review`,把
真实代码写进当前本地目录。容器内工具全开(Docker 即隔离边界)。

随手小改**明确不在范围内**——那些留在交互式 Claude Code CLI 里处理。auto 模式定位
大而结构化的工作,靠 spec/plan 约束 agent 不跑偏。

## 已定决策(来自 brainstorming)

- **本刀链路深度**:`spec → plan → impl → review`。不含 `ship`/PR;git 由用户自理
  (forge 的 ship 阶段延后)。
- **无人值守**:操作者 judge 自动作答 `AskUserQuestion`;一路跑到底,无人类门控。但
  phase 链路结构上要能后续插入"暂停/批准"钩子——本刀**不实现**暂停/恢复。
- **权限**:容器内全开(所有工具含 `Bash`)。`AskUserQuestion` 仍路由到 judge。移除
  原 MVP 的宿主机安全白名单。
- **全局命令**:`setup.sh` 在 `~/.local/bin/lanes` 装一个启动器(用户级,免 sudo),
  内部用绝对路径 `exec` 仓库的 `run.sh`。`lanes` 命令缺省 worktree = `$PWD`。
- **接受的风险**:目标工程目录是读写挂载;放开 Bash 后 agent 能改/删其中文件(含破坏
  性命令)。这是"在我的工程里实现"所固有的,接受。
- **Prompt 实现方式**:保持简洁——phase 的 prompt **内联在代码里**(`buildPhasePrompt`),
  不引入模板目录/变量插值引擎。理由:只有 4 个 phase、措辞尚未定型、`skills.json` 已覆盖
  "换 skill 不改代码"的需求。
- **Prompt 语言**:交给容器内 Claude 的 phase prompt 文本**一律用英文**(替换现有
  `buildSpecPrompt` 的中文内容)。

## 架构

现状:`runPhase` 只跑单个 phase(`spec`),用写死的 `buildSpecPrompt`;`canUseTool`
把白名单之外全部 deny。本设计把这两处都推广。

### Phase 自链(一次运行 = spec → plan → impl → review)

- 新增 `runLane(opts)` 驱动整条序列。对 `["spec","plan","impl","review"]` 中每个
  phase 调用 `runPhase`(每 phase 一个独立 `query()` 会话——全新上下文,读取 `.lane/`
  里前序产物),更新 `.lane/state.json`(`phase`、`status`),某 phase 失败即停
  (`status: blocked`)。
- 每个 phase 是独立的 Agent SDK 会话(沿用 forge 的 per-phase subagent 隔离):后序
  phase 读前序 phase 写下的产物,而非内存上下文。
- **扩展钩子(本刀无行为)**:`runLane` 读取一个"门控 phase"列表(本刀为空)。留这个
  接缝,以便将来在 `spec` 或 `plan` 后暂停等批准,而不必重构循环。

### 每个 phase 的 prompt 取自 `skills.json`(复用 lane 配置,不碰 CLI 的 .md)

- 把单一的 `buildSpecPrompt` 换成 `buildPhasePrompt(phase, ctx)`。
- 它从 `commands/forge/skills.json` 解析某 phase 用哪些技能:
  `usage[phase]` → 逻辑角色 → `skills[role]` → 具体技能名。例如
  `spec → [discover] → superpowers:brainstorming`、
  `plan → [plan] → superpowers:writing-plans`、
  `impl → [execute,tdd,verify,parallel] → 对应的 superpowers 技能`。
- 每个 phase 的 prompt 说明:要用的技能、要从 `.lane/` 读的输入产物、要产出的输出、
  以及操作者约束(headless、工具全开、AGENTS.md 硬约束)。phase 输入/输出契约:
  | phase  | 读取                      | 写入 / 效果                              |
  |--------|---------------------------|------------------------------------------|
  | spec   | request、AGENTS.md        | `.lane/spec.md`                          |
  | plan   | `.lane/spec.md`           | `.lane/plan.md`                          |
  | impl   | `.lane/plan.md`、spec     | 工作目录里的代码改动(用 Bash)          |
  | review | git diff、spec、plan      | `.lane/review.md`;修掉发现的问题        |
- `review` 在 `skills.json` 里没有技能映射(`usage.review == []`);它的 prompt 是一个
  内置的自审遍(对照 spec+plan 审 diff 的正确性与范围,修掉发现的问题,在
  `.lane/review.md` 总结)。后续可选择映射一个具体 review 技能,本刀不要求。
- `resolveModel(skills, phase)` 已经从 `models[phase]` 返回每 phase 模型——原样复用
  (spec/plan=opus,impl=sonnet,review=opus)。

`buildPhasePrompt` 形态(示意;prompt 文本用英文):

```ts
function skillsForPhase(skills, phase: string): string[] {
  return (skills.usage[phase] ?? []).map((role: string) => skills.skills[role]);
}

function buildPhasePrompt(phase: string, ctx): string {
  const skillNames = skillsForPhase(ctx.skills, phase); // from skills.json
  const io = PHASE_IO[phase];                           // read/write contract (in code)
  return [
    `Phase: ${phase}.`,
    skillNames.length
      ? `Use these skills: ${skillNames.join(", ")}.`
      : `No skill mapped — do a built-in self-review pass.`,
    `Read: ${io.reads}`,
    `Produce: ${io.writes}`,
    "=== AGENTS.md (hard constraints) ===", ctx.agentsMd || "(none)",
    "Constraints: no human is present; AskUserQuestion is auto-answered by the",
    "operator judge per principles.md; all tools are available (Bash included).",
  ].join("\n");
}
```

`PHASE_IO` 在代码里定义每个 phase 的读/写契约(见上表)。

### 权限(`canUseTool.ts`)

- 容器内放开所有工具(含 `Bash`)。`AskUserQuestion` → judge 路由不变。deny 日志仅在
  仍有 deny 时保留(本刀已无 deny,故该路径变为不用/移除)。
- 移除 `SAFE` 白名单和 "MVP host-safety" 的 deny 分支,连同解释宿主机安全的注释。

### 全局命令(`setup.sh` + `run-auto.sh`)

- `setup.sh` 增加安装步骤:写 `~/.local/bin/lanes`,内容为 `#!/usr/bin/env bash` +
  `exec "<仓库绝对路径>/run.sh" "$@"`(仓库路径在 setup 时解析),并 `chmod +x`。若
  `~/.local/bin` 不在 `PATH`,打印一行提示让用户加进 shell rc。重跑 setup 幂等(覆盖)。
- `lanes "<请求>"` → worktree 缺省 `$PWD`。具体:启动器在调用者只给请求时,把 `$PWD`
  作为 worktree 传入。仓库内的 `./run.sh`/`run-auto.sh` 保持现有缺省(scratch 临时
  目录)不变,`$PWD` 缺省只针对全局 `lanes` 入口。
- 对真实工程目录,**不要伪造 `AGENTS.md`**:`run-auto.sh` 现在在 AGENTS.md 缺失时会写
  一个占位 AGENTS.md——改成仅在 scratch 模式下这么做,真实工程目录不动(无 AGENTS.md
  就以"无"继续)。

## 涉及组件 / 文件

- `sdk/src/orchestrator.ts` — 新增 `runLane`;把 `buildSpecPrompt` 换成
  `buildPhasePrompt`;phase 循环 + 状态更新。
- `sdk/src/phases.ts` — phase 列表 + 技能解析辅助(`skillsForPhase`),与现有
  `resolveModel` 并列。
- `sdk/src/canUseTool.ts` — 放开所有工具;保留 AskUserQuestion→judge。
- `sdk/src/run.ts` — 调用 `runLane`(整链)而非单个 `runPhase`。
- `sdk/src/state.ts` — 确保 state 读写支持跨链更新 `phase`/`status`。
- `sdk/docker/setup.sh` — 安装 `~/.local/bin/lanes`;PATH 提示。
- `sdk/docker/run-auto.sh` — 全局入口的 `$PWD` 缺省;非 scratch 模式不伪造 AGENTS.md;
  为整链播种 state。
- `README.md` — 全局 `lanes` 用法、大场景定位、新深度 + 全开权限;更新 Roadmap。

## 测试

- `phases.ts`:对 `skillsForPhase` 按 `commands/forge/skills.json` 做单测
  (spec→brainstorming、plan→writing-plans、impl→四个技能、review→无),以及现有
  `resolveModel` 用例。
- `canUseTool.ts`:更新测试——Bash 现在 `allow`;AskUserQuestion 仍路由到 judge 并返回
  answers。
- `buildPhasePrompt`:单测每个 phase 的 prompt 是否点名了正确的技能、引用了正确的
  输入/输出产物(纯字符串断言)。
- `runLane` 自链:用打桩的 `runPhase` 单测循环——验证 phase 顺序、状态转移、失败即停
  (不跑真实 `query()`)。
- 手动冒烟(有副作用):在 scratch 目录里 `lanes "<小 feature>"`,确认 spec.md +
  plan.md + 实际代码改动 + review.md 都出现,且有实时流式日志。

## 不在范围内

- `ship` 阶段 / 分支 / PR / MR。
- 人类暂停-批准 + 恢复机制(只加扩展接缝)。
- sprint / compass 接入 auto。
- 私有 registry 基础镜像凭据;SSH/钥匙串 workaround。
- 破坏性 Bash 的黑名单(容器即边界)。
- Prompt 模板目录 / 变量插值引擎(本刀内联在代码里)。

## 后续 / Roadmap

- **Prompt 外置**:`sdk/src/` 在 `docker build` 时 COPY 进镜像,故改 in-code prompt
  需要重 build 镜像才生效;而 `commands/`、`skills.json` 是运行时挂载、改完下次 `run`
  即生效。当 impl/review 的措辞趋稳、或"每次调 prompt 都要重 build"的摩擦变明显时,把
  phase prompt 提升到**已挂载的 `commands/forge/*.md`**(复用现有 lane 阶段文件,而非另
  起 `templates/` 目录),既免 rebuild 又与 CLI lane 定义一致。
- ship 阶段 / 分支 / PR;人类暂停-批准 + 恢复;sprint/compass 接入 auto。

## 风险

- 在读写挂载的工程目录上放开 Bash 可能损坏工作目录;已接受并写入文档。
- 长时无人值守链路可能基于错误的 spec/plan 耗费大量时间/token(本刀无门控)。扩展接缝
  是既定的缓解方向。
- `impl`/`review` 的 prompt 质量是难点;第一刀可能需要迭代才能稳定地对大任务产出可用
  代码。
