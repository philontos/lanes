const MAX_RESULT = 200;
const MAX_ARGS = 80;

function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function truncate(s: string, max: number): string {
  const t = oneLine(s);
  return t.length > max ? t.slice(0, max) + "…" : t;
}

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((b: any) => (b?.type === "text" ? b.text ?? "" : "")).join("");
  }
  return "";
}

// Format one SDK message into 0..N CLI-style lines. Empty array = skip.
// `result` is intentionally skipped — run.ts prints the final PHASE RESULT line.
export function formatMessage(m: any): string[] {
  if (!m || typeof m !== "object") return [];

  if (m.type === "assistant") {
    const blocks = m.message?.content;
    if (!Array.isArray(blocks)) return [];
    const lines: string[] = [];
    for (const b of blocks) {
      if (b?.type === "text" && typeof b.text === "string" && b.text.trim()) {
        lines.push(b.text);
      } else if (b?.type === "tool_use") {
        lines.push(`→ ${b.name}(${truncate(JSON.stringify(b.input ?? {}), MAX_ARGS)})`);
      }
    }
    return lines;
  }

  if (m.type === "user") {
    const blocks = m.message?.content;
    if (!Array.isArray(blocks)) return [];
    const lines: string[] = [];
    for (const b of blocks) {
      if (b?.type === "tool_result") {
        lines.push(`  ⤷ ${truncate(resultText(b.content), MAX_RESULT)}`);
      }
    }
    return lines;
  }

  return [];
}
