# /sprint:ship — push branch and open PR / MR (sprint variant)

You are running the **ship phase** of a sprint cycle — the final phase. Read `~/.claude/commands/PROTOCOL.md` first.

Sprint ship is the immediate successor of impl — there is no in-pipeline review phase. It differs from forge ship in cosmetic ways only: the worktree lives under `.sprint-worktrees/`, the branch is `sprint/<cycle_id>`, the PR footer says "via the sprint lane", the PR body invites human / `/ultrareview` review (since no subagent review preceded it), and the backlog-completion commit message names sprint. Push + PR-open mechanics are identical to forge.

## Model advisory check

Read `~/.claude/commands/sprint/skills.json`. Take `models.ship.advisory_session` (recommended: `haiku low` — ship is mechanical). If current session is much heavier, advise once and proceed.

## Pre-flight

Read `.lane/state.json`. Confirm `phase` is `impl` and `status == "ok"`. Update `phase` to `"ship"`.

## Steps

### 1. Detect remote host

```bash
REMOTE_URL=$(git remote get-url origin 2>/dev/null || echo "")
case "$REMOTE_URL" in
  *github*)  HOST=github;  TOOL=gh;   ARTIFACT=PR ;;
  *gitlab*)  HOST=gitlab;  TOOL=glab; ARTIFACT=MR ;;
  *)         HOST=unknown; TOOL="";   ARTIFACT="" ;;
esac
```

If `HOST=unknown` OR `command -v "$TOOL"` fails, skip auto-opening — push only and report the gap in the final notification. Do NOT treat this as a blocker; pushing the branch is successful delivery.

### 2. Invoke the ship skill

Resolve the skill name: read `~/.claude/commands/sprint/skills.json` and take `skills.ship`. Pass that string to the Skill tool.

Constraints for this invocation:
- **Always** push to `origin` with `-u`. Non-negotiable.
- **Then**, conditional on host detection:
  - `HOST=github` and `gh` available: run `gh pr create`. Capture the URL.
  - `HOST=gitlab` and `glab` available: run `glab mr create`. Capture the URL.
  - Otherwise: skip; URL is unavailable.
- **Title:** derive from either the backlog bullet's title (`state.backlog_bullet.parsed.title`) or, if null, the cycle's `state.request` (first line, truncated to ~70 chars).
- **Body:** include
  - The bullet block in full (`state.backlog_bullet.raw`) if non-null, OR the freeform request text otherwise.
  - A **"## Sprint cycle metadata"** section with: `cycle_id`, the lane name (`sprint`), and a one-liner noting that sprint skipped the in-pipeline subagent review.
  - A **"## Review"** section containing exactly this line: *"Sprint did not run an in-pipeline reviewer. Suggested next step: run `/ultrareview` on this PR for parallel multi-agent review, or have a human reviewer look at it directly."*
  - A **"🤖 Generated with [Claude Code](https://claude.com/claude-code) via the sprint lane"** footer.
- Do NOT delete the worktree on success — leave it for the user to clean up after merging.

### 2.5. Mark backlog bullet completed (if applicable)

Read `state.backlog_bullet`. If `null` (cycle was a freeform `/sprint <text>`), skip this step entirely.

Otherwise (cycle came from `/sprint next`):

1. Determine `REPO_ROOT` — walk up from the worktree, or use `git worktree list` and take the bare repo path.
2. Read `$REPO_ROOT/docs/lanes/backlog.md`.
3. Find the bullet block under `## Dispatched` whose title line matches `backlog_bullet.parsed.title` (substring match on the line before the `*(dispatched ...)*` annotation).
4. **Move the entire block** from `## Dispatched` to `## Completed` (create the section at end of file if missing).
5. Append (or replace) `  *(completed <ISO-8601 now> @ $(git -C "$REPO_ROOT" rev-parse --short HEAD))*` on the title line. Remove the old `*(dispatched ...)*` annotation if present.
6. Commit on main directly:
   ```bash
   git -C "$REPO_ROOT" add docs/lanes/backlog.md
   git -C "$REPO_ROOT" commit -m "chore(lanes): mark backlog item completed (sprint/$CYCLE_ID)" || true
   ```

If any step fails: **do NOT halt ship**. Push + PR opening is what matters. Record the failure in state.json under `backlog_completion_warning: "<reason>"` and continue.

### 3. Update state.json

```jsonc
{ ..., "phase": "ship", "status": "done", "next": null,
  "host": "<github|gitlab|unknown>",
  "pr_url": "<captured URL or null>",
  "manual_open_required": <true if URL is null else false>,
  "backlog_completion_warning": "<reason if step 2.5 failed, else absent>",
  "history": [<existing>, { "phase": "ship", "status": "done", "at": "<now>" }] }
```

### 4. Self-chain tail (terminal)

`status == "done"` → PushNotification:

- If `pr_url` is set:
  ```
  {cycle_id}: sprint done ✓ — {pr_url}
  ```
- If `manual_open_required` is true:
  ```
  {cycle_id}: sprint branch pushed ✓ — auto-open skipped (host={host}, no matching CLI). Open the {ARTIFACT or "review request"} manually.
  ```

Stop. The cycle is finished. The worktree remains in `.sprint-worktrees/<cycle_id>/` — the user removes it after merging:

```bash
git worktree remove .sprint-worktrees/<cycle_id>
git branch -D sprint/<cycle_id>  # optional, after merge
```

## Blocker handling

Only the `git push` step is allowed to escalate to a blocker (e.g. no remote configured, push rejected by branch protection, auth failure). PR/MR creation failures fall through to "manual open required", not block:

1. Write `.lane/blocker.md` with the exact `git push` command + error.
2. Update state to `blocked`.
3. PushNotification + stop.
