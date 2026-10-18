// Tables everywhere get sorting (tap a heading: up, down, off) and a filter box per column; the choice survives redraws.
// Filters match text, or compare numbers with >, <, >=, <= or = (quantities in kg / L count as g / ml).
import { S, H } from "./core.js";
import { esc } from "./util.js";

S.tbl = S.tbl || {};
const MIN_FILTER_ROWS = 5;   // smaller tables get sorting only
const shownText = c => { const i = c.querySelector("input,select"); return (i ? i.value : c.textContent).trim(); };
const cellText = c => c.dataset.v != null ? c.dataset.v : shownText(c);   // data-v: the raw value (ISO date, grams) for sorting and comparing
function numOf(s) { const m = /^[₹\s]*(-?[\d,]*\.?\d+)\s*(kg|l|g|ml|pcs|%)?(?![\w])/i.exec(s); if (!m) return null; const v = parseFloat(m[1].replace(/,/g, "")); return /^(kg|l)$/i.test(m[2] || "") ? v * 1000 : v; }
function test(c, f) {
  const m = /^(>=|<=|>|<|=)\s*(.+)$/.exec(f.trim());
  if (m) { const a = numOf(cellText(c)), b = numOf(m[2]); if (a != null && b != null) return { ">": a > b, "<": a < b, ">=": a >= b, "<=": a <= b, "=": a === b }[m[1]]; }
  return shownText(c).toLowerCase().includes(f.trim().toLowerCase());
}
function apply(t, st) {
  const body = t.tBodies[0]; const n = t.tHead.rows[0].cells.length; const rows = [...body.rows];
  rows.forEach((r, i) => { if (r.dataset.ord == null) r.dataset.ord = i; });
  const data = rows.filter(r => r.cells.length === n); const active = st.col >= 0 || Object.values(st.f).some(v => v && v.trim());
  rows.filter(r => r.cells.length !== n).forEach(r => { r.hidden = active; });   // group headings and notes only make sense unsorted
  let shown = 0; data.forEach(r => { r.hidden = !Object.entries(st.f).every(([i, f]) => !f || !f.trim() || test(r.cells[i], f)); if (!r.hidden) shown++; });
  const ord = st.col >= 0 ? data.slice().sort((a, b) => { const x = cellText(a.cells[st.col]), y = cellText(b.cells[st.col]); const nx = numOf(x), ny = numOf(y);
    return st.dir * (nx != null && ny != null ? nx - ny : x.localeCompare(y, undefined, { numeric: true })); }) : rows.slice().sort((a, b) => a.dataset.ord - b.dataset.ord);
  ord.forEach(r => body.appendChild(r));
  [...t.tHead.rows[0].cells].forEach((th, i) => { if (th.dataset.tsort) th.setAttribute("aria-sort", st.col === i ? (st.dir > 0 ? "ascending" : "descending") : "none"); });
  const cap = t.parentElement.querySelector(".tshown"); if (cap) cap.textContent = active && shown < data.length ? `Showing ${shown} of ${data.length}` : "";
}
export function enhance(root, view) {
  root.querySelectorAll("table").forEach((t, k) => {
    if (!t.tHead || !t.tHead.rows.length || !t.tBodies[0] || t.closest(".bcard")) return;
    const key = view + ":" + k; const st = S.tbl[key] || (S.tbl[key] = { col: -1, dir: 1, f: {} }); const cols = [...t.tHead.rows[0].cells];
    const n = cols.length; const many = [...t.tBodies[0].rows].filter(r => r.cells.length === n).length >= MIN_FILTER_ROWS || Object.values(st.f).some(Boolean);
    cols.forEach((th, i) => { if (th.textContent.trim() && th.colSpan === 1) { th.dataset.tsort = key + "|" + i; th.tabIndex = 0; } });
    if (many) { const fr = document.createElement("tr"); fr.className = "tfilter";
      fr.innerHTML = cols.map((th, i) => th.textContent.trim() ? `<th><input data-tfilter="${esc(key)}|${i}" value="${esc(st.f[i] || "")}" placeholder="Filter" aria-label="Filter ${esc(th.textContent.trim())}"></th>` : "<th></th>").join("");
      t.tHead.appendChild(fr); const cap = document.createElement("p"); cap.className = "tshown hint"; t.after(cap); }
    apply(t, st);
  });
}
const tableOf = key => { const [view, k] = key.split(":"); return view === S.view ? document.querySelectorAll("#main table")[+k] : null; };
H.click.push(T => {
  const th = T.closest("[data-tsort]"); if (!th) return false; const [key, i] = th.dataset.tsort.split("|"); const st = S.tbl[key]; const c = +i;
  if (st.col !== c) { st.col = c; st.dir = 1; } else if (st.dir > 0) st.dir = -1; else st.col = -1;
  const t = tableOf(key); if (t) apply(t, st); return true;
});
H.input.push(T => {
  if (!T.dataset.tfilter) return false; const [key, i] = T.dataset.tfilter.split("|"); S.tbl[key].f[i] = T.value; const t = tableOf(key); if (t) apply(t, S.tbl[key]); return true;
});

/* ---------- grid or lines ---------- */
// Lists can show as cards (grid) or as a register (lines). Default: lines on wide screens, cards on phones; the choice is kept on this device.
S.layout = (() => { try { return JSON.parse(localStorage.getItem("bw.layout") || "{}"); } catch (_) { return {}; } })();
export const asLines = v => S.layout[v] != null ? S.layout[v] === "lines" : S.wide;
export const layoutSwitch = v => `<div class="seg layoutsw" role="group" aria-label="Layout">${[["grid", "Grid"], ["lines", "Lines"]].map(([k, l]) => `<button data-layout="${v}:${k}" aria-pressed="${asLines(v) === (k === "lines")}">${l}</button>`).join("")}</div>`;
H.click.push(T => {
  const b = T.closest("[data-layout]"); if (!b) return false; const [v, k] = b.dataset.layout.split(":"); S.layout[v] = k;
  try { localStorage.setItem("bw.layout", JSON.stringify(S.layout)); } catch (_) {} H.render(); return true;
});
document.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.dataset && e.target.dataset.tsort) e.target.click(); });
