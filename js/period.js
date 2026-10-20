// One period picker for every report and analytics screen: quick presets (today, this week, this month, quarter, financial year…)
// or any from–to range. Each screen keeps its own choice (by key) for the session.
import { S, H } from "./core.js";
import { esc, today, addDays, dObj, dLong } from "./util.js";
import { ui } from "./ui.js";

const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const monthEnd = s => { const d = dObj(s.slice(0, 8) + "01"); d.setMonth(d.getMonth() + 1); d.setDate(0); return iso(d); };
const fyStart = t => { const y = +t.slice(0, 4), m = +t.slice(5, 7); return `${m >= 4 ? y : y - 1}-04-01`; };
// Indian financial-year quarters: Apr–Jun, Jul–Sep, Oct–Dec, Jan–Mar.
const qStart = t => { const m = +t.slice(5, 7), y = +t.slice(0, 4); const sm = m >= 4 ? [4, 7, 10][Math.floor((m - 4) / 3)] : 1; return `${y}-${String(sm).padStart(2, "0")}-01`; };
const shiftMonth = (s, n) => { const d = dObj(s.slice(0, 8) + "01"); d.setMonth(d.getMonth() + n); return iso(d); };

export const PRESETS = [["today", "Today"], ["yesterday", "Yesterday"], ["week", "This week"], ["lastweek", "Last week"], ["month", "This month"], ["lastmonth", "Last month"],
  ["quarter", "This quarter"], ["fy", "This financial year"], ["lastfy", "Last financial year"], ["d30", "Last 30 days"], ["d90", "Last 90 days"], ["all", "All time"], ["custom", "Custom…"]];
// A preset's [from, to]; "all" starts at 0000-01-01 so string comparisons include everything.
export function presetRange(k, t = today()) {
  const wk = addDays(t, -((dObj(t).getDay() + 6) % 7));
  switch (k) {
    case "today": return [t, t];
    case "yesterday": return [addDays(t, -1), addDays(t, -1)];
    case "week": return [wk, t];
    case "lastweek": return [addDays(wk, -7), addDays(wk, -1)];
    case "lastmonth": { const s = shiftMonth(t, -1); return [s, monthEnd(s)]; }
    case "quarter": return [qStart(t), t];
    case "fy": return [fyStart(t), t];
    case "lastfy": { const s = fyStart(t); return [`${+s.slice(0, 4) - 1}-04-01`, addDays(s, -1)]; }
    case "d30": return [addDays(t, -29), t];
    case "d90": return [addDays(t, -89), t];
    case "all": return ["0000-01-01", t];
    default: return [t.slice(0, 8) + "01", t];   // this month
  }
}
const state = key => { S.period = S.period || {}; return S.period[key] = S.period[key] || { k: "month" }; };
export function periodRange(key) { const p = state(key); if (p.k === "custom" && p.a && p.b) return p.a <= p.b ? [p.a, p.b] : [p.b, p.a]; return presetRange(p.k === "custom" ? "month" : p.k); }
export const isAll = key => state(key).k === "all";
// The same length of time just before, for "vs previous period" comparisons.
export function previous([a, b]) { if (a <= "0001") return null; const n = Math.round((dObj(b) - dObj(a)) / 864e5) + 1; return [addDays(a, -n), addDays(a, -1)]; }
export const periodLabel = key => { const [a, b] = periodRange(key); return isAll(key) ? `All time to ${dLong(b)}` : a === b ? dLong(a) : `${dLong(a)} – ${dLong(b)}`; };

// A select of presets plus, for Custom, two date boxes. onChange: the screen to redraw (defaults to the page).
export function periodBar(key) {
  const p = state(key); const [a, b] = periodRange(key);
  return `<div class="periodbar"><label class="sel"><span class="sr">Period</span><select class="in" data-period="${esc(key)}">${PRESETS.map(([k, l]) => `<option value="${k}" ${p.k === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
    ${p.k === "custom" ? `<input class="in" type="date" data-perfrom="${esc(key)}" value="${esc(p.a || a)}" aria-label="From"><span class="mut">to</span><input class="in" type="date" data-perto="${esc(key)}" value="${esc(p.b || b)}" aria-label="To">` : `<span class="mut perlbl">${esc(periodLabel(key))}</span>`}</div>`;
}
const redraw = () => { if (ui.sheet && ui.sheet.redraw && document.querySelector("#sheet [data-period]")) ui.sheet.redraw(); else H.render(); };
H.change.push(T => {
  if (T.dataset.period) { const p = state(T.dataset.period); p.k = T.value; if (p.k === "custom" && !p.a) { const [a, b] = presetRange("month"); p.a = a; p.b = b; } redraw(); return true; }
  if (T.dataset.perfrom || T.dataset.perto) { const p = state(T.dataset.perfrom || T.dataset.perto); if (T.value) p[T.dataset.perfrom ? "a" : "b"] = T.value; redraw(); return true; }
  return false;
});
