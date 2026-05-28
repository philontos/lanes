// lanes web — single-page app. Vanilla JS, hash routing, no dependencies.
//
// Routes:
//   #/                          workspace (list of projects, import, init)
//   #/p/:name                   project view (5 layers + backlog + cycles)
//   #/p/:name/c/:cycleId        cycle view (live SSE log or past log)

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const view = $("#view");
const crumb = $("#crumb");
const wsPathEl = $("#ws-path");

// ── Utilities ─────────────────────────────────────────────────────────────
const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k === "html") e.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of children) {
    if (c == null) continue;
    if (Array.isArray(c)) c.forEach((cc) => cc && e.appendChild(cc));
    else if (typeof c === "string") e.appendChild(document.createTextNode(c));
    else e.appendChild(c);
  }
  return e;
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
    body: opts.body && typeof opts.body !== "string" ? JSON.stringify(opts.body) : opts.body,
  });
  const isJson = res.headers.get("content-type")?.includes("application/json");
  const body = isJson ? await res.json() : await res.text();
  if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
  return body;
}

let toastTimer = 0;
function toast(msg, isError = false) {
  let t = $(".toast");
  if (!t) { t = el("div", { class: "toast" }); document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.toggle("err", isError);
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2800);
}

function setBusy(on) {
  view.setAttribute("aria-busy", on ? "true" : "false");
}

// ── Tiny markdown renderer (headings, paragraphs, lists, inline code) ──
function renderMd(md) {
  if (!md.trim()) return el("div", { class: "muted placeholder" }, "(empty)");
  const root = el("div", { class: "markdown" });
  const blocks = md.replace(/\r\n/g, "\n").split(/\n\s*\n/);
  for (const blockRaw of blocks) {
    const block = blockRaw.trim();
    if (!block) continue;
    // Heading
    const h = /^(#{1,3})\s+(.+)$/m.exec(block);
    if (h && block.split("\n").length === 1) {
      const level = h[1].length;
      root.appendChild(el("h" + Math.max(2, level), { html: inlineMd(h[2]) }));
      continue;
    }
    // Multi-line: maybe each line is a list item starting with - or *
    if (/^[-*]\s+/.test(block.split("\n")[0])) {
      const ul = el("ul");
      for (const line of block.split("\n")) {
        const m = /^[-*]\s+(.*)$/.exec(line);
        if (m) ul.appendChild(el("li", { html: inlineMd(m[1]) }));
        else if (line.trim()) {
          // continuation line: append to last li
          const last = ul.lastElementChild;
          if (last) last.insertAdjacentHTML("beforeend", " " + inlineMd(line.trim()));
        }
      }
      root.appendChild(ul);
      continue;
    }
    // Inline heading within block (e.g. "## Goal\nbody"): split it
    if (/^##\s/.test(block)) {
      const lines = block.split("\n");
      const headLine = lines.shift();
      const hm = /^(#{1,3})\s+(.+)$/.exec(headLine);
      if (hm) root.appendChild(el("h" + Math.max(2, hm[1].length), { html: inlineMd(hm[2]) }));
      if (lines.length) root.appendChild(el("p", { html: inlineMd(lines.join(" ")) }));
      continue;
    }
    // Paragraph
    const isPlaceholder = /^\(\s*(none yet|TBD)/i.test(block);
    const p = el("p", { html: inlineMd(block.replace(/\n/g, " ")) });
    if (isPlaceholder) p.className = "placeholder";
    root.appendChild(p);
  }
  return root;
}
function inlineMd(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

// ── Routing ───────────────────────────────────────────────────────────────
function parseRoute() {
  const hash = location.hash.replace(/^#/, "") || "/";
  const parts = hash.split("/").filter(Boolean);
  if (parts.length === 0) return { name: "workspace" };
  if (parts[0] === "p" && parts.length === 2) return { name: "project", project: decodeURIComponent(parts[1]) };
  if (parts[0] === "p" && parts.length === 4 && parts[2] === "c") {
    return { name: "cycle", project: decodeURIComponent(parts[1]), cycle: decodeURIComponent(parts[3]) };
  }
  return { name: "workspace" };
}
window.addEventListener("hashchange", render);
window.addEventListener("load", render);

function setCrumb(parts) {
  crumb.innerHTML = "";
  parts.forEach((p, i) => {
    if (i > 0) crumb.appendChild(el("span", { class: "sep" }, "›"));
    if (p.href) crumb.appendChild(el("a", { href: p.href }, p.label));
    else crumb.appendChild(el("span", {}, p.label));
  });
}

// ── Workspace view ────────────────────────────────────────────────────────
async function renderWorkspace() {
  setCrumb([{ label: "workspace" }]);
  setBusy(true);
  view.innerHTML = "";
  try {
    const ws = await api("/api/workspace");
    wsPathEl.textContent = ws.workspace;

    view.appendChild(el("div", { class: "section-title" }, "Import"));
    const urlInput = el("input", { type: "url", placeholder: "git@github.com:foo/bar.git  or  https://github.com/foo/bar" });
    const importBtn = el("button", { class: "primary", onclick: async () => {
      if (!urlInput.value.trim()) return;
      importBtn.disabled = true; importBtn.innerHTML = '<span class="spinner"></span>cloning…';
      try {
        const r = await api("/api/projects/import", { method: "POST", body: { url: urlInput.value.trim() } });
        toast(`imported ${r.name}`);
        urlInput.value = "";
        await renderWorkspace();
      } catch (e) { toast(e.message, true); }
      finally { importBtn.disabled = false; importBtn.textContent = "Import"; }
    }}, "Import");
    view.appendChild(el("div", { class: "section" }, el("div", { class: "row gap-2" }, urlInput, importBtn)));

    view.appendChild(el("div", { class: "section-title" }, "Projects"));
    if (!ws.projects.length) {
      view.appendChild(el("div", { class: "section" }, el("div", { class: "empty" }, "No projects yet. Import one above.")));
    } else {
      const grid = el("div", { class: "proj-grid" });
      for (const p of ws.projects) grid.appendChild(projCard(p));
      view.appendChild(grid);
    }
  } catch (e) { toast(e.message, true); }
  finally { setBusy(false); }
}

function projCard(p) {
  const card = el("div", { class: "proj-card" + (p.class === "uninitialised" ? " uninit" : ""),
                            onclick: () => { if (p.class === "initialised") location.hash = `#/p/${encodeURIComponent(p.name)}`; } });
  const status = el("span", { class: "badge " + (p.class === "uninitialised" ? "uninit" : "todo") },
                    p.class === "uninitialised" ? "uninit" : "ready");
  card.appendChild(el("div", { class: "row spread" },
    el("h2", {}, p.name),
    status,
  ));
  card.appendChild(el("div", { class: "summary" }, p.summary || (p.class === "uninitialised" ? "Not yet initialised — click Init to model the codebase as .lanes/" : "")));
  if (p.class === "uninitialised") {
    const initBtn = el("button", { class: "primary",
      onclick: (ev) => { ev.stopPropagation(); openInitModal(p.name); },
    }, "Init…");
    card.appendChild(el("div", { class: "row", style: "margin-top:12px" }, initBtn));
  }
  return card;
}

// ── Project view ──────────────────────────────────────────────────────────
async function renderProject(name) {
  setCrumb([
    { label: "workspace", href: "#/" },
    { label: name },
  ]);
  setBusy(true);
  view.innerHTML = "";
  try {
    const p = await api(`/api/projects/${encodeURIComponent(name)}`);
    wsPathEl.textContent = p.path || "";

    if (p.uninitialised) {
      view.appendChild(el("div", { class: "section" },
        el("h1", {}, name),
        el("p", { class: "muted" }, "This project doesn't have `.lanes/` yet. Click Init to scan the codebase and model it as the five-layer state — it runs on a `lanes/<cycle-id>` branch and never touches main until you merge."),
        el("button", { class: "primary", onclick: () => openInitModal(name) }, "Init…"),
      ));
      return;
    }

    // Header
    const reshapeBtn = el("button", { onclick: (ev) => { ev.stopPropagation(); openReshapeModal(p.name); } }, "Reshape…");
    view.appendChild(el("div", { class: "section" },
      el("div", { class: "row spread" },
        el("h1", {}, p.name),
        el("div", { class: "row gap-2" },
          el("span", { class: "badge " + p.display_status }, p.display_status),
          reshapeBtn,
        ),
      ),
      el("div", { class: "markdown", style: "margin-top:8px" }, ...[renderMd(p.summary_md.replace(/^#.*$/m, "").trim())].filter(Boolean)),
    ));

    // L1 Spec
    view.appendChild(el("div", { class: "section-title" }, "L1 · Spec"));
    view.appendChild(el("div", { class: "section" }, renderMd(p.spec_md)));

    // L2 Features
    view.appendChild(el("div", { class: "section-title" }, "L2 · Features"));
    view.appendChild(featuresSection(p));

    // L3 Plan
    view.appendChild(el("div", { class: "section-title" }, "L3 · Tech Plan"));
    view.appendChild(el("div", { class: "section" }, renderMd(p.plan_md)));

    // L4 Backlog
    view.appendChild(el("div", { class: "section-title" }, "L4 · Backlog"));
    view.appendChild(backlogSection(p));

    // Cycles
    view.appendChild(el("div", { class: "section-title" }, "Cycles"));
    view.appendChild(await cyclesSection(p));
  } catch (e) { toast(e.message, true); }
  finally { setBusy(false); }
}

function featuresSection(p) {
  const section = el("div", { class: "section" });
  if (!p.features.length) {
    section.appendChild(el("div", { class: "empty" }, "No features yet. Edit `.lanes/features.json` to add some."));
    return section;
  }
  for (const f of p.features) {
    section.appendChild(el("div", { class: "feature-row" },
      el("div", {},
        el("div", { class: "id" }, f.id),
        el("div", { class: "title" }, f.title),
        f.why ? el("div", { class: "why" }, f.why) : null,
      ),
      f.design_notes ? el("details", {}, el("summary", { class: "muted" }, "design notes"), renderMd(f.design_notes)) : el("span"),
      el("span", { class: "badge " + f.display_status }, f.display_status),
    ));
  }
  return section;
}

function backlogSection(p) {
  const section = el("div", { class: "section" });
  if (!p.items.length) {
    section.appendChild(el("div", { class: "empty" }, "No backlog items yet. Edit `.lanes/backlog.json` to add some."));
    return section;
  }
  const byFeature = {};
  for (const it of p.items) (byFeature[it.feature_id] ||= []).push(it);
  for (const f of p.features.concat([{ id: "(unassigned)", title: "(unassigned)" }])) {
    const items = byFeature[f.id];
    if (!items?.length) continue;
    const group = el("div", { class: "bl-group" });
    group.appendChild(el("h3", {}, `${f.id} — ${f.title}`));
    for (const it of items) {
      const acceptanceEl = it.acceptance.length
        ? el("div", { class: "acceptance" }, el("ul", {}, ...it.acceptance.map((a) => el("li", {}, a))))
        : null;
      const runBtn = it.status === "todo" || it.status === "blocked"
        ? el("button", { class: "primary", onclick: async (ev) => {
            ev.stopPropagation();
            runBtn.disabled = true; runBtn.innerHTML = '<span class="spinner"></span>starting…';
            try {
              const r = await api(`/api/projects/${encodeURIComponent(p.name)}/cycles`, {
                method: "POST", body: { item_id: it.id },
              });
              toast(`cycle ${r.cycle_id} started`);
              location.hash = `#/p/${encodeURIComponent(p.name)}/c/${encodeURIComponent(r.cycle_id)}`;
            } catch (e) { toast(e.message, true); runBtn.disabled = false; runBtn.textContent = "Run"; }
          }}, "Run")
        : null;
      group.appendChild(el("div", { class: "bl-item" },
        el("div", { class: "id" }, it.id),
        el("div", {},
          el("div", { class: "title" }, it.title),
          acceptanceEl,
        ),
        el("span", { class: "cycles-count" }, it.cycles.length ? `${it.cycles.length} cycle(s)` : ""),
        el("div", { class: "actions" },
          el("span", { class: "badge " + it.status }, it.status),
          runBtn,
        ),
      ));
    }
    section.appendChild(group);
  }
  return section;
}

async function cyclesSection(p) {
  const section = el("div", { class: "section" });
  try {
    const cs = await api(`/api/projects/${encodeURIComponent(p.name)}/cycles`);
    if (!cs.live.length && !cs.recent.length) {
      section.appendChild(el("div", { class: "empty" }, "No cycles yet."));
      return section;
    }
    if (cs.live.length) {
      section.appendChild(el("h3", {}, "Live"));
      for (const c of cs.live) section.appendChild(cycleRow(p.name, c.cycle_id, "running", c.exit_code != null ? `exit=${c.exit_code}` : "active"));
    }
    if (cs.recent.length) {
      section.appendChild(el("h3", { style: "margin-top:12px" }, "Recent"));
      for (const c of cs.recent) {
        const status = c.state_status || (c.has_state ? "?" : "unknown");
        section.appendChild(cycleRow(p.name, c.cycle_id, status, c.state_request || ""));
      }
    }
  } catch (e) {
    section.appendChild(el("div", { class: "empty" }, "Couldn't load cycles: " + e.message));
  }
  return section;
}

function cycleRow(project, cycle_id, status, req) {
  return el("div", { class: "cycle-row", style: "cursor:pointer",
                     onclick: () => { location.hash = `#/p/${encodeURIComponent(project)}/c/${encodeURIComponent(cycle_id)}`; } },
    el("div", { class: "id" }, cycle_id),
    el("div", { class: "req" }, req),
    el("span", { class: "badge " + (status === "done" ? "done" : status === "blocked" ? "blocked" : "in-progress") }, status),
    el("button", { class: "ghost", onclick: (ev) => { ev.stopPropagation(); location.hash = `#/p/${encodeURIComponent(project)}/c/${encodeURIComponent(cycle_id)}`; } }, "open"),
  );
}

// ── Lane modals (init + reshape) ──────────────────────────────────────────
// Init bootstraps .lanes/* from the codebase. Textarea is optional —
// pure auto-scan if blank, or used as a soft constraint hint if provided.
function openInitModal(name) {
  openLaneModal({
    name,
    title: `Init ${name}`,
    blurb: [
      "Reads the codebase and produces a faithful 5-layer model in ",
      el("code", {}, ".lanes/*"),
      ". User note is optional — leave it blank for pure auto-scan, or add constraints / focus (e.g. \"only model src/\", \"scope OUT mobile\").",
    ],
    requireRequest: false,
    placeholder:
      "Optional. Examples:\n" +
      "• \"Treat this as a CLI tool aimed at devs; ignore the unused /examples dir.\"\n" +
      "• \"Scope OUT mobile — we never plan to support it.\"\n" +
      "• (blank — pure auto-scan from code)",
    endpoint: "init",
    submitLabel: "Run init",
  });
}

// Reshape applies surgical edits to existing .lanes/* per the user's intent.
// Textarea is REQUIRED — without intent, there's nothing to do.
function openReshapeModal(name) {
  openLaneModal({
    name,
    title: `Reshape ${name}`,
    blurb: [
      "Edits ",
      el("code", {}, ".lanes/{summary,spec,features,plan,backlog}"),
      " per your request — stable IDs preserved, minimal blast radius. Lands on a ",
      el("code", {}, "lanes/<cycle-id>"),
      " branch; merge to apply.",
    ],
    requireRequest: true,
    placeholder:
      "Required. What do you want to change?\n\n" +
      "Examples:\n" +
      "• \"Add feature for keyboard shortcuts.\"\n" +
      "• \"Drop the SSO feature; move it to scope OUT with reason 'OIDC complexity, not core need'.\"\n" +
      "• \"Split feature-0003 into two: one for read path, one for write path.\"\n" +
      "• \"Add 3 backlog items to deliver the new dashboard feature.\"",
    endpoint: "reshape",
    submitLabel: "Run reshape",
  });
}

function openLaneModal(opts) {
  const overlay = el("div", { class: "modal-overlay", onclick: (ev) => { if (ev.target === overlay) close(); } });
  const ta = el("textarea", { rows: "12", placeholder: opts.placeholder });
  const submitBtn = el("button", { class: "primary", onclick: submit }, opts.submitLabel);
  const cancelBtn = el("button", { class: "ghost", onclick: () => close() }, "Cancel");
  const modal = el("div", { class: "modal" },
    el("h2", {}, opts.title),
    el("div", { class: "muted", style: "margin-bottom:12px" }, ...opts.blurb),
    ta,
    el("div", { class: "row gap-2", style: "margin-top:12px; justify-content:flex-end" }, cancelBtn, submitBtn),
  );
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  setTimeout(() => ta.focus(), 50);

  const onKey = (ev) => {
    if (ev.key === "Escape") close();
    if ((ev.ctrlKey || ev.metaKey) && ev.key === "Enter") submit();
  };
  document.addEventListener("keydown", onKey);

  function close() {
    document.removeEventListener("keydown", onKey);
    overlay.remove();
  }
  async function submit() {
    const request = ta.value.trim();
    if (opts.requireRequest && !request) { toast("Please describe what you want.", true); return; }
    submitBtn.disabled = true; submitBtn.innerHTML = '<span class="spinner"></span>starting…';
    try {
      const r = await api(`/api/projects/${encodeURIComponent(opts.name)}/${opts.endpoint}`, {
        method: "POST", body: { request },
      });
      toast(`${opts.endpoint} ${r.cycle_id} started`);
      close();
      location.hash = `#/p/${encodeURIComponent(opts.name)}/c/${encodeURIComponent(r.cycle_id)}`;
    } catch (e) {
      toast(e.message, true);
      submitBtn.disabled = false; submitBtn.textContent = opts.submitLabel;
    }
  }
}

// ── Cycle view ────────────────────────────────────────────────────────────
function renderCycle(name, cycle_id) {
  setCrumb([
    { label: "workspace", href: "#/" },
    { label: name, href: `#/p/${encodeURIComponent(name)}` },
    { label: cycle_id },
  ]);
  view.innerHTML = "";
  const meta = el("div", { class: "row spread" }, el("h1", {}, cycle_id), el("span", { class: "badge in-progress" }, "live"));
  view.appendChild(el("div", { class: "section" }, meta));

  const log = el("pre", { class: "cycle-log" }, el("span", { class: "meta" }, `connecting to ${cycle_id}…\n`));
  view.appendChild(el("div", { class: "section" }, log));

  let es;
  try {
    es = new EventSource(`/api/projects/${encodeURIComponent(name)}/cycles/${encodeURIComponent(cycle_id)}/stream`);
  } catch (e) { toast(e.message, true); return; }

  es.addEventListener("log", (ev) => {
    log.appendChild(document.createTextNode(ev.data + "\n"));
    log.scrollTop = log.scrollHeight;
  });
  es.addEventListener("end", (ev) => {
    log.appendChild(el("span", { class: "meta" }, `\n[stream ended: ${ev.data}]\n`));
    meta.lastChild.textContent = "ended";
    meta.lastChild.className = "badge done";
    es.close();
  });
  es.addEventListener("error", (ev) => {
    log.appendChild(el("span", { class: "meta" }, `\n[stream error]\n`));
  });
  // Clean up on route change
  const closer = () => { try { es.close(); } catch {} window.removeEventListener("hashchange", closer); };
  window.addEventListener("hashchange", closer);
}

// ── Top-level dispatch ────────────────────────────────────────────────────
function render() {
  const r = parseRoute();
  if (r.name === "workspace") return renderWorkspace();
  if (r.name === "project") return renderProject(r.project);
  if (r.name === "cycle") return renderCycle(r.project, r.cycle);
}
