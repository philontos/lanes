# lanes SDK Orchestrator — Docker Setup

Run the lanes SDK orchestrator (`tsx src/run.ts`) inside a Linux container with Linux-native Node deps, mounting your local superpowers plugin, commands, and lanes repo into the container.

## One Manual Step (Auth)

macOS stores Claude subscription credentials in Keychain — the container can't read them.
The headless path is a long-lived OAuth token:

```bash
# 1. On your Mac, obtain a token:
claude setup-token

# 2. Export it in the shell where you'll run the launcher:
export CLAUDE_CODE_OAUTH_TOKEN=<the-token>
```

That's the only manual step. The token is passed into the container via `-e CLAUDE_CODE_OAUTH_TOKEN` and never written to any file or image layer.

## One-Click Launch

```bash
./sdk/docker/lanes-docker.sh <worktree-dir> [lane] [phase]
```

**Example:**

```bash
export CLAUDE_CODE_OAUTH_TOKEN=<your-token>
./sdk/docker/lanes-docker.sh ~/worktrees/my-feature forge spec
```

The script auto-builds the image on first run if it doesn't exist yet.

To build manually:

```bash
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
docker build -t lanes-sdk-orchestrator:latest -f sdk/docker/Dockerfile sdk/
```

## What the Launcher Does

| Step | Detail |
|------|--------|
| Validates `CLAUDE_CODE_OAUTH_TOKEN` | Fails fast with clear instructions if unset |
| Auto-builds image if missing | Uses `sdk/docker/Dockerfile` |
| Mounts superpowers plugin (read-only) | `~/.claude/plugins` → `/root/.claude/plugins` |
| Mounts lane commands + `skills.json` (read-only) | `~/Develop/personal/lanes/commands` → `/root/.claude/commands` (not `~/.claude/commands` — those are symlinks that Docker can't follow across mount boundaries) |
| Mounts lanes repo including `principles.md` (read-only) | `~/Develop/personal/lanes` → `/root/Develop/personal/lanes` |
| Mounts worktree dir (read-write) | `<worktree>` → `/worktree` (agent writes `.lane/` here) |
| Passes token as env var | `-e CLAUDE_CODE_OAUTH_TOKEN` |
| Runs orchestrator | `npx tsx src/run.ts --auto /worktree <lane> <phase>` |

## Extra Config Needed

| Item | Why |
|------|-----|
| `CLAUDE_CODE_OAUTH_TOKEN` env var | Keychain is macOS-only; container uses token auth |
| `~/.claude/plugins` mount | Superpowers plugin path is hardcoded to `$HOME/.claude/plugins/cache/...` in `orchestrator.ts` |
| `~/Develop/personal/lanes/commands` mount (not `~/.claude/commands`) | `skills.json` + lane command files read at `$HOME/.claude/commands/<lane>/skills.json`. `~/.claude/commands` contains symlinks into the lanes repo — Docker bind-mounts don't follow cross-mount symlinks. Mount the actual source directory instead. |
| `~/Develop/personal/lanes` mount | `principles.md` path hardcoded to `$HOME/Develop/personal/lanes/principles.md` in `run.ts` |
| Worktree mount (read-write) | Agent reads `.lane/state.json`, writes `.lane/spec.md` and decision logs |
| Linux-native `npm ci` in image | Host `node_modules` has macOS/arm64 `claude-code` binary — won't run in Linux |
| Network access | `@anthropic-ai/claude-agent-sdk` calls the Anthropic API; container must reach the internet |

## Worktree Requirements

The worktree dir passed as `<worktree-dir>` must contain:

- `.lane/state.json` — at minimum `{ "request": "your task description" }`
- `AGENTS.md` (optional) — constraints for the agent

## Image Details

| Field | Value |
|-------|-------|
| Base image | `node:22-bookworm-slim` |
| Extra packages | `git` |
| Node deps | `npm ci` (Linux-native, inside image) |
| Container `$HOME` | `/root` (matches mount target paths) |
| Entrypoint | `npx tsx src/run.ts` |

## Customizing the Image Name

```bash
export LANES_SDK_IMAGE=my-registry/lanes-sdk:v1
./sdk/docker/lanes-docker.sh /path/to/worktree
```
