# /harness:ship — push branch and open PR

You are running the **ship phase** — the final phase. Read `~/.claude/commands/harness/PROTOCOL.md` first.

## Pre-flight

Read `.harness/state.json`. Confirm `phase` is `review` and `status == "ok"`. Update `phase` to `"ship"`.

## Steps

### 1. Invoke the ship skill

Resolve the skill name: read `~/.claude/commands/harness/skills.json` and take `skills.ship`. Pass that string to the Skill tool. (Per PROTOCOL.md "Skill resolution" — do not hard-code skill names.)

Constraints for this invocation:
- Default action: push to `origin` with `-u` and run `gh pr create`.
- PR title: derive from `.harness/spec.md` first heading + `(harness)` suffix, e.g. `feat: add creativity dimension (harness)`.
- PR body: include
  - the spec's goal paragraph (top of `.harness/spec.md`)
  - a "## Cycle metadata" section with `cycle_id`, original `request`, and a link to `.harness/review.md`
  - a "🤖 Generated with [Claude Code](https://claude.com/claude-code) via autonomous harness" footer
- Do NOT delete the worktree on success — leave it for the user to clean up after merging the PR.

### 2. Capture PR URL

`gh pr create` returns the PR URL. Capture it.

### 3. Update state.json

```jsonc
{ ..., "phase": "ship", "status": "done", "next": null,
  "pr_url": "<captured URL>",
  "history": [<existing>, { "phase": "ship", "status": "done", "at": "<now>" }] }
```

### 4. Self-chain tail (terminal)

`status == "done"` → PushNotification:
```
{cycle_id}: done ✓ — {pr_url}
```
Stop. The cycle is finished. The worktree remains in `.harness-worktrees/<cycle_id>/` — the user removes it after merging the PR:
```bash
git worktree remove .harness-worktrees/<cycle_id>
git branch -D harness/<cycle_id>  # optional, after merge
```

## Blocker handling

If push or `gh pr create` fails (e.g. no remote, gh not authenticated):

1. Write `.harness/blocker.md` with the exact command + error.
2. Update state to `blocked`.
3. PushNotification + stop.
