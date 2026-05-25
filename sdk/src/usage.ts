// Per-model token accounting for a lane run. The Agent SDK reports usage broken
// down by model on each phase's `result` message (`result.modelUsage`, keyed by
// model name); this module accumulates those across the phase chain and renders a
// summary table. Kept pure (no SDK import) so it stays trivially testable — the
// SDK's ModelUsage is structurally compatible with the fields we read.

export type ModelUsageTotals = {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  costUSD: number;
};

type PartialUsage = Partial<ModelUsageTotals>;

const ZERO: ModelUsageTotals = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
  costUSD: 0,
};

// Fold one phase's `result.modelUsage` into the accumulator, summing per model.
// Pure: returns a fresh map, never mutates `acc`. A missing/empty `next` (a phase
// that reported no usage) leaves the totals unchanged.
export function mergeModelUsage(
  acc: Record<string, ModelUsageTotals>,
  next: Record<string, PartialUsage> | undefined | null,
): Record<string, ModelUsageTotals> {
  const out: Record<string, ModelUsageTotals> = {};
  for (const [model, u] of Object.entries(acc)) out[model] = { ...u };
  if (!next) return out;
  for (const [model, u] of Object.entries(next)) {
    const base = out[model] ?? { ...ZERO };
    out[model] = {
      inputTokens: base.inputTokens + (u.inputTokens ?? 0),
      outputTokens: base.outputTokens + (u.outputTokens ?? 0),
      cacheReadInputTokens: base.cacheReadInputTokens + (u.cacheReadInputTokens ?? 0),
      cacheCreationInputTokens: base.cacheCreationInputTokens + (u.cacheCreationInputTokens ?? 0),
      costUSD: base.costUSD + (u.costUSD ?? 0),
    };
  }
  return out;
}

const num = (x: number): string => x.toLocaleString("en-US");
const usd = (x: number): string => "$" + x.toFixed(4);

// Render the accumulated totals as an aligned table (one row per model + a total
// row). Returned as a string so callers decide where it goes (we print it, which
// lands in .lane/run.log).
export function formatUsageReport(acc: Record<string, ModelUsageTotals>): string {
  const header = "=== TOKEN USAGE (this run) ===";
  const models = Object.keys(acc).sort();
  if (models.length === 0) return header + "\n(no usage reported)";

  const cols = ["model", "input", "output", "cache_read", "cache_write", "cost"];
  const total: ModelUsageTotals = { ...ZERO };
  const rows: string[][] = [];
  for (const m of models) {
    const u = acc[m];
    total.inputTokens += u.inputTokens;
    total.outputTokens += u.outputTokens;
    total.cacheReadInputTokens += u.cacheReadInputTokens;
    total.cacheCreationInputTokens += u.cacheCreationInputTokens;
    total.costUSD += u.costUSD;
    rows.push([m, num(u.inputTokens), num(u.outputTokens), num(u.cacheReadInputTokens), num(u.cacheCreationInputTokens), usd(u.costUSD)]);
  }
  const totalRow = ["total", num(total.inputTokens), num(total.outputTokens), num(total.cacheReadInputTokens), num(total.cacheCreationInputTokens), usd(total.costUSD)];

  const grid = [cols, ...rows, totalRow];
  const widths = cols.map((_, i) => Math.max(...grid.map((r) => r[i].length)));
  const fmt = (r: string[]): string =>
    r.map((cell, i) => (i === 0 ? cell.padEnd(widths[i]) : cell.padStart(widths[i]))).join("  ");
  const sep = "─".repeat(widths.reduce((a, b) => a + b, 0) + (cols.length - 1) * 2);

  return [header, fmt(cols), ...rows.map(fmt), sep, fmt(totalRow)].join("\n");
}
