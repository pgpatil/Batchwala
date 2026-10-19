// Stock-take: count every material at a location in one sheet, give a reason for each difference, and post all the counts at once.
// The draft is kept on this device until saved, so a count can be done over several sessions.
import * as ev from "./events.js";
import * as sync from "./sync.js";
import * as M from "./model.js";
import * as R from "./roles.js";
import { layoutSwitch } from "./table.js";
import { S, V, H, guard, chipBar, searchBox, band } from "./core.js";
import { putMove } from "./inventory.js";
import { printHtml } from "./plan.js";
import { esc, rs, rs2, num, uid, today, dLong, qty, UNITS, ICON } from "./util.js";
import { toast, yesNo, openSheet } from "./ui.js";

export const REASONS = ["Counting error", "Wastage", "Spillage / breakage", "Expired", "Missing", "Used without a record", "Other"];
const KEY = "bw.take";
const multi = () => M.locations().length > 1 && M.erpOn();
const big = i => UNITS[i.unit] || null;
function draft() {
  if (!S.take) { try { S.take = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (_) {} }
  const loc = multi() ? (S.take && S.take.loc) || M.here() : M.locations()[0].id;
  if (!S.take || S.take.loc !== loc) S.take = { loc, counts: {}, reasons: {}, started: today() };
  return S.take;
}
const keep = () => { try { localStorage.setItem(KEY, JSON.stringify(S.take)); } catch (_) {} };
const catOf = i => i.category || "Uncategorised";

V.take = () => {
  const d = draft(); const sm = M.stockMap(multi() ? d.loc : null); S.filter.ttype = S.filter.ttype || "rm";
  const all = M.ingredients(); const q = (S.query.take || "").toLowerCase().trim();
  const rows = all.filter(i => S.filter.ttype === "all" || i.type === S.filter.ttype).filter(i => !q || (i.name + " " + catOf(i)).toLowerCase().includes(q)).sort((a, b) => catOf(a).localeCompare(catOf(b)) || a.name.localeCompare(b.name));
  const counted = Object.keys(d.counts).filter(id => M.ingMap()[id]); const diffOf = id => (d.counts[id] ?? 0) - (sm[id] || 0);
  const value = counted.reduce((s, id) => s + diffOf(id) * M.unitCost(M.ingMap()[id]), 0); const off = counted.filter(id => Math.abs(diffOf(id)) > 1e-6);
  let h = band(multi() ? `Stock-take · ${esc(M.locName(d.loc))}` : "Stock-take", "", `<div class="stats"><div class="st"><b>${counted.length}/${all.length}</b><span>counted</span></div><div class="st"><b>${off.length}</b><span>with a difference</span></div>${R.can("money") ? `<div class="st"><b class="${value < 0 ? "due" : ""}">${value >= 0 ? "+" : "−"}${rs(Math.abs(value))}</b><span>value of differences</span></div>` : ""}</div>`);
  h += `<div class="tools">${multi() ? `<div class="chips">${M.locations().map(l => `<button class="chip" data-takeloc="${esc(l.id)}" aria-pressed="${l.id === d.loc}">${esc(l.name)}</button>`).join("")}</div>` : ""}${searchBox("take", "Search material or category")}${chipBar("ttype", [["rm", "Raw"], ["pm", "Packing"], ["sf", "Semi-finished"], ["all", "All"]])}</div>`;
  h += `<div class="card tablecard"><table class="reg"><thead><tr><th>Material</th><th>Category</th><th class="r">In the app</th><th class="r">Counted</th><th class="r">Difference</th><th>Reason</th></tr></thead><tbody>${rows.map(i => { const b = big(i); const f = b ? b.f : 1; const has = d.counts[i.id] != null; const df = has ? diffOf(i.id) : 0;
    return `<tr${has && Math.abs(df) > 1e-6 ? ' class="shortrow"' : ""}><td><b>${esc(i.name)}</b></td><td>${esc(catOf(i))}</td><td class="r" data-v="${sm[i.id] || 0}">${qty(sm[i.id] || 0, i.unit)}</td>
      <td class="r"><span style="display:inline-flex;gap:4px;align-items:center"><input class="rate" data-takeq="${esc(i.id)}" inputmode="decimal" value="${has ? +(d.counts[i.id] / f).toFixed(3) : ""}" placeholder="–" aria-label="Counted ${esc(i.name)}"><small class="mut">${b ? b.big : esc(i.unit)}</small></span></td>
      <td class="r" data-v="${df}">${has && Math.abs(df) > 1e-6 ? `<b class="${df < 0 ? "due" : ""}">${df > 0 ? "+" : "−"}${qty(Math.abs(df), i.unit)}</b>` : has ? "–" : ""}</td>
      <td>${has && Math.abs(df) > 1e-6 ? `<select class="in" data-takereason="${esc(i.id)}" style="min-width:150px"><option value="">Reason…</option>${REASONS.map(r => `<option ${d.reasons[i.id] === r ? "selected" : ""}>${esc(r)}</option>`).join("")}</select>` : ""}</td></tr>`; }).join("") || `<tr><td colspan="6">No materials here.</td></tr>`}</tbody></table></div>
  <div class="boardfoot">${R.can("stock.count") ? `<button class="btn btn-primary" data-takesave ${counted.length ? "" : "disabled"}>${ICON.check}Save stock-take · ${counted.length} counted</button>` : ""}${counted.length ? `<button class="btn btn-ghost" data-takeclear>Discard this count</button>` : ""}
  <button class="btn btn-ghost" data-takesheet>${ICON.print}Print a blank count sheet</button>
  <p class="hint">Leave a material blank if you didn't count it. Only counted materials change. Your count stays on this device until you save it.</p></div>`;
  const past = ev.all("stocktakes").sort((a, b) => (b.date + b._at).localeCompare(a.date + a._at)).slice(0, 30);
  if (past.length) h += `<div class="tools" style="padding-top:10px">${layoutSwitch("take")}</div><div class="card tablecard"><table class="reg"><thead><tr><th>No.</th><th>Date</th>${multi() ? "<th>Location</th>" : ""}<th class="r">Counted</th><th class="r">Differences</th>${R.can("money") ? `<th class="r">Value</th>` : ""}</tr></thead><tbody>${past.map(t => `<tr data-takeview="${esc(t.id)}" tabindex="0"><td><b>${esc(t.no)}</b></td><td data-v="${esc(t.date)}">${esc(dLong(t.date))}</td>${multi() ? `<td>${esc(M.locName(t.loc))}</td>` : ""}<td class="r">${t.lines.length}</td><td class="r">${t.lines.filter(l => Math.abs(l.diff) > 1e-6).length}</td>${R.can("money") ? `<td class="r" data-v="${t.value}"><span class="${t.value < 0 ? "due" : ""}">${t.value >= 0 ? "+" : "−"}${rs2(Math.abs(t.value))}</span></td>` : ""}</tr>`).join("")}</tbody></table></div>`;
  return h;
};
function takeView(id) {
  const t = ev.get("stocktakes", id); if (!t) return; const ings = M.ingMap(); const by = {}; t.lines.filter(l => Math.abs(l.diff) > 1e-6).forEach(l => { by[l.reason || "No reason"] = (by[l.reason || "No reason"] || 0) + l.value; });
  openSheet({ kind: "takeView", id, redraw: () => takeView(id) }, `<div class="sh-head"><h2 class="h">${esc(t.no)}</h2><button class="x" data-close aria-label="Close">×</button></div>
  <div class="subl" style="margin:-4px 0 10px">${esc(dLong(t.date))}${multi() ? " · " + esc(M.locName(t.loc)) : ""} · ${t.lines.length} counted</div>
  ${R.can("money") && Object.keys(by).length ? `<label class="f">By reason</label><div class="kv">${Object.entries(by).map(([r, v]) => `<div><span>${esc(r)}</span><b class="${v < 0 ? "due" : ""}">${v >= 0 ? "+" : "−"}${rs2(Math.abs(v))}</b></div>`).join("")}</div>` : ""}
  <label class="f" style="margin-top:10px">Differences</label><div class="card tablecard" style="margin:0"><table class="reg"><thead><tr><th>Material</th><th class="r">App</th><th class="r">Counted</th><th class="r">Difference</th><th>Reason</th></tr></thead><tbody>${t.lines.filter(l => Math.abs(l.diff) > 1e-6).map(l => { const i = ings[l.ingId] || { name: "Removed material", unit: "" };
    return `<tr><td>${esc(i.name)}</td><td class="r">${qty(l.system, i.unit)}</td><td class="r">${qty(l.counted, i.unit)}</td><td class="r"><b class="${l.diff < 0 ? "due" : ""}">${l.diff > 0 ? "+" : "−"}${qty(Math.abs(l.diff), i.unit)}</b></td><td>${esc(l.reason || "")}</td></tr>`; }).join("") || `<tr><td colspan="5">Everything matched.</td></tr>`}</tbody></table></div>`);
}
H.click.push(async T => {
  if (S.view !== "take" && !T.closest("[data-takeview]")) return false;
  const tv = T.closest("[data-takeview]"); if (tv) { takeView(tv.dataset.takeview); return true; }
  const d = draft();
  const tl = T.closest("[data-takeloc]"); if (tl) { if (Object.keys(d.counts).length && !await yesNo(`<p class="cq">Switch location?</p><div class="cdetail">The count in progress at ${esc(M.locName(d.loc))} is discarded.</div>`, "Switch")) return true; S.take = { loc: tl.dataset.takeloc, counts: {}, reasons: {}, started: today() }; keep(); H.render(); return true; }
  if (T.closest("[data-takeclear]")) { if (await yesNo(`<p class="cq">Discard this count?</p>`, "Discard", "btn-danger-solid")) { S.take = { loc: d.loc, counts: {}, reasons: {}, started: today() }; keep(); H.render(); } return true; }
  if (T.closest("[data-takesheet]")) { const ings = M.ingredients().sort((a, b) => catOf(a).localeCompare(catOf(b)) || a.name.localeCompare(b.name));
    printHtml(`Stock count sheet · ${dLong(today())}`, `<div class="bcard tight"><div class="bc-step"><table><thead><tr><th>Material</th><th>Category</th><th>Unit</th><th>Counted</th></tr></thead><tbody>${ings.map(i => `<tr><td>${esc(i.name)}</td><td>${esc(catOf(i))}</td><td>${big(i) ? big(i).big : esc(i.unit)}</td><td>__________</td></tr>`).join("")}</tbody></table></div><div class="bc-sign"><span>Counted by ______</span><span>Checked by ______</span></div></div>`); return true; }
  if (T.closest("[data-takesave]")) { if (!guard("stock.count")) return true; const sm = M.stockMap(multi() ? d.loc : null); const ings = M.ingMap();
    const lines = Object.keys(d.counts).filter(id => ings[id]).map(id => { const diff = d.counts[id] - (sm[id] || 0); return { ingId: id, system: sm[id] || 0, counted: d.counts[id], diff, reason: d.reasons[id] || "", value: Math.round(diff * M.unitCost(ings[id]) * 100) / 100 }; });
    const missing = lines.filter(l => Math.abs(l.diff) > 1e-6 && !l.reason); const value = lines.reduce((s, l) => s + l.value, 0);
    if (!await yesNo(`<p class="cq">Save this stock-take?</p><div class="cdetail">${lines.length} counted · ${lines.filter(l => Math.abs(l.diff) > 1e-6).length} with a difference${R.can("money") ? ` worth ${value >= 0 ? "+" : "−"}${rs2(Math.abs(value))}` : ""}.${missing.length ? `<br><br>${missing.length} difference${missing.length > 1 ? "s have" : " has"} no reason yet.` : ""}</div>`, "Save stock-take")) return true;
    const id = uid("st"); const no = M.nextDocNo("stocktakes", R.numPrefix(), "ST"); const loc = d.loc;
    for (const l of lines) if (Math.abs(l.diff) > 1e-6) await putMove({ ingId: l.ingId, type: "count", qty: l.diff, note: `${no}${l.reason ? " · " + l.reason : ""}`, ref: id, outletId: loc });
    await ev.put("stocktakes", { id, no, date: today(), loc, lines, value: Math.round(value * 100) / 100 }); sync.soon();
    S.take = { loc, counts: {}, reasons: {}, started: today() }; keep(); toast(`${no} saved`); H.render(); return true; }
  return false;
});
H.input.push(T => {
  if (S.view !== "take" || !T.dataset.takeq) return false; const d = draft(); const i = M.ingMap()[T.dataset.takeq]; if (!i) return true;
  if (T.value.trim() === "") delete d.counts[i.id]; else { if (/[.,]$/.test(T.value)) return true; d.counts[i.id] = Math.max(0, num(T.value) * (big(i) ? big(i).f : 1)); }
  keep(); H.render(); return true;
});
H.change.push(T => { if (S.view !== "take" || !T.dataset.takereason) return false; draft().reasons[T.dataset.takereason] = T.value; keep(); return true; });
