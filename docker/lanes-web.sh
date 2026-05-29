#!/usr/bin/env bash
# lanes-web.sh — start the local lanes web on http://localhost:7777
#
# The web runs inside the existing lanes-sdk-orchestrator image so the host
# needs nothing more than Docker (matches the rest of the project). The
# container mounts:
#   - the workspace dir, at the SAME path inside the container (so when the web
#     spawns cycle containers via the mounted docker socket, the -v paths it
#     emits resolve correctly on the host's docker daemon);
#   - the lanes repo, read-only, at its host path (same reason);
#   - /var/run/docker.sock so the web can docker-run cycle containers.
#
# Usage:
#   lanes web                start with defaults (workspace = ~/lanes-workspace)
#   lanes web --port 8080    override the port
#   LANES_WORKSPACE=/path lanes web    override the workspace dir
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"   # docker/
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"                    # repo root
IMAGE="${LANES_SDK_IMAGE:-lanes-sdk-orchestrator:latest}"
PORT=7777
WORKSPACE="${LANES_WORKSPACE:-$HOME/lanes-workspace}"

# ── Args ─────────────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --port) PORT="$2"; shift 2 ;;
    --port=*) PORT="${1#--port=}"; shift ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) shift ;;  # ignore stray positional args (the launcher may append $PWD)
  esac
done

# ── Token ────────────────────────────────────────────────────────────────────
TOKEN_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/lanes/oauth-token"
if [[ -z "${CLAUDE_CODE_OAUTH_TOKEN:-}" && -s "$TOKEN_FILE" ]]; then
  CLAUDE_CODE_OAUTH_TOKEN="$(cat "$TOKEN_FILE")"
  export CLAUDE_CODE_OAUTH_TOKEN
fi
if [[ -z "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]]; then
  echo "WARNING: CLAUDE_CODE_OAUTH_TOKEN not set — the web will run, but running cycles will fail." >&2
  echo "  Run ./setup.sh first to issue a token." >&2
fi

# ── Workspace ────────────────────────────────────────────────────────────────
mkdir -p "$WORKSPACE"
WORKSPACE="$(cd "$WORKSPACE" && pwd)"

# ── Image present? ───────────────────────────────────────────────────────────
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
if ! docker image inspect "$IMAGE" > /dev/null 2>&1; then
  echo "Image '$IMAGE' not found. Building..."
  docker build -t "$IMAGE" -f "$SCRIPT_DIR/Dockerfile" "$REPO_DIR"
fi

# ── Concurrency guard — refuse if another web container is running ──────────
EXISTING="$(docker ps -q --filter "label=lanes.role=web" 2>/dev/null || true)"
if [[ -n "$EXISTING" ]]; then
  echo "lanes web is already running (container $EXISTING). Stop it with:" >&2
  echo "  docker kill $EXISTING" >&2
  exit 1
fi

CONTAINER_NAME="lanes-web-$(printf '%s' "$WORKSPACE" | cksum | cut -d' ' -f1)"
cleanup() { docker rm -f "$CONTAINER_NAME" > /dev/null 2>&1 || true; }
trap cleanup INT TERM EXIT

echo "lanes web → http://localhost:$PORT"
echo "  workspace: $WORKSPACE"
echo "  image:     $IMAGE"
echo ""

# Optional SSH key mount — lets `git clone git@github.com:...` work inside the
# web container by reusing the host user's ~/.ssh keys. Mounted read-only;
# StrictHostKeyChecking=accept-new + a writable UserKnownHostsFile at /tmp
# so first-touch GitHub fingerprint doesn't block, and we don't try to write
# to the read-only mount. Skip the mount entirely if ~/.ssh doesn't exist
# (HTTPS-only users don't need this).
SSH_MOUNT=()
GIT_SSH_ENV=()
if [[ -d "$HOME/.ssh" ]]; then
  SSH_MOUNT=(-v "$HOME/.ssh:/root/.ssh:ro")
  GIT_SSH_ENV=(-e "GIT_SSH_COMMAND=ssh -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/tmp/known_hosts")
fi

# Mount workspace and repo at THEIR HOST PATHS inside the container. This is
# essential: when the web later spawns a cycle container via the mounted docker
# socket, the -v paths it emits are resolved by the host's docker daemon, which
# only knows about host paths. Matching the in-container path to the host path
# means the web can just use process.cwd-style paths verbatim.
docker run --rm \
  --name "$CONTAINER_NAME" \
  --label "lanes.role=web" \
  --label "lanes.workspace=$WORKSPACE" \
  -p "$PORT:7777" \
  -e CLAUDE_CODE_OAUTH_TOKEN \
  -e LANES_WORKSPACE="$WORKSPACE" \
  -e LANES_WORKSPACE_HOST="$WORKSPACE" \
  -e LANES_REPO_HOST="$REPO_DIR" \
  -e LANES_SDK_IMAGE="$IMAGE" \
  -e LANES_WEB_PORT=7777 \
  "${GIT_SSH_ENV[@]}" \
  -v "$WORKSPACE:$WORKSPACE:rw" \
  -v "$REPO_DIR:/lanes:ro" \
  -v "/var/run/docker.sock:/var/run/docker.sock" \
  "${SSH_MOUNT[@]}" \
  "$IMAGE" \
  /app/web/src/run.ts
