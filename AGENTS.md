# AGENTS.md — lanes repo

Hard constraints for any agent working in this repo (lanes itself). Project-specific
build rules; injected into phase prompts as hard constraints when a lane runs here.

## Robustness & external dependencies
- Validate external resources and preconditions **explicitly at the entry point**, with
  actionable errors — never rely on silent no-op / silent degradation at runtime.
  (e.g. the superpowers plugin is mounted from the host, not baked into the image; a
  missing plugin must fail loudly, not run empty.)
- **Don't pin versions/paths** that the environment owns; resolve the actual installed
  version at runtime and error clearly if absent.
- When a choice is "fail loudly vs swallow the error", **fail loudly** — surfacing a
  problem fast beats pretending success. This complements (does not contradict)
  outcome-first/YAGNI: don't pile on features, but make boundaries solid.

## Self-contained & closed-loop
- Prefer the **cleaner, side-effect-free** option: don't install into the host / global
  locations or mutate other systems' config to make something work.
- Prefer a **self-contained / closed loop**: the artifact carries what it needs to run and
  does **not** break when an external environment changes (something else upgraded,
  uninstalled, or moved). If a dependency can be baked into the image/artifact, do that
  rather than reaching back into host state at runtime. (e.g. superpowers is cloned into
  the Docker image at build, not mounted from the host.)
- These are defaults; accept a compromise only when the self-contained route is
  *significantly* more work — and state the compromise explicitly.

## Conventions
- TypeScript SDK code lives in `sdk/src/`, tests in `sdk/test/` (vitest, ESM, import
  source as `../src/<name>.js`). Keep modules small and pure where practical.
- Per-phase tuning (model / skill(s) / maxTurns / maxThinkingTokens) is config in the
  root `lanes.config.json` — never hardcode it in code.
- Shell scripts: `set -euo pipefail`; quote expansions; prefer absolute paths.
