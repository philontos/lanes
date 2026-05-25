# Auto Big-Scenario Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make auto mode run a full `spec → plan → impl → review` chain in one unattended run from any project dir via a global `lanes` command, with all tools open inside the container.

**Architecture:** Generalize the orchestrator from one hardcoded spec phase to a phase chain: `skillsForPhase`/`PHASES` (phases.ts) + a pure `buildPhasePrompt` (new prompts.ts) resolve each phase's skill(s) from `skills.json` and emit an English prompt; `runLane` (orchestrator.ts) loops the phases as separate `query()` sessions, threading artifacts through `.lane/`; `canUseTool` opens all tools; `setup.sh` installs a `~/.local/bin/lanes` launcher defaulting the worktree to `$PWD`.

**Tech Stack:** TypeScript (ESM, `tsx`), vitest, `@anthropic-ai/claude-agent-sdk`, Bash, Docker.

Reference spec: `docs/superpowers/specs/2026-05-25-auto-big-scenario-design.md`

**File map:**
- `sdk/src/phases.ts` — add `PHASES` + `skillsForPhase` (next to existing `resolveModel`).
- `sdk/src/prompts.ts` (new) — `PHASE_IO` + pure `buildPhasePrompt`.
- `sdk/src/canUseTool.ts` — open all tools; keep AskUserQuestion→judge.
- `sdk/src/orchestrator.ts` — `runPhase` uses `buildPhasePrompt`; add `runLane`.
- `sdk/src/run.ts` — call `runLane`.
- `sdk/docker/run-auto.sh` — seed only scratch dirs with a placeholder AGENTS.md.
- `sdk/docker/setup.sh` — install global `lanes` launcher + PATH hint.
- `README.md` — global usage, open-perms, roadmap.

Note: `sdk/src/state.ts` already exposes `readState`/`writeState` (whole-file) — no change needed.

---

### Task 1: `phases.ts` — PHASES + skillsForPhase

**Files:**
- Modify: `sdk/src/phases.ts`
- Test: `sdk/test/phases.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `sdk/test/phases.test.ts` (keep the existing `resolveModel` tests):

```ts
import { PHASES, skillsForPhase } from "../src/phases.js";

const skillsMap = {
  skills: {
    discover: "superpowers:brainstorming",
    plan: "superpowers:writing-plans",
    execute: "superpowers:executing-plans",
    tdd: "superpowers:test-driven-development",
    verify: "superpowers:verification-before-completion",
    parallel: "superpowers:dispatching-parallel-agents",
  },
  usage: {
    spec: ["discover"],
    plan: ["plan"],
    impl: ["execute", "tdd", "verify", "parallel"],
    review: [],
  },
};

describe("PHASES", () => {
  it("is the fixed forge chain for this cut", () => {
    expect(PHASES).toEqual(["spec", "plan", "impl", "review"]);
  });
});

describe("skillsForPhase", () => {
  it("resolves usage roles to concrete skill names", () => {
    expect(skillsForPhase(skillsMap, "spec")).toEqual(["superpowers:brainstorming"]);
    expect(skillsForPhase(skillsMap, "plan")).toEqual(["superpowers:writing-plans"]);
    expect(skillsForPhase(skillsMap, "impl")).toEqual([
      "superpowers:executing-plans",
      "superpowers:test-driven-development",
      "superpowers:verification-before-completion",
      "superpowers:dispatching-parallel-agents",
    ]);
  });
  it("returns [] for a phase with no usage roles (e.g. review)", () => {
    expect(skillsForPhase(skillsMap, "review")).toEqual([]);
  });
  it("returns [] for an unknown phase or missing maps", () => {
    expect(skillsForPhase(skillsMap, "mystery")).toEqual([]);
    expect(skillsForPhase({}, "spec")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run (from `sdk/`): `npx vitest run test/phases.test.ts`
Expected: FAIL — `PHASES`/`skillsForPhase` not exported.

- [ ] **Step 3: Implement**

Edit `sdk/src/phases.ts` to add (keep `resolveModel` as-is):

```ts
export const PHASES = ["spec", "plan", "impl", "review"] as const;

// Resolve a phase's skill(s) from skills.json: usage[phase] -> roles -> skills[role].
export function skillsForPhase(skills: any, phase: string): string[] {
  const roles: string[] = skills?.usage?.[phase] ?? [];
  return roles.map((r) => skills?.skills?.[r]).filter((s): s is string => typeof s === "string");
}
```

- [ ] **Step 4: Run, verify pass**

Run (from `sdk/`): `npx vitest run test/phases.test.ts`
Expected: PASS (existing resolveModel cases + new ones).

- [ ] **Step 5: Commit**

```bash
git add sdk/src/phases.ts sdk/test/phases.test.ts
git commit -m "feat(sdk): PHASES + skillsForPhase (resolve phase skills from skills.json)"
```

---

### Task 2: `prompts.ts` — PHASE_IO + buildPhasePrompt (English)

**Files:**
- Create: `sdk/src/prompts.ts`
- Test: `sdk/test/prompts.test.ts`

- [ ] **Step 1: Write failing test**

Create `sdk/test/prompts.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildPhasePrompt } from "../src/prompts.js";

const skills = {
  skills: {
    discover: "superpowers:brainstorming",
    plan: "superpowers:writing-plans",
    execute: "superpowers:executing-plans",
    tdd: "superpowers:test-driven-development",
    verify: "superpowers:verification-before-completion",
    parallel: "superpowers:dispatching-parallel-agents",
  },
  usage: { spec: ["discover"], plan: ["plan"], impl: ["execute", "tdd", "verify", "parallel"], review: [] },
};
const base = { skills, request: "add a /healthz endpoint", agentsMd: "" };

describe("buildPhasePrompt", () => {
  it("spec: names brainstorming, embeds request, targets spec.md", () => {
    const p = buildPhasePrompt("spec", base);
    expect(p).toContain("superpowers:brainstorming");
    expect(p).toContain("add a /healthz endpoint");
    expect(p).toContain(".lane/spec.md");
  });
  it("plan: names writing-plans, reads spec.md, writes plan.md", () => {
    const p = buildPhasePrompt("plan", base);
    expect(p).toContain("superpowers:writing-plans");
    expect(p).toContain(".lane/spec.md");
    expect(p).toContain(".lane/plan.md");
  });
  it("impl: names executing-plans and allows Bash for code changes", () => {
    const p = buildPhasePrompt("impl", base);
    expect(p).toContain("superpowers:executing-plans");
    expect(p).toContain("Bash");
  });
  it("review: built-in self-review (no skill), writes review.md", () => {
    const p = buildPhasePrompt("review", base);
    expect(p).toContain("self-review");
    expect(p).toContain(".lane/review.md");
  });
  it("renders AGENTS.md, or (none) when empty", () => {
    expect(buildPhasePrompt("spec", base)).toContain("(none)");
    expect(buildPhasePrompt("spec", { ...base, agentsMd: "keep it tiny" })).toContain("keep it tiny");
  });
  it("is English (no CJK characters)", () => {
    expect(/[一-鿿]/.test(buildPhasePrompt("impl", base))).toBe(false);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run (from `sdk/`): `npx vitest run test/prompts.test.ts`
Expected: FAIL — cannot resolve `../src/prompts.js`.

- [ ] **Step 3: Implement**

Create `sdk/src/prompts.ts`:

```ts
import { skillsForPhase } from "./phases.js";

interface PromptCtx { skills: any; request: string; agentsMd: string }

const PHASE_IO: Record<string, { reads: string; writes: string }> = {
  spec: {
    reads: "the request below and the AGENTS.md constraints",
    writes: ".lane/spec.md (goal, scope in/out, files to change, success criteria, risks)",
  },
  plan: {
    reads: ".lane/spec.md",
    writes: ".lane/plan.md (bite-sized, testable steps)",
  },
  impl: {
    reads: ".lane/plan.md and .lane/spec.md",
    writes: "the actual code changes in the working directory; use Bash to run builds/tests",
  },
  review: {
    reads: "the git diff so far, plus .lane/spec.md and .lane/plan.md",
    writes: ".lane/review.md, and fix any correctness or scope issues you find",
  },
};

// Pure: builds the English instruction handed to the per-phase Agent SDK session.
export function buildPhasePrompt(phase: string, ctx: PromptCtx): string {
  const skillNames = skillsForPhase(ctx.skills, phase);
  const io = PHASE_IO[phase] ?? { reads: "the prior .lane/ artifacts", writes: "the next .lane/ artifact" };
  return [
    `You are running the "${phase}" phase of the forge lane. No human is present.`,
    `Original request: ${ctx.request || "(none)"}`,
    skillNames.length
      ? `Use these skills for this phase: ${skillNames.join(", ")}.`
      : `No skill is mapped for this phase — do a built-in self-review pass.`,
    `Read: ${io.reads}.`,
    `Produce: ${io.writes}.`,
    "=== AGENTS.md (hard constraints) ===",
    ctx.agentsMd || "(none)",
    "Constraints: AskUserQuestion is auto-answered by the operator judge per principles.md.",
    "All tools are available, including Bash. Keep changes scoped to the request.",
  ].join("\n");
}
```

- [ ] **Step 4: Run, verify pass**

Run (from `sdk/`): `npx vitest run test/prompts.test.ts`
Expected: PASS (6 cases).

- [ ] **Step 5: Commit**

```bash
git add sdk/src/prompts.ts sdk/test/prompts.test.ts
git commit -m "feat(sdk): buildPhasePrompt — per-phase English prompts from skills.json"
```

---

### Task 3: `canUseTool.ts` — open all tools

**Files:**
- Modify: `sdk/src/canUseTool.ts`
- Test: `sdk/test/canUseTool.test.ts`

- [ ] **Step 1: Update tests to the new policy**

Replace the entire body of `sdk/test/canUseTool.test.ts` with:

```ts
import { describe, it, expect, vi } from "vitest";
import { makeCanUseTool } from "../src/canUseTool.js";

const opts = { signal: new AbortController().signal, toolUseID: "t1" } as any;

describe("makeCanUseTool (container = boundary; tools open)", () => {
  it("routes AskUserQuestion to the judge and returns answers", async () => {
    const fakeJudge = vi.fn(async () => ({ "Q?": "A" }));
    const cb = makeCanUseTool("principles", { judgeFn: fakeJudge as any });
    const res = await cb("AskUserQuestion", { questions: [{ question: "Q?", header: "q", options: [{ label: "A", description: "" }], multiSelect: false }] }, opts);
    expect(res.behavior).toBe("allow");
    expect((res as any).updatedInput.answers).toEqual({ "Q?": "A" });
    expect(fakeJudge).toHaveBeenCalledOnce();
  });
  it("allows file tools unchanged", async () => {
    const cb = makeCanUseTool("p", { judgeFn: vi.fn() as any });
    expect((await cb("Read", { file_path: "/x" }, opts)).behavior).toBe("allow");
  });
  it("allows Bash now (Docker is the isolation boundary)", async () => {
    const cb = makeCanUseTool("p", { judgeFn: vi.fn() as any });
    expect((await cb("Bash", { command: "npm test" }, opts)).behavior).toBe("allow");
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run (from `sdk/`): `npx vitest run test/canUseTool.test.ts`
Expected: FAIL — current code denies Bash.

- [ ] **Step 3: Implement**

Replace `sdk/src/canUseTool.ts` with:

```ts
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { judge as defaultJudge, type Answers, type AskQuestion } from "./judge.js";

type Result = { behavior: "allow"; updatedInput?: Record<string, unknown> } | { behavior: "deny"; message: string };
interface Deps { judgeFn?: (q: AskQuestion[], p: string) => Promise<Answers>; logPath?: string }

// Auto mode runs inside Docker — the container is the isolation boundary, so all
// tools are allowed. AskUserQuestion is still answered by the operator judge.
export function makeCanUseTool(principles: string, deps: Deps = {}) {
  const judgeFn = deps.judgeFn ?? defaultJudge;
  return async (toolName: string, input: any, _opts: unknown): Promise<Result> => {
    if (toolName === "AskUserQuestion") {
      const answers = await judgeFn(input.questions, principles);
      if (deps.logPath) {
        mkdirSync(dirname(deps.logPath), { recursive: true });
        appendFileSync(deps.logPath, `[ask] ${JSON.stringify(answers)}\n`);
      }
      return { behavior: "allow", updatedInput: { questions: input.questions, answers } };
    }
    return { behavior: "allow", updatedInput: input };
  };
}
```

- [ ] **Step 4: Run, verify pass**

Run (from `sdk/`): `npx vitest run test/canUseTool.test.ts`
Expected: PASS (3 cases).

- [ ] **Step 5: Commit**

```bash
git add sdk/src/canUseTool.ts sdk/test/canUseTool.test.ts
git commit -m "feat(sdk): open all tools in container (Docker is the boundary)"
```

---

### Task 4: `orchestrator.ts` — runPhase uses buildPhasePrompt; add runLane

**Files:**
- Modify: `sdk/src/orchestrator.ts`
- Test: `sdk/test/orchestrator.test.ts` (new)

- [ ] **Step 1: Write failing test for runLane (stubbed runner)**

Create `sdk/test/orchestrator.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLane } from "../src/orchestrator.js";

function tmpLane() {
  const wt = join(mkdtempSync(join(tmpdir(), "lane-")), "cycle");
  mkdirSync(join(wt, ".lane"), { recursive: true });
  writeFileSync(join(wt, ".lane", "state.json"), JSON.stringify({ lane: "forge", cycle_id: "c1", phase: "spec", status: "ok", autonomy: "auto", request: "do x" }));
  return wt;
}
const baseOpts = (wt: string) => ({ worktreeDir: wt, commandsDir: "/unused", lane: "forge", principlesPath: "/unused" });

describe("runLane", () => {
  it("runs phases in order and marks done on success", async () => {
    const wt = tmpLane();
    const seen: string[] = [];
    const stub = vi.fn(async (o: any) => { seen.push(o.phase); return { subtype: "success" }; });
    await runLane(baseOpts(wt), { runPhase: stub as any });
    expect(seen).toEqual(["spec", "plan", "impl", "review"]);
    expect(JSON.parse(readFileSync(join(wt, ".lane", "state.json"), "utf8")).status).toBe("done");
  });
  it("stops at the first failing phase and marks blocked", async () => {
    const wt = tmpLane();
    const seen: string[] = [];
    const stub = vi.fn(async (o: any) => { seen.push(o.phase); return { subtype: o.phase === "impl" ? "error" : "success" }; });
    const res = await runLane(baseOpts(wt), { runPhase: stub as any });
    expect(seen).toEqual(["spec", "plan", "impl"]);
    expect((res as any).subtype).toBe("error");
    const st = JSON.parse(readFileSync(join(wt, ".lane", "state.json"), "utf8"));
    expect(st.phase).toBe("impl");
    expect(st.status).toBe("blocked");
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run (from `sdk/`): `npx vitest run test/orchestrator.test.ts`
Expected: FAIL — `runLane` not exported.

- [ ] **Step 3: Implement**

Edit `sdk/src/orchestrator.ts`. Update imports at the top — replace the readState import line and add new imports:

```ts
import { query } from "@anthropic-ai/claude-agent-sdk";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readState, writeState } from "./state.js";
import { resolveModel, PHASES } from "./phases.js";
import { buildPhasePrompt } from "./prompts.js";
import { makeCanUseTool } from "./canUseTool.js";
```

Delete the `buildSpecPrompt` function entirely. In `runPhase`, replace the prompt line:

```ts
  // was: const prompt = buildSpecPrompt(String(state.request ?? ""), agentsMd);
  const prompt = buildPhasePrompt(opts.phase, { skills, request: String(state.request ?? ""), agentsMd });
```

In the `query({...})` options, drop the `denyLogPath` argument (keep `logPath`):

```ts
      canUseTool: makeCanUseTool(principles, { logPath: join(laneDir, "decision-log.md") }),
```

Append `runLane` at the end of the file:

```ts
// Drives the phase chain (one run = spec -> plan -> impl -> review). Each phase is
// a separate runPhase session; artifacts thread through .lane/. Stops on failure.
export async function runLane(
  opts: { worktreeDir: string; commandsDir: string; lane: string; principlesPath: string; startPhase?: string },
  deps: { runPhase?: (o: any) => Promise<any> } = {},
) {
  const run = deps.runPhase ?? runPhase;
  const laneDir = join(opts.worktreeDir, ".lane");
  const startIdx = Math.max(0, PHASES.indexOf((opts.startPhase ?? PHASES[0]) as any));
  let last: any;
  for (const phase of PHASES.slice(startIdx)) {
    writeState(laneDir, { ...readState(laneDir), phase, status: "ok" });
    last = await run({ worktreeDir: opts.worktreeDir, commandsDir: opts.commandsDir, lane: opts.lane, phase, principlesPath: opts.principlesPath });
    if ((last as any)?.subtype !== "success") {
      writeState(laneDir, { ...readState(laneDir), phase, status: "blocked" });
      return last;
    }
  }
  writeState(laneDir, { ...readState(laneDir), status: "done" });
  return last;
}
```

- [ ] **Step 4: Run tests + typecheck**

Run (from `sdk/`): `npx vitest run test/orchestrator.test.ts` → PASS (2 cases).
Run (from `sdk/`): `npx tsc --noEmit` → exit 0.

- [ ] **Step 5: Commit**

```bash
git add sdk/src/orchestrator.ts sdk/test/orchestrator.test.ts
git commit -m "feat(sdk): runLane chains spec→plan→impl→review; runPhase uses buildPhasePrompt"
```

---

### Task 5: `run.ts` — drive the chain

**Files:**
- Modify: `sdk/src/run.ts`

- [ ] **Step 1: Edit run.ts**

Replace the body of `sdk/src/run.ts` with:

```ts
import { runLane } from "./orchestrator.js";

// usage: tsx src/run.ts --auto <worktreeDir> [lane] [phase]
const args = process.argv.slice(2);
const auto = args.includes("--auto");
const [worktreeDir, lane = "forge", phase = "spec"] = args.filter((a) => !a.startsWith("--"));
if (!auto || !worktreeDir) { console.error("usage: run.ts --auto <worktreeDir> [lane] [phase]"); process.exit(1); }

try {
  const res = await runLane({
    worktreeDir,
    commandsDir: `${process.env.HOME}/.claude/commands`,
    lane,
    principlesPath: `${process.env.HOME}/Develop/personal/lanes/principles.md`,
    startPhase: phase,
  });
  console.log("LANE RESULT:", (res as any)?.subtype);
  if ((res as any)?.subtype !== "success") process.exit(1);
} catch (e) {
  console.error("LANE ERROR:", e);
  process.exit(1);
}
```

- [ ] **Step 2: Typecheck + full suite**

Run (from `sdk/`): `npx tsc --noEmit` → exit 0.
Run (from `sdk/`): `npx vitest run` → all pass (phases, prompts, canUseTool, orchestrator, streamLog, state, judge).

- [ ] **Step 3: Commit**

```bash
git add sdk/src/run.ts
git commit -m "feat(sdk): run.ts drives the full lane chain via runLane"
```

---

### Task 6: `run-auto.sh` — don't fabricate AGENTS.md in real project dirs

**Files:**
- Modify: `sdk/docker/run-auto.sh`

- [ ] **Step 1: Edit the AGENTS.md block**

In `sdk/docker/run-auto.sh`, find:

```bash
# ── AGENTS.md ─────────────────────────────────────────────────────────────────
if [[ ! -f "$WT/AGENTS.md" ]]; then
  cat > "$WT/AGENTS.md" <<'EOF'
project rules: keep it tiny.
EOF
fi
```

Replace with (only seed a placeholder in scratch mode — i.e. when no worktree arg was given):

```bash
# ── AGENTS.md ─────────────────────────────────────────────────────────────────
# Only seed a placeholder in scratch mode (no worktree arg). Never fabricate an
# AGENTS.md inside a real project dir — if absent, the agent proceeds with none.
if [[ -z "${2:-}" && ! -f "$WT/AGENTS.md" ]]; then
  cat > "$WT/AGENTS.md" <<'EOF'
project rules: keep it tiny.
EOF
fi
```

- [ ] **Step 2: Syntax check**

Run: `bash -n /Users/wangyuhao/Develop/personal/lanes/sdk/docker/run-auto.sh && echo OK`
Expected: prints `OK`.

- [ ] **Step 3: Verify behavior with a quick simulation (no Docker)**

Run:
```bash
cd /tmp && rm -rf lanes-t6 && mkdir -p lanes-t6 && cd lanes-t6
# simulate "real project dir" arg present: AGENTS.md must NOT be created
WT="$PWD"; if [[ -z "/tmp/lanes-t6" && ! -f "$WT/AGENTS.md" ]]; then echo "would-create"; else echo "skipped (real dir)"; fi
ls AGENTS.md 2>/dev/null || echo "no AGENTS.md (correct for real dir)"
```
Expected: `skipped (real dir)` and `no AGENTS.md (correct for real dir)`.

- [ ] **Step 4: Commit**

```bash
git add sdk/docker/run-auto.sh
git commit -m "fix(sdk): only seed placeholder AGENTS.md in scratch mode, not real project dirs"
```

---

### Task 7: `setup.sh` — install global `lanes` launcher

**Files:**
- Modify: `sdk/docker/setup.sh`

- [ ] **Step 1: Add the launcher-install section before the final "Done" message**

In `sdk/docker/setup.sh`, locate the build section end and the final block:

```bash
docker build -t lanes-sdk-orchestrator:latest -f "$SCRIPT_DIR/Dockerfile" "$SDK_DIR"

echo ""
echo "Done. Next:"
```

Insert a new section between the `docker build ...` line and the `echo ""` / `echo "Done. Next:"` block:

```bash
docker build -t lanes-sdk-orchestrator:latest -f "$SCRIPT_DIR/Dockerfile" "$SDK_DIR"

# ── 5. Global launcher ───────────────────────────────────────────────────────
REPO_DIR="$(cd "$SDK_DIR/.." && pwd)"
BIN_DIR="$HOME/.local/bin"
LAUNCHER="$BIN_DIR/lanes"
mkdir -p "$BIN_DIR"
cat > "$LAUNCHER" <<EOF
#!/usr/bin/env bash
# lanes — global entry for auto mode. Generated by setup.sh; edits are overwritten.
set -euo pipefail
REPO="$REPO_DIR"
if [[ \$# -eq 1 ]]; then
  exec "\$REPO/run.sh" "\$1" "\$PWD"
else
  exec "\$REPO/run.sh" "\$@"
fi
EOF
chmod +x "$LAUNCHER"
echo "✓ Installed global command: $LAUNCHER"
case ":$PATH:" in
  *":$BIN_DIR:"*) : ;;
  *)
    echo "  NOTE: $BIN_DIR is not on your PATH. Add this to your shell rc (e.g. ~/.zshrc):"
    echo "        export PATH=\"\$HOME/.local/bin:\$PATH\""
    ;;
esac

echo ""
echo "Done. Next:"
```

Then update the example lines in that final block to use the global command. Replace:

```bash
echo "  ./sdk/docker/run-auto.sh \"<your request>\""
echo ""
echo "Example:"
echo "  ./sdk/docker/run-auto.sh \"add a /healthz endpoint returning 200 OK\""
```

with:

```bash
echo "  lanes \"<your request>\"        # from any project directory"
echo ""
echo "Example:"
echo "  cd ~/your/project && lanes \"add a /healthz endpoint returning 200 OK\""
```

- [ ] **Step 2: Syntax check**

Run: `bash -n /Users/wangyuhao/Develop/personal/lanes/sdk/docker/setup.sh && echo OK`
Expected: prints `OK`.

- [ ] **Step 3: Verify the generated launcher content (isolated, no Docker)**

Run (reproduces just the launcher-writing logic with a fake repo + temp HOME):
```bash
T="$(mktemp -d)"; REPO_DIR="/abs/lanes"; BIN_DIR="$T/.local/bin"; LAUNCHER="$BIN_DIR/lanes"; mkdir -p "$BIN_DIR"
cat > "$LAUNCHER" <<EOF
#!/usr/bin/env bash
# lanes — global entry for auto mode. Generated by setup.sh; edits are overwritten.
set -euo pipefail
REPO="$REPO_DIR"
if [[ \$# -eq 1 ]]; then
  exec "\$REPO/run.sh" "\$1" "\$PWD"
else
  exec "\$REPO/run.sh" "\$@"
fi
EOF
chmod +x "$LAUNCHER"
echo "--- generated launcher ---"; cat "$LAUNCHER"
bash -n "$LAUNCHER" && echo "launcher syntax OK"
test -x "$LAUNCHER" && echo "executable OK"
grep -q 'REPO="/abs/lanes"' "$LAUNCHER" && echo "repo path baked OK"
grep -q 'exec "\$REPO/run.sh" "\$1" "\$PWD"' "$LAUNCHER" && echo "PWD default OK"
rm -rf "$T"
```
Expected: launcher prints with `REPO="/abs/lanes"`, and all four `... OK` lines appear (`$#`, `$REPO`, `$1`, `$PWD` stayed literal in the generated file).

- [ ] **Step 4: Commit**

```bash
git add sdk/docker/setup.sh
git commit -m "feat(sdk): setup.sh installs global ~/.local/bin/lanes launcher (defaults worktree to \$PWD)"
```

---

### Task 8: README — global usage, open perms, roadmap

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the Run section**

In `README.md`, replace the `## Run` section body (from `## Run` down to just before `## Layout`) with:

````markdown
## Run

Install once (`./setup.sh`) puts a `lanes` command on your PATH. From any project:

```bash
cd ~/your/project
lanes "build a 0→1 MVP that …"     # or a big refactor / a set of key features
```

`lanes "<request>"` defaults the worktree to the current directory; the chain
`spec → plan → impl → review` runs unattended (the operator judge auto-answers any
prompts per `principles.md`), streaming a live activity log. Artifacts land in
`.lane/` (`spec.md`, `plan.md`, `review.md`) and code changes land directly in the
working directory.

Pass an explicit directory to override the default:

```bash
lanes "refactor the auth module" ~/worktrees/my-feature
```

From inside this repo you can also use `./run.sh "<request>" [dir]` (defaults to a
throwaway scratch dir when no directory is given).

> Auto mode targets **large, structured work**. Quick one-off edits are better done
> directly in the interactive Claude Code CLI.
>
> Tools inside the container are fully open (including `Bash`) — Docker is the
> isolation boundary. The target directory is mounted read-write, so the agent can
> modify or delete files there.
````

- [ ] **Step 2: Update the Roadmap section**

In `README.md`, replace the `## Roadmap` list with:

```markdown
## Roadmap

- `ship` phase: real git worktree + branch + PR/MR per cycle.
- Human checkpoints: pause after `spec`/`plan` for approval, then resume.
- Externalize phase prompts into the mounted `commands/forge/*.md` (no image rebuild to tweak).
- Wire the sprint and compass lanes into auto mode.
- Failure recovery (`status: blocked`), retries, multi-cycle scheduling, cross-cycle memory.
```

- [ ] **Step 3: Fix the "How it works" / "The lanes" capability note**

In `README.md`, update the capability caveat (currently "Auto mode currently drives forge's `spec` phase…") to reflect the new chain. Replace that blockquote with:

```markdown
> Auto mode drives forge's `spec → plan → impl → review` chain. The `ship` phase
> (branch + PR/MR) and the sprint/compass lanes are not yet wired in — see
> [Roadmap](#roadmap).
```

Also update step 4 of "How it works" (which says the phase writes `.lane/spec.md`) to: "Each phase writes its artifact under `.lane/` (`spec.md`, `plan.md`, `review.md`); `impl` writes code changes into the working directory."

- [ ] **Step 4: Verify**

Run: `grep -nE 'spec phase only|spec-phase' /Users/wangyuhao/Develop/personal/lanes/README.md`
Expected: no matches (the old spec-only caveat is gone).
Run: `grep -nE 'lanes "|spec → plan → impl → review' /Users/wangyuhao/Develop/personal/lanes/README.md`
Expected: matches present (global usage + new chain documented).
Read the README top-to-bottom once to confirm coherence.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: README for big-scenario auto (global lanes, full chain, open perms)"
```

---

## Self-Review notes

- **Spec coverage:** phase chain → Task 4 (runLane) + Task 5 (run.ts); per-phase prompts from skills.json → Task 1 (skillsForPhase) + Task 2 (buildPhasePrompt); open perms → Task 3; global `lanes` + `$PWD` default → Task 7; no fabricated AGENTS.md → Task 6; README/roadmap → Task 8. `state.ts` already supports phase/status updates (no task needed). ship/gates/externalized-prompts correctly deferred to Roadmap (Task 8).
- **Type consistency:** `skillsForPhase(skills, phase): string[]` (Task 1) consumed by `buildPhasePrompt` (Task 2) and tested identically. `runLane(opts, deps)` (Task 4) consumed by `run.ts` (Task 5) with matching `startPhase`. `PHASES` shared from phases.ts. `makeCanUseTool` Deps drops `denyLogPath` (Task 3) and Task 4 stops passing it — consistent.
- **Placeholder scan:** every code step has full code; shell steps have exact commands + expected output; no TBD/TODO.
