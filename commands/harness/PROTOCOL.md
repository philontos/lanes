# Autonomous Harness — Shared Protocol

This file is referenced by every `/harness:*` command. It defines the contract.

## Skill resolution

Every phase command that needs a superpowers (or other) skill must NOT hard-code the skill name. Instead:

1. Read `~/.claude/commands/harness/skills.json`.
2. Look up the skill name under `skills.<logical-role>` (e.g. `skills.discover`).
3. Pass that exact string to the Skill tool.

The `usage` object in skills.json declares which logical roles each phase consumes — useful for a sanity scan but not load-bearing at runtime.

To swap a skill (e.g. point `discover` at a different brainstorming-style skill), edit `skills.json` only — never edit the phase command files for that reason.

## state.json schema

Location: `<worktree>/.harness/state.json`.

```jsonc
{
  "cycle_id": "2026-05-17-add-creativity-dimension",   // = git branch suffix
  "repo": "engram",                                    // engram | phronos
  "request": "为 engram 加一个 creativity dimension…",  // 原始描述
  "phase": "spec | plan | impl | review | ship | done",
  "status": "ok | needs-review | blocked | done",
  "next": "plan | impl | review | ship | null",        // 下一个 phase 名（=查找 ${next}.md）
  "gate": {                                            // 仅 status==needs-review 时存在
    "kind": "spec-review | plan-review",
    "artifact": ".harness/spec.md",                    // 给人审的产物
    "approve_cmd": "/harness:approve"
  },
  "blocker": {                                         // 仅 status==blocked 时存在
    "phase": "impl",
    "reason": "tests fail after 3 attempts on dimension loader",
    "last_action": "rewrote app/config/dimensions/creativity.yml from scratch",
    "transcript": ".harness/transcript/impl.log"
  },
  "history": [                                         // append-only；只供观测，不参与决策
    { "phase": "spec", "status": "ok", "at": "2026-05-17T10:01:33Z" }
  ]
}
```

### Invariants

1. `status` 只取 4 值之一；任何消费方分支只看 `status`。
2. `next` 必须是 `{spec, plan, impl, review, ship}` 之一或 null。命令通过 `~/.claude/commands/harness/${next}.md` 反查模板文件。
3. `gate.approve_cmd` 字面就是 `/harness:approve`。
4. `history` 不参与任何 hook / command 的逻辑决策。
5. Phase 命令对 state.json 的更新必须是**全文件覆盖写**（不要追加片段，确保 JSON 始终有效）。

## Self-chain tail

每个 phase command 干完主要工作后，**必须**执行以下这段：

```
1. 用 Bash + jq 读回 .harness/state.json 的 status 和 next 字段
2. 把刚刚结束的 phase 追加一条到 history（{phase, status, at: 当前 ISO-8601 时间}）
3. 分支处理：
   a) status == "ok" 且 next 非空：
      读取 ~/.claude/commands/harness/${next}.md 全文，作为新的指令立即继续执行。
      不要在本轮结束，直接接力到下一 phase 的逻辑。
   b) status == "needs-review"：
      调 PushNotification 工具，message:
        "{cycle_id}: {gate.kind} ready, run {gate.approve_cmd}"
      让本轮自然结束。
   c) status == "blocked":
      确认 .harness/blocker.md 已写好（reason + last_action + 建议人介入位置）。
      调 PushNotification 工具，message:
        "{cycle_id}: blocked at {blocker.phase}: {blocker.reason}"
      让本轮自然结束。
   d) status == "done":
      调 PushNotification 工具，message:
        "{cycle_id}: done ✓ — PR <url>"
      让本轮自然结束。
```

## AGENTS.md 注入

phase = spec 和 phase = review 时，必须把当前 repo 的 AGENTS.md **及** 所有子目录的 AGENTS.md（递归）读入上下文。具体：

```bash
# 在 worktree 根目录运行
find . -name AGENTS.md -not -path './.harness-worktrees/*' -print
```

把所有匹配文件的内容拼接、作为硬约束上下文交给 skill。

## .gitignore 注入

bootstrap 时检查 `<repo>/.gitignore` 是否已含 `.harness-worktrees/` 行；若无则追加：

```
# autonomous harness — cycle worktrees
.harness-worktrees/
```

并以 `chore: ignore harness worktrees` 提交到 main 分支（这次提交**不在**任何 cycle worktree 中）。

## cycle_id 命名

格式：`YYYY-MM-DD-<kebab-slug>`，slug 从 request 提取 3-6 关键词。冲突时追加 `-2`、`-3`。

## 文件位置约定

| 名字 | 路径 | 谁写 |
|---|---|---|
| state.json | `<worktree>/.harness/state.json` | bootstrap + 每个 phase command |
| spec.md | `<worktree>/.harness/spec.md` | /harness:spec |
| plan.md | `<worktree>/.harness/plan.md` | /harness:plan |
| blocker.md | `<worktree>/.harness/blocker.md` | 当前 phase command（仅 blocked 时） |
| transcript/<phase>.log | `<worktree>/.harness/transcript/` | 每个 phase command（可选） |
