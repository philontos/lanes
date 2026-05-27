FROM node:22-bookworm-slim

# Install git (claude-agent-sdk worktree ops + cloning plugins below).
# ca-certificates is a *Recommends* of git, skipped by --no-install-recommends, so
# add it explicitly — without it the HTTPS clone fails ("server certificate
# verification failed. CAfile: none").
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Bake every plugin declared in plugins.json into the image (one dir per plugin under
# /opt/lanes/plugins), so runtime is fully self-contained — no host-installed plugin /
# mounted ~/.claude/plugins. Declarative: add a skill = add a line to plugins.json and
# rebuild. The orchestrator loads /opt/lanes/plugins/* via $LANES_PLUGINS. This layer
# is cached unless plugins.json or the installer changes.
COPY plugins.json ./
COPY docker/install-plugins.sh /usr/local/bin/install-plugins.sh
RUN chmod +x /usr/local/bin/install-plugins.sh \
    && /usr/local/bin/install-plugins.sh /app/plugins.json /opt/lanes/plugins
ENV LANES_PLUGINS=/opt/lanes/plugins

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
