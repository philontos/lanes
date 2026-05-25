# lanes SDK Orchestrator — Docker Setup

Run the lanes SDK orchestrator (`tsx src/run.ts`) inside a Linux container with Linux-native Node deps, mounting your local superpowers plugin, commands, and lanes repo into the container.

## Quickstart

### One-time setup

```bash
./sdk/docker/setup.sh
```

This will:
1. Check Docker Desktop is running.
2. Check the `claude` CLI is installed and logged in.
3. Prompt you to run `claude setup-token` and paste the token — saved to `~/.config/lanes/oauth-token` (outside the repo, never committed).
4. Build the Docker image.

### Every run

```bash
./sdk/docker/run-auto.sh "add a /healthz endpoint returning 200 OK"
```

Pass an optional second argument to target an existing worktree:

```bash
./sdk/docker/run-auto.sh "refactor auth module" ~/worktrees/my-feature
```

Without a second argument a temporary scratch directory is created automatically (useful for trying things out; real project integration and proper git worktrees come with the full forge loop later).

## Extra Config

| Item | Why |
|------|-----|
| `~/.config/lanes/oauth-token` | macOS Keychain is not accessible inside the container; the token is the headless auth path. Keep it secret — it is stored outside the repo and gitignored by location. |
| `~/.claude/plugins` mount | Superpowers plugin path is hardcoded to `$HOME/.claude/plugins/cache/…` in `orchestrator.ts` |
| `~/Develop/personal/lanes/commands` mount (not `~/.claude/commands`) | `skills.json` + lane command files. `~/.claude/commands` contains symlinks into the lanes repo — Docker bind-mounts don't follow cross-mount symlinks, so we mount the real source directory. |
| `~/Develop/personal/lanes` mount | `principles.md` path hardcoded to `$HOME/Develop/personal/lanes/principles.md` in `run.ts` |
| Worktree mount (read-write) | Agent reads `.lane/state.json`, writes `.lane/spec.md` and decision logs |
| Linux-native `npm ci` in image | Host `node_modules` has macOS/arm64 binaries that won't run in Linux |
| Network access | `@anthropic-ai/claude-agent-sdk` calls the Anthropic API; the container must reach the internet |

## Worktree Requirements

The worktree dir must contain:

- `.lane/state.json` — at minimum `{ "request": "your task description" }` (`run-auto.sh` writes this for you)
- `AGENTS.md` (optional) — constraints for the agent

## Manual Usage (advanced)

If you need to drive `lanes-docker.sh` directly after running `setup.sh`, the token is read from `~/.config/lanes/oauth-token` automatically — no manual export needed:

```bash
./sdk/docker/lanes-docker.sh /path/to/my-feature forge spec
```

To override the token for a single run:

```bash
CLAUDE_CODE_OAUTH_TOKEN=<token> ./sdk/docker/lanes-docker.sh /path/to/my-feature forge spec
```

## Customizing the Image Name

```bash
export LANES_SDK_IMAGE=my-registry/lanes-sdk:v1
./sdk/docker/lanes-docker.sh /path/to/worktree
```

## Image Details

| Field | Value |
|-------|-------|
| Base image | `node:22-bookworm-slim` |
| Extra packages | `git` |
| Node deps | `npm ci` (Linux-native, inside image) |
| Container `$HOME` | `/root` (matches mount target paths) |
| Entrypoint | `npx tsx src/run.ts` |
