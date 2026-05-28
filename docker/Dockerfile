FROM node:22-bookworm-slim

# Install git (claude-agent-sdk worktree ops + cloning plugins below).
# ca-certificates is a *Recommends* of git, skipped by --no-install-recommends, so
# add it explicitly — without it the HTTPS clone fails ("server certificate
# verification failed. CAfile: none").
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*

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
