# lanes SDK Orchestrator — Docker Setup

Run the lanes SDK orchestrator (`tsx src/run.ts`) inside a Linux container with Linux-native Node deps. The superpowers skills are baked into the image; only the lanes repo and the target worktree are mounted in.

## Quickstart

### One-time setup

```bash
./docker/setup.sh
```

This will:
1. Check Docker Desktop is running (and start it for you if it isn't).
2. Check the `claude` CLI is installed and logged in.
3. Run `claude setup-token` for you and auto-capture the token it prints (falling back to manual paste if it can't), saved to `~/.config/lanes/oauth-token` (outside the repo, never committed).
4. Build the Docker image.

### Every run

```bash
./docker/run-auto.sh "add a /healthz endpoint returning 200 OK"
```

The request can also be a path to a file — `./docker/run-auto.sh ./feature.md` — recognized when it begins with `./`, `../`, `/`, or `~/`, or ends in `.md`, `.markdown`, or `.txt`. A path-like request must resolve to a readable, non-empty file, or the run fails loudly before any cycle dir or `state.json` is created.

Pass an optional second argument to target an existing worktree:

```bash
./docker/run-auto.sh "refactor auth module" ~/worktrees/my-feature
```

Without a second argument a temporary scratch directory is created automatically (useful for trying things out; real project integration and proper git worktrees come with the full forge loop later).

## Extra Config

| Item | Why |
|------|-----|
| `~/.config/lanes/oauth-token` | macOS Keychain is not accessible inside the container; the token is the headless auth path. Keep it secret — it is stored outside the repo and gitignored by location. |
| skill plugins baked into image | `install-plugins.sh` reads `docker/plugins.json` at build and clones each declared plugin (pinned) into `/opt/lanes/plugins/<name>`; orchestrator loads them all via `$LANES_PLUGINS`. No host plugin / mount needed at runtime. Add a skill = add a manifest line + rebuild. |
| `~/Develop/personal/lanes` mount | Repo is read at runtime for `lanes.config.json` (per-phase config) and `judge-principles.md`; paths hardcoded under `$HOME/Develop/personal/lanes/` in `run.ts`. |
| Worktree mount (read-write) | Per-cycle dir `.lane/cycles/<id>/` (pointed to by `.lane/current-cycle`); agent reads its `state.json`, writes `spec.md` and the decision log there |
| Linux-native `npm ci` in image | Host `node_modules` has macOS/arm64 binaries that won't run in Linux |
| Network access | `@anthropic-ai/claude-agent-sdk` calls the Anthropic API; the container must reach the internet |

## Worktree Requirements

The worktree dir must contain:

- `.lane/current-cycle` + `.lane/cycles/<id>/state.json` — at minimum `{ "request": "your task description" }` in the cycle's state.json (`run-auto.sh` writes both for you)
- `AGENTS.md` (optional) — constraints for the agent

## Manual Usage (advanced)

If you need to drive `lanes-docker.sh` directly after running `setup.sh`, the token is read from `~/.config/lanes/oauth-token` automatically — no manual export needed:

```bash
./docker/lanes-docker.sh /path/to/my-feature forge spec
```

To override the token for a single run:

```bash
CLAUDE_CODE_OAUTH_TOKEN=<token> ./docker/lanes-docker.sh /path/to/my-feature forge spec
```

## Customizing the Image Name

```bash
export LANES_SDK_IMAGE=my-registry/lanes-sdk:v1
./docker/lanes-docker.sh /path/to/worktree
```

## Image Details

| Field | Value |
|-------|-------|
| Base image | `node:22-bookworm-slim` |
| Extra packages | `git` |
| Node deps | `npm ci` (Linux-native, inside image) |
| Container `$HOME` | `/root` (matches mount target paths) |
| Entrypoint | `npx tsx` (script path supplied as CMD: `/app/sdk/src/run.ts` for cycles, `/app/web/src/run.ts` for the web) |
