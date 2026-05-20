# /forge:ship — push branch and open PR / MR

You are running the **ship phase** — the final phase. Read `~/.claude/commands/PROTOCOL.md` first.

## Model advisory check

Read `~/.claude/commands/forge/skills.json`. Take `models.ship.advisory_session` (recommended: `haiku low` — ship is mechanical push + PR open). If current session is much heavier, advise once and proceed.

## Pre-flight

Read `.lane/state.json`. Confirm `phase` is `review` and `status == "ok"`. Update `phase` to `"ship"`.

## Steps

### 1. Detect remote host

Determine which collaboration tool (if any) to use for opening a review request:

```bash
REMOTE_URL=$(git remote get-url origin 2>/dev/null || echo "")
case "$REMOTE_URL" in
  *github*)  HOST=github;  TOOL=gh;   ARTIFACT=PR ;;
  *gitlab*)  HOST=gitlab;  TOOL=glab; ARTIFACT=MR ;;
  *)         HOST=unknown; TOOL="";   ARTIFACT="" ;;
esac
```

If `HOST=unknown` OR `command -v "$TOOL"` fails (the matching CLI isn't installed), skip auto-opening — push only and report the gap in the final notification. Do NOT treat this as a blocker; pushing the branch is successful delivery, opening the review request is a convenience.

### 2. Invoke the ship skill

Resolve the skill name: read `~/.claude/commands/forge/skills.json` and take `skills.ship`. Pass that string to the Skill tool. (Per PROTOCOL.md "Skill resolution" — do not hard-code skill names.)

Constraints for this invocation:
- **Always** push to `origin` with `-u`. This is non-negotiable — it's the actual delivery.
- **Then**, conditional on host detection above:
  - `HOST=github` and `gh` available: run `gh pr create` with the title/body specified below. Capture the returned URL.
  - `HOST=gitlab` and `glab` available: run `glab mr create` with equivalent flags. Capture the returned URL.
  - Otherwise: skip; URL is unavailable.
- Title: derive from `.lane/spec.md` first heading.
- Body: include
  - the spec's goal paragraph (top of `.lane/spec.md`)
  - a "## Cycle metadata" section with `cycle_id`, original `request`, and a link to `.lane/review.md`
  - a "🤖 Generated with [Claude Code](https://claude.com/claude-code) via the forge lane" footer
- Do NOT delete the worktree on success — leave it for the user to clean up after merging.

### 2.5. Mark backlog bullet completed (if applicable)

Read state.json `backlog_bullet`. If `null` (cycle was a freeform `/forge <text>`), skip this step entirely.

Otherwise (cycle came from `/forge next`):

1. Determine `REPO_ROOT` by walking up from the worktree (same logic as bootstrap step 1; or just use `git -C "$WT" rev-parse --show-superproject-working-tree` / `git worktree list`).
2. Read `$REPO_ROOT/docs/lanes/backlog.md`.
3. Find the bullet block under `## Dispatched` whose title line matches `backlog_bullet.parsed.title` (substring match on the line before the `*(dispatched ...)*` annotation).
4. **Move the entire block** from `## Dispatched` to `## Completed` (create the section at end of file if missing).
5. Append (or replace) `  *(completed <ISO-8601 now> @ $(git -C "$REPO_ROOT" rev-parse --short HEAD))*` on the title line. Remove the old `*(dispatched ...)*` annotation if present.
6. Commit on the main branch directly (this is a write outside the worktree):
   ```bash
   git -C "$REPO_ROOT" add docs/lanes/backlog.md
   git -C "$REPO_ROOT" commit -m "chore(lanes): mark backlog item completed (forge/$CYCLE_ID)" || true
   ```

If any step fails (file not found, title not located in Dispatched, commit conflict, etc.): **do NOT halt ship**. Push + PR opening is what matters. Record the failure in state.json under `backlog_completion_warning: "<reason>"` and continue. The user can mark it complete manually later.

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

`status == "done"` → PushNotification, picking the message by what happened:

- If `pr_url` is set:
  ```
  {cycle_id}: done ✓ — {pr_url}
  ```
- If `manual_open_required` is true:
  ```
  {cycle_id}: branch pushed ✓ — auto-open skipped (host={host}, no matching CLI). Open the {ARTIFACT or "review request"} manually.
  ```

Stop. The cycle is finished. The worktree remains in `.forge-worktrees/<cycle_id>/` — the user removes it after merging:

```bash
git worktree remove .forge-worktrees/<cycle_id>
git branch -D forge/<cycle_id>  # optional, after merge
```

## Blocker handling

Only the `git push` step is allowed to escalate to a blocker (e.g. no remote configured, push rejected by branch protection, auth failure). PR/MR creation failures should fall through to "manual open required", not block:

1. Write `.lane/blocker.md` with the exact `git push` command + error.
2. Update state to `blocked`.
3. PushNotification + stop.
