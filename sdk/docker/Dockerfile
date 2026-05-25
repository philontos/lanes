FROM node:22-bookworm-slim

# Install git (claude-agent-sdk worktree ops + cloning superpowers below).
# ca-certificates is a *Recommends* of git, skipped by --no-install-recommends, so
# add it explicitly — without it the HTTPS clone fails ("server certificate
# verification failed. CAfile: none").
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*

# Bake the superpowers skills into the image so runtime is fully self-contained — no
# dependency on a host-installed plugin / mounted ~/.claude/plugins. The orchestrator
# loads this path via LANES_SUPERPOWERS (see resolveSuperpowers).
RUN git clone --depth 1 https://github.com/obra/superpowers.git /opt/lanes/superpowers \
    && rm -rf /opt/lanes/superpowers/.git
ENV LANES_SUPERPOWERS=/opt/lanes/superpowers

WORKDIR /app

# Copy manifests first for layer caching
COPY package.json package-lock.json ./

# Install Linux-native dependencies (NOT from host — host has macOS/arm64 binaries)
RUN npm ci

# Copy source
COPY src/ ./src/
COPY tsconfig.json ./

# tsx is a devDependency — it's already installed by npm ci above.
# Verify it's accessible
RUN npx tsx --version

# Container does not run as root in production, but for exploratory infra keep defaults.
# The caller passes CLAUDE_CODE_OAUTH_TOKEN via -e; no token is baked in.

ENTRYPOINT ["npx", "tsx", "src/run.ts"]
CMD ["--help"]
