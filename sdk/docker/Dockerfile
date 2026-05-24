FROM node:22-bookworm-slim

# Install git (required by claude-agent-sdk for worktree ops)
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*

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
