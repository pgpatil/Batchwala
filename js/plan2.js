// Planning ahead: the next 7 days of finished goods (pre-orders and keep-ready levels), the week's materials with the day each one
// runs short, and a forecast of keep-ready levels per weekday from what was sold over the last 8 weeks.
import * as ev from "./events.js";
import * as sync from "./sync.js";
import * as M from "./model.js";
import * as R from "./roles.js";
import { S, H, clean } from "./core.js";
import { planLines } from "./plan.js";
import { esc, rs, num, today, addDays, dObj, dLabel, qty } from "./util.js";
import { toast, openSheet, closeSheet, yesNo } from "./ui.js";

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const dow = d => (dObj(d).getDay() + 6) % 7;
const stockLoc = () => M.erpOn() ? (R.mode() === "erp" && H.prodKitchen ? H.prodKitchen() : M.here()) : null;

H.weekPlan = () => {
  const t = today(); const days = Array.from({ length: 7 }, (_, i) => addDays(t, i)); const per = days.map(d => planLines(d)); const ings = M.ingMap();
  const items = [...new Set(per.flatMap(ls => ls.map(l => l.item)))].sort(); const q = (i, item) => (per[i].find(l => l.item === item) || {}).qty || 0;
  // Materials: each day's need through every BOM level (whole stock ignored), then a running balance from today's stock plus what's on order.
  const daily = days.map((d, i) => M.explode(per[i], stockLoc(), { ignoreStock: true, exact: true }).need); const sm = M.stockMap(stockLoc()); const oo = M.onOrder();
  const mats = [...new Set(daily.flatMap(n => Object.keys(n)))].filter(id => ings[id] && ings[id].type !== "sf");
  const rows = mats.map(id => { let bal = Math.max(0, sm[id] || 0); let shortOn = ""; const need = daily.reduce((s, n, i) => { bal -= n[id] || 0; if (bal < -1e-9 && !shortOn) shortOn = days[i]; return s + (n[id] || 0); }, 0);
    const buy = Math.max(0, need - Math.max(0, sm[id] || 0) - (oo[id] || 0)); return { i: ings[id], need, have: Math.max(0, sm[id] || 0), oo: oo[id] || 0, buy, shortOn }; }).sort((a, b) => (a.shortOn || "9") < (b.shortOn || "9") ? -1 : a.i.name.localeCompare(b.i.name));
  const short = rows.filter(r => r.buy > 1e-9);
  return `<div class="plan"><div class="card"><h3>Finished goods by day</h3><div class="tablecard"><table class="reg"><thead><tr><th>Item</th>${days.map(d => `<th class="r">${esc(dLabel(d))}<small class="mut" style="display:block">${DOW[dow(d)]}</small></th>`).join("")}<th class="r">Week</th></tr></thead>
    <tbody>${items.map(it => `<tr><td>${esc(it)}</td>${days.map((d, i) => `<td class="r">${q(i, it) || "–"}</td>`).join("")}<td class="r"><b>${days.reduce((s, d, i) => s + q(i, it), 0)}</b></td></tr>`).join("") || `<tr><td colspan="9">Nothing planned or pre-ordered this week.</td></tr>`}</tbody></table></div>
    <p class="hint">Each day: the saved plan if someone edited it, else pre-orders plus that weekday’s keep-ready level, less what’s baked. Set keep-ready levels from sales with <button class="linkbtn" data-forecast>Forecast keep-ready levels</button>.</p></div>
    <div class="card"><h3>Materials for the week</h3><div class="tablecard"><table class="reg"><thead><tr><th>Material</th><th class="r">Week needs</th><th class="r">In stock</th><th class="r">On order</th><th class="r">To buy</th><th>Runs short on</th></tr></thead>
    <tbody>${rows.map(r => `<tr${r.buy > 1e-9 ? ' class="shortrow"' : ""}><td>${esc(r.i.name)}</td><td class="r">${qty(r.need, r.i.unit)}</td><td class="r">${qty(r.have, r.i.unit)}</td><td class="r">${r.oo ? qty(r.oo, r.i.unit) : "–"}</td><td class="r">${r.buy > 1e-9 ? `<b>${qty(r.buy, r.i.unit)}</b>` : "–"}</td><td>${r.shortOn ? `<span class="tag ${r.shortOn <= addDays(t, 1) ? "t-due" : "t-part"}">${esc(dLabel(r.shortOn))}</span>` : "–"}</td></tr>`).join("") || `<tr><td colspan="6">No BOM for this week’s items yet.</td></tr>`}</tbody></table></div>
    ${short.length && R.can("stock.buy") && H.draftPOs ? `<button class="btn btn-primary" data-weekpo>Draft POs for ${short.length} material${short.length > 1 ? "s" : ""}</button>` : ""}
    <p class="hint">“Runs short on” uses stock on hand only; what’s on order helps once it arrives.</p></div></div>`;
};

/* ---------- forecast of keep-ready levels ---------- */
// For each item and weekday: average counter and aggregator sales on that weekday over the last 8 weeks (pre-orders are planned
// separately), plus a buffer, rounded up. Applying it sets the item's level per weekday.
export function forecast(weeks = 8, buffer = +(M.config().forecastBuffer ?? 10)) {
  const t = today(); const from = addDays(t, -weeks * 7); const sums = {}; const seen = {};
  M.orders(false).filter(o => o.date >= from && o.date < t && !M.PREORDER.includes(o.channel)).forEach(o => { const w = dow(o.date); seen[o.date] = 1;
    o.items.forEach(i => { const k = i.item; sums[k] = sums[k] || Array(7).fill(0); sums[k][w] += i.qty; }); });
  // Averaged over the weekdays the counter actually traded, so days the shop was shut don't pull the level down.
  const weeksOf = w => Math.max(1, Math.min(weeks, Object.keys(seen).filter(d => dow(d) === w).length || weeks));
  return M.menuActive().map(m => { const s = sums[m.name] || Array(7).fill(0); const avg = s.map((x, w) => x / weeksOf(w)); return { m, avg, sug: avg.map(a => a > 0 ? Math.ceil(a * (1 + buffer / 100)) : 0), now: DOW.map((_, w) => M.parOn(m, addDays(t, (w - dow(t) + 7) % 7))) }; })
    .filter(r => r.avg.some(a => a > 0) || r.now.some(n => n > 0));
}
function forecastSheet() {
  const rows = forecast(); const c = M.config();
  openSheet({ kind: "forecast", redraw: forecastSheet }, `<div class="sh-head"><h2 class="h">Forecast keep-ready levels</h2><button class="x" data-close aria-label="Close">×</button></div>
  <p class="hint" style="margin-top:-4px">Average counter and Swiggy / Zomato sales on each weekday over the last 8 weeks, plus ${+(c.forecastBuffer ?? 10)}% so you rarely run out. Pre-orders are planned on top. Tick the items to apply.</p>
  ${rows.length ? `<div class="card tablecard" style="margin:0"><table class="reg"><thead><tr><th></th><th>Item</th>${DOW.map(d => `<th class="r">${d}</th>`).join("")}</tr></thead><tbody>${rows.map(r => `<tr><td><input type="checkbox" data-fcitem="${esc(r.m.id)}" ${r.sug.some((s, w) => s !== r.now[w]) ? "checked" : ""} aria-label="Apply for ${esc(r.m.name)}"></td><td>${esc(r.m.name)}</td>${r.sug.map((s, w) => `<td class="r"><b>${s}</b>${s !== r.now[w] ? `<small class="mut" style="display:block">now ${r.now[w]}</small>` : ""}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
  ${R.can("menu.edit") ? `<button class="btn btn-primary" data-fcapply>Set the ticked items’ levels</button>` : `<p class="hint">Changing levels needs menu permission.</p>`}` : `<p class="hint">No counter or aggregator sales in the last 8 weeks yet.</p>`}
  ${R.isAdmin() ? `<label class="f" for="fcBuf">Buffer %</label><div class="two"><input class="in" id="fcBuf" inputmode="numeric" value="${+(c.forecastBuffer ?? 10)}"><button class="btn btn-ghost" style="margin:0" data-fcbuf>Save</button></div>` : ""}`);
}
H.click.push(async T => {
  if (T.closest("[data-forecast]")) { forecastSheet(); return true; }
  if (T.closest("[data-fcapply]")) { const ids = [...document.querySelectorAll("[data-fcitem]:checked")].map(x => x.dataset.fcitem); const rows = forecast();
    for (const id of ids) { const r = rows.find(x => x.m.id === id); const cur = ev.get("menu", id); if (r && cur) await ev.put("menu", { ...clean(cur), parDays: r.sug }); }
    sync.soon(); toast(ids.length ? `Keep-ready levels set for ${ids.length} item${ids.length > 1 ? "s" : ""}` : "Tick the items to set"); closeSheet(); H.render(); return true; }
  if (T.closest("[data-fcbuf]")) { const { _at, _by, ...c } = ev.get("config", "app") || { id: "app" }; await ev.put("config", { ...c, id: "app", forecastBuffer: Math.max(0, Math.round(num(document.getElementById("fcBuf").value))) }); sync.soon(); forecastSheet(); return true; }
  if (T.closest("[data-weekpo]")) { const t = today(); const days = Array.from({ length: 7 }, (_, i) => addDays(t, i)); const lines = days.flatMap(d => planLines(d)); const ex = M.explode(lines, stockLoc(), { ignoreStock: true, exact: true });
    const sm = M.stockMap(stockLoc()); const rows = Object.entries(ex.need).filter(([id]) => (M.ingMap()[id] || {}).type !== "sf").map(([ingId, q]) => ({ ingId, qty: Math.max(0, q - Math.max(0, sm[ingId] || 0)) })).filter(r => r.qty > 0);
    const made = await H.draftPOs(rows, "For the next 7 days"); toast(made.length ? `${made.length} draft PO${made.length > 1 ? "s" : ""} made` : "Everything is already on order"); return true; }
  return false;
});
