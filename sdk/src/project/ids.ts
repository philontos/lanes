// Stable, never-reused IDs for project entities. The numeric portion is monotonic
// per project (tracked via next_id_seq in features.json / backlog.json); we pad to
// 4 digits for sort/scan friendliness but accept any width >= 4 so a long-lived
// project that crosses 9999 still works.

export type IdPrefix = "feature" | "item";

export function nextId(prefix: IdPrefix, nextSeq: number): { id: string; nextSeq: number } {
  const id = `${prefix}-${String(nextSeq).padStart(4, "0")}`;
  return { id, nextSeq: nextSeq + 1 };
}

export function parseId(id: string): { prefix: IdPrefix; seq: number } | null {
  const m = /^(feature|item)-(\d{4,})$/.exec(id);
  if (!m) return null;
  return { prefix: m[1] as IdPrefix, seq: parseInt(m[2], 10) };
}
