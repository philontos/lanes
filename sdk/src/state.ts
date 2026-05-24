import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface LaneState {
  lane: string; cycle_id: string; phase: string;
  status: "ok" | "needs-review" | "blocked" | "done";
  autonomy: "auto" | "manual";
  request?: string; next?: string | null;
  [k: string]: unknown;
}
const file = (dir: string) => join(dir, "state.json");
export function readState(dir: string): LaneState {
  return JSON.parse(readFileSync(file(dir), "utf8"));
}
export function writeState(dir: string, s: LaneState): void {
  writeFileSync(file(dir), JSON.stringify(s, null, 2)); // whole-file overwrite (PROTOCOL convention)
}
