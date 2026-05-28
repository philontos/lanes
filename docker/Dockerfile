FROM node:22-bookworm-slim

# Install git (claude-agent-sdk worktree ops + cloning plugins below) and curl
# (used to fetch the Docker CLI tarball, see next layer).
# ca-certificates is a *Recommends* of git, skipped by --no-install-recommends,
# so add it explicitly — without it the HTTPS clone fails ("server certificate
# verification failed. CAfile: none").
RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

# Install the Docker CLI binary from the official static distribution. The web
# spawns cycle containers via the host's docker daemon (socket mounted at
# runtime); without this binary, spawn("docker", ...) fails with ENOENT. We
# extract ONLY the client binary from the tarball — no daemon, no containerd.
# Arch is resolved via `dpkg --print-architecture` (amd64/arm64) and mapped to
# Docker's static-distribution naming (x86_64/aarch64).
ARG DOCKER_VERSION=27.4.0
RUN set -e; \
    deb_arch="$(dpkg --print-architecture)"; \
    case "$deb_arch" in \
      amd64) docker_arch=x86_64 ;; \
      arm64) docker_arch=aarch64 ;; \
      *) echo "unsupported arch for docker CLI: $deb_arch" >&2; exit 1 ;; \
    esac; \
    curl -fsSL "https://download.docker.com/linux/static/stable/${docker_arch}/docker-${DOCKER_VERSION}.tgz" \
      | tar -xz -C /tmp; \
    install -m 0755 /tmp/docker/docker /usr/local/bin/docker; \
    rm -rf /tmp/docker

# Bake every plugin declared in docker/plugins.json into the image at build (one
# dir per plugin under /opt/lanes/plugins), so runtime is fully self-contained —
# no host-installed plugin / mounted ~/.claude/plugins. Declarative: add a skill
# = add a line to docker/plugins.json and rebuild. The orchestrator loads
# /opt/lanes/plugins/* via $LANES_PLUGINS.
COPY docker/plugins.json /app/plugins.json
COPY docker/install-plugins.sh /usr/local/bin/install-plugins.sh
RUN chmod +x /usr/local/bin/install-plugins.sh \
    && /usr/local/bin/install-plugins.sh /app/plugins.json /opt/lanes/plugins
ENV LANES_PLUGINS=/opt/lanes/plugins

# Install sdk's npm deps (Linux-native; never from host, which has macOS/arm64).
COPY sdk/package.json sdk/package-lock.json /app/sdk/
WORKDIR /app/sdk
RUN npm ci

# Copy source: sdk runtime + web app (server + static assets). Tests are not
# copied — image is for running, not for testing.
COPY sdk/src /app/sdk/src
COPY sdk/tsconfig.json /app/sdk/tsconfig.json
COPY web /app/web

# Verify tsx is reachable
RUN npx tsx --version

# WORKDIR stays at /app/sdk so `npx` finds tsx in /app/sdk/node_modules. The
# image serves both the cycle orchestrator AND the web; the launcher
# (docker/lanes-docker.sh / docker/lanes-web.sh) passes the explicit entry
# script path as CMD args, so the same image supports both modes:
#   cycle: /app/sdk/src/run.ts --auto /worktree forge spec
#   web:   /app/web/src/run.ts
ENTRYPOINT ["npx", "tsx"]
CMD ["/app/sdk/src/run.ts", "--help"]
