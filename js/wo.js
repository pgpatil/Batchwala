// Work orders: production planned ahead, materials issued from the store against it, then completed with what was actually made.
// Completing one records the batch; its cost is what was really used (issued less returned), compared with the BOM for the actual output.
import * as ev from "./events.js";
import * as sync from "./sync.js";
import * as M from "./model.js";
import * as R from "./roles.js";
import { asLines, layoutSwitch } from "./table.js";
import * as L from "./lock.js";
import { S, A, V, H, guard, chipBar, searchBox, band, clean } from "./core.js";
import { putMove } from "./inventory.js";
import { printHtml } from "./plan.js";
import { $, esc, rs, rs2, num, uid, today, dLong, qty, ICON } from "./util.js";
import { ui, toast, openSheet, closeSheet, yesNo } from "./ui.js";

const r2 = v => Math.round(v * 100) / 100;
const r4 = v => Math.round(v * 1e4) / 1e4;
const prefix = () => (R.me() || {}).prefix || "";
const LABEL = { planned: "Planned", issued: "Materials issued", done: "Done", cancelled: "Cancelled" };
const tag = s => `<span class="tag ${{ planned: "t-camp", issued: "t-part", done: "t-paid", cancelled: "t-due" }[s]}">${LABEL[s]}</span>`;
const runsTxt = n => `${+(+n).toFixed(2)} run${+(+n).toFixed(2) === 1 ? "" : "s"}`;
export const wos = () => ev.all("wos").sort((a, b) => (b.date + b._at).localeCompare(a.date + a._at));
const woText = (w, ings = M.ingMap()) => [...w.lines.filter(l => l.qty > 0).map(l => `${l.item} × ${l.qty}`), ...(w.prep || []).filter(p => p.runs > 0).map(p => `${(ings[p.ingId] || {}).name || "?"} × ${runsTxt(p.runs)}`)].join(", ");

// Standard materials from the store for an output: the BOM one level down, plus the recipes of semi-finished made in the order.
// Semi-finished made here is used here first; only the rest comes from the store, and any extra goes into stock.
export function stdUse(lines, prep) {
  const { need, made } = M.batchNeed(lines.filter(l => l.qty > 0), prep.filter(p => p.runs > 0)); const use = {}, surplus = {};
  Object.keys(need).forEach(id => { const n = need[id] - (made[id] || 0); if (n > 1e-9) use[id] = n; });
  Object.keys(made).forEach(id => { const x = made[id] - (need[id] || 0); if (x > 1e-9) surplus[id] = x; });
  return { use, surplus };
}

/* ---------- list ---------- */
V.wo = () => {
  S.filter.wo = S.filter.wo || "open"; const k = S.filter.wo; const all = wos(); const ings = M.ingMap(); const q = (S.query.wo || "").toLowerCase().trim();
  const groups = { open: w => ["planned", "issued"].includes(w.status), done: w => w.status === "done", all: () => true };
  const list = all.filter(groups[k]).filter(w => !q || (w.no + " " + woText(w, ings)).toLowerCase().includes(q));
  const done = all.filter(w => w.status === "done"); const vv = done.reduce((s, w) => s + varianceCost(w), 0);
  let h = band("Work orders", R.can("bake.record") ? `<button class="pillbtn" data-wonew>${ICON.plus}New work order</button>` : "",
    `<div class="stats"><div class="st"><b>${all.filter(w => w.status === "planned").length}</b><span>planned</span></div><div class="st"><b>${all.filter(w => w.status === "issued").length}</b><span>in progress</span></div>${R.can("money") ? `<div class="st"><b class="${vv > 0 ? "due" : ""}">${vv >= 0 ? "" : "−"}${rs(Math.abs(vv))}</b><span>material variance (done)</span></div>` : ""}</div>`);
  h += `<div class="tools">${searchBox("wo", "Search WO or item")}${layoutSwitch("wo")}${chipBar("wo", [["open", "Open", all.filter(groups.open).length], ["done", "Done", done.length], ["all", "All", all.length]])}</div>`;
  if (!all.length) return h + `<div class="empty"><strong>No work orders yet</strong>Plan production as a work order (from Planning or a batch card), issue its materials from the store, then complete it with what was really made. The batch is recorded with its actual cost and any variance from the BOM.</div>`;
  if (!list.length) return h + `<div class="empty"><strong>Nothing here</strong>Try another filter.</div>`;
  return h + (asLines("wo") ? `<div class="card tablecard"><table class="reg"><thead><tr><th>WO</th><th>Date</th><th>Output</th><th class="r">Planned</th><th class="r">Made</th>${R.can("money") ? `<th class="r">Variance</th>` : ""}<th>Status</th></tr></thead><tbody>${list.map(w => { const b = w.batchId && ev.get("bakes", w.batchId); const made = b ? (b.lines || []).reduce((s, l) => s + (+l.qty || 0) - (+l.spoiled || 0), 0) : null;
      return `<tr data-wo="${esc(w.id)}" tabindex="0"><td><b>${esc(w.no)}</b></td><td data-v="${esc(w.date)}">${esc(dLong(w.date))}</td><td class="items">${esc(woText(w, ings))}</td><td class="r">${w.lines.reduce((s, l) => s + l.qty, 0)}</td><td class="r">${made ?? "–"}</td>${R.can("money") ? `<td class="r" data-v="${w.status === "done" ? varianceCost(w) : 0}">${w.status === "done" ? varTxt(varianceCost(w)) : "–"}</td>` : ""}<td>${tag(w.status)}</td></tr>`; }).join("")}</tbody></table></div>`
    : `<ul class="list">${list.map(w => `<li class="row"><button class="who" data-wo="${esc(w.id)}"><div class="nm">${esc(w.no)} · ${esc(dLong(w.date))}</div><div class="subl">${tag(w.status)}${w.status === "done" && R.can("money") ? " · variance " + varTxt(varianceCost(w)) : ""}</div><div class="subl">${esc(woText(w, ings))}</div></button></li>`).join("")}</ul>`);
};
// A material's variance: the quantity over or under the BOM, and its value when the material has a price.
const varCell = (v, i, money) => { const d = v.used - v.std; if (Math.abs(d) < 1e-6) return "on standard"; return `<span class="${d > 0 ? "due" : ""}">${d > 0 ? "+" : "−"}${qty(Math.abs(d), i.unit)}</span>${money && Math.abs(v.cost) >= 0.5 ? ` <small class="mut">${v.cost > 0 ? "+" : "−"}${rs2(Math.abs(v.cost))}</small>` : ""}`; };
const varTxt = v => Math.abs(v) < 0.5 ? "on standard" : `<span class="${v > 0 ? "due" : ""}">${v > 0 ? "+" : "−"}${rs2(Math.abs(v))}</span>`;
const varianceCost = w => { const b = w.batchId && ev.get("bakes", w.batchId); return b && Array.isArray(b.variance) ? b.variance.reduce((s, x) => s + (+x.cost || 0), 0) : 0; };

/* ---------- new ---------- */
// opts: { date, lines: [{ item, qty }], prep: { [sfId]: runs } }
export function woNew(opts = {}) {
  if (!guard("bake.record")) return;
  const lines = (opts.lines || []).filter(l => l.qty > 0).map(l => ({ item: l.item, qty: l.qty }));
  M.menuActive().filter(m => (m.recipe || []).length && !lines.some(l => l.item === m.name)).forEach(m => lines.push({ item: m.name, qty: 0 }));
  const prep = M.ingredients().filter(i => i.type === "sf" && i.yield > 0 && i.recipe.length).map(i => ({ ingId: i.id, runs: r2((opts.prep || {})[i.id] || 0) }));
  const st = { kind: "woNew", date: opts.date || today(), lines, prep, loc: H.prodKitchen && R.mode() === "erp" ? H.prodKitchen() : M.here(), notes: "" }; st.redraw = () => drawNew(st); drawNew(st);
}
H.woNew = woNew;
function drawNew(st) {
  const ings = M.ingMap(); const { use } = stdUse(st.lines, st.prep); const sm = M.stockMap(M.erpOn() ? st.loc : null); const ids = Object.keys(use).filter(id => ings[id]);
  openSheet(st, `<div class="sh-head"><h2 class="h">New work order</h2><button class="x" data-close aria-label="Close">×</button></div>
  <p class="hint" style="margin-top:-4px">${esc(M.nextDocNo("wos", prefix(), "WO"))}</p>
  <div class="two"><div><label class="f" for="woDate">For</label><input class="in" id="woDate" type="date" value="${st.date}"></div>${M.locations().length > 1 ? `<div><label class="f" for="woLoc">At</label><select class="in" id="woLoc">${M.locations().map(l => `<option value="${esc(l.id)}" ${l.id === st.loc ? "selected" : ""}>${esc(l.name)}</option>`).join("")}</select></div>` : "<div></div>"}</div>
  <label class="f">Finished pieces to make</label><div class="kv">${st.lines.map((l, ix) => `<div style="align-items:center"><span>${esc(l.item)}</span><div class="stepper"><button data-wnstep="${ix}:-1" aria-label="One less">−</button><input class="stepin" data-wnqty="${ix}" inputmode="numeric" value="${l.qty}" aria-label="Pieces of ${esc(l.item)}"><button data-wnstep="${ix}:1" aria-label="One more">+</button></div></div>`).join("") || "<div>No menu items have a BOM yet</div>"}</div>
  ${st.prep.length ? `<label class="f" style="margin-top:12px">Semi-finished to make in this order <small class="mut">(recipe runs)</small></label><div class="kv">${st.prep.map((p, ix) => { const i = ings[p.ingId]; return `<div style="align-items:center"><span>${esc(i.name)}<small class="mut" style="display:block">${qty(i.yield, i.unit)} per run · have ${qty(Math.max(0, sm[i.id] || 0), i.unit)}</small></span><div class="stepper"><button data-wnpstep="${ix}:-1" aria-label="One run less">−</button><input class="stepin" data-wnrun="${ix}" inputmode="decimal" value="${+(+p.runs).toFixed(2)}" aria-label="Runs of ${esc(i.name)}"><button data-wnpstep="${ix}:1" aria-label="One run more">+</button></div></div>`; }).join("")}</div>` : ""}
  <label class="f" style="margin-top:12px">Materials to issue from the store</label>
  <div class="kv">${ids.map(id => { const i = ings[id]; const s = (sm[id] || 0) < use[id]; return `<div><span>${esc(i.name)}${s ? ` <span class="tag t-due">short ${qty(use[id] - Math.max(0, sm[id] || 0), i.unit)}</span>` : ""}</span><span>${qty(use[id], i.unit)} <small class="mut">/ ${qty(Math.max(0, sm[id] || 0), i.unit)}</small></span></div>`; }).join("") || "<div>Nothing yet</div>"}</div>
  <label class="f" for="woNote">Note</label><input class="in" id="woNote" value="${esc(st.notes)}" placeholder="Optional">
  <button class="btn btn-primary" data-wosave ${st.lines.some(l => l.qty > 0) || st.prep.some(p => p.runs > 0) ? "" : "disabled"}>Create work order</button>`);
}

/* ---------- detail ---------- */
function woDetail(id) {
  const w = ev.get("wos", id); if (!w) { closeSheet(); return; } const ings = M.ingMap(); const { use } = stdUse(w.lines, w.prep || []); const b = w.batchId && ev.get("bakes", w.batchId);
  const issued = w.issued || {}, ret = w.returned || {}; const ids = [...new Set([...Object.keys(use), ...Object.keys(issued)])].filter(x => ings[x]); const money = R.can("money");
  const variance = b && Array.isArray(b.variance) ? Object.fromEntries(b.variance.map(v => [v.ingId, v])) : null;
  openSheet({ kind: "woView", id, redraw: () => woDetail(id) }, `<div class="sh-head"><h2 class="h">${esc(w.no)}</h2><button class="x" data-close aria-label="Close">×</button></div>${L.banner("wos", id)}
  <div class="subl" style="margin:-4px 0 10px">${esc(dLong(w.date))}${M.locations().length > 1 ? " · " + esc(M.locName(w.loc)) : ""} ${tag(w.status)}${b ? ` · batch <button class="linkbtn" data-batch="${esc(b.id)}">#${esc(b.no)}</button>` : ""}</div>
  <div class="kv">${w.lines.filter(l => l.qty > 0).map(l => { const d = b && (b.lines || []).find(x => x.item === l.item); return `<div><span>${esc(l.item)}</span><span>${l.qty} planned${d ? ` · <b>${d.qty - (d.spoiled || 0)}</b> made${d.spoiled ? `, ${d.spoiled} spoiled` : ""}` : ""}</span></div>`; }).join("")}
  ${(w.prep || []).filter(p => p.runs > 0).map(p => `<div><span>${esc((ings[p.ingId] || {}).name || "?")}</span><span>${runsTxt(p.runs)}</span></div>`).join("")}</div>
  <label class="f" style="margin-top:12px">Materials</label><div class="card tablecard" style="margin:0"><table class="reg"><thead><tr><th>Material</th><th class="r">${variance ? "Standard" : "Planned"}</th><th class="r">Issued</th>${w.status === "done" ? `<th class="r">Returned</th><th class="r">Used</th><th class="r">Variance</th>` : ""}</tr></thead><tbody>${ids.map(x => { const i = ings[x]; const v = variance && variance[x];
    return `<tr><td>${esc(i.name)}</td><td class="r">${qty(v ? v.std : use[x] || 0, i.unit)}</td><td class="r">${issued[x] ? qty(issued[x], i.unit) : "–"}</td>${w.status === "done" ? `<td class="r">${ret[x] ? qty(ret[x], i.unit) : "–"}</td><td class="r">${qty(v ? v.used : 0, i.unit)}</td><td class="r">${v ? varCell(v, i, money) : "–"}</td>` : ""}</tr>`; }).join("")}</tbody></table></div>
  ${w.notes ? `<p class="hint">Note: ${esc(w.notes)}</p>` : ""}
  ${R.can("bake.record") && ["planned", "issued"].includes(w.status) ? `<div class="btnrow"><button class="btn btn-ghost" data-woissue="${esc(id)}">${w.status === "issued" ? "Issue more" : "Issue materials"}</button>${w.status === "issued" ? `<button class="btn btn-ok" data-wodone="${esc(id)}">${ICON.check}Complete</button>` : ""}</div>` : ""}
  <button class="btn btn-ghost" data-woprint="${esc(id)}">${ICON.print}Print work order</button>
  ${R.can("bake.record") && ["planned", "issued"].includes(w.status) ? `<button class="btn btn-danger" data-wocancel="${esc(id)}">Cancel work order${w.status === "issued" ? " · return what was issued" : ""}</button>` : ""}`);
}

/* ---------- issue ---------- */
async function issueSheet(id) {
  const lk = await L.open("wos", id, (ev.get("wos", id) || {}).no || "this work order"); if (!lk) return;
  const w = ev.get("wos", id); const { use } = stdUse(w.lines, w.prep || []); const issued = w.issued || {};
  const rows = Object.keys(use).filter(x => M.ingMap()[x]).map(x => ({ ingId: x, std: use[x], done: issued[x] || 0, now: r4(Math.max(0, use[x] - (issued[x] || 0))) }));
  const st = { ...lk, kind: "woIssue", id, rows }; st.redraw = () => drawIssue(st); drawIssue(st);
}
function drawIssue(st) {
  const w = ev.get("wos", st.id); const ings = M.ingMap(); const sm = M.stockMap(M.erpOn() ? w.loc : null);
  openSheet(st, `<div class="sh-head"><h2 class="h">Issue materials · ${esc(w.no)}</h2><button class="x" data-close aria-label="Close">×</button></div>
  <p class="hint" style="margin-top:-4px">What leaves the store for the kitchen now. Change any quantity to what was really handed over.</p>
  <div class="kv">${st.rows.map((r, ix) => { const i = ings[r.ingId]; const b = UNITF(i); return `<div style="align-items:center;gap:8px"><span>${esc(i.name)}<small class="mut" style="display:block">standard ${qty(r.std, i.unit)}${r.done ? ` · issued ${qty(r.done, i.unit)}` : ""} · in store ${qty(Math.max(0, sm[i.id] || 0), i.unit)}</small></span><span style="display:flex;align-items:center;gap:6px"><input class="rate" data-wiq="${ix}" inputmode="decimal" value="${+(r.now / b.f).toFixed(3) || ""}" placeholder="0"><span class="unitlbl">${b.u}</span></span></div>`; }).join("") || "<div>Nothing to issue</div>"}</div>
  <button class="btn btn-primary" data-wiss>Issue · takes it off stock</button>`);
}
const UNITF = i => i.unit === "pcs" ? { f: 1, u: "pcs" } : { f: 1000, u: i.unit === "g" ? "kg" : "L" };

/* ---------- complete ---------- */
async function doneSheet(id) {
  const lk = await L.open("wos", id, (ev.get("wos", id) || {}).no || "this work order"); if (!lk) return;
  const w = ev.get("wos", id);
  const st = { ...lk, kind: "woDone", id, lines: w.lines.filter(l => l.qty > 0).map(l => ({ item: l.item, good: l.qty, spoiled: 0 })), prep: (w.prep || []).filter(p => p.runs > 0).map(p => ({ ingId: p.ingId, runs: p.runs })), ret: {}, date: today() };
  st.redraw = () => drawDone(st); drawDone(st);
}
function drawDone(st) {
  const w = ev.get("wos", st.id); const ings = M.ingMap(); const issued = w.issued || {};
  const { use } = stdUse(st.lines.map(l => ({ item: l.item, qty: l.good + l.spoiled })), st.prep);
  openSheet(st, `<div class="sh-head"><h2 class="h">Complete ${esc(w.no)}</h2><button class="x" data-close aria-label="Close">×</button></div>
  <label class="f" for="wdDate">Made on</label><input class="in" id="wdDate" type="date" value="${st.date}">
  <label class="f">What was made</label><div class="kv">${st.lines.map((l, ix) => `<div style="align-items:center;gap:8px"><span>${esc(l.item)}</span><span style="display:flex;gap:6px;align-items:center"><label class="mini">Good <input class="rate" data-wdg="${ix}" inputmode="numeric" value="${l.good}"></label><label class="mini">Spoiled <input class="rate" data-wds="${ix}" inputmode="numeric" value="${l.spoiled || ""}" placeholder="0"></label></span></div>`).join("")}
  ${st.prep.map((p, ix) => `<div style="align-items:center"><span>${esc(ings[p.ingId].name)} <small class="mut">runs made</small></span><input class="rate" data-wdr="${ix}" inputmode="decimal" value="${p.runs}"></div>`).join("")}</div>
  <label class="f" style="margin-top:12px">Returned to the store unused</label><div class="kv">${Object.keys(issued).filter(x => ings[x]).map(x => { const i = ings[x]; const b = UNITF(i); const used = issued[x] - (st.ret[x] || 0); const d = used - (use[x] || 0);
    return `<div style="align-items:center;gap:8px"><span>${esc(i.name)}<small class="mut" style="display:block">issued ${qty(issued[x], i.unit)} · standard for this output ${qty(use[x] || 0, i.unit)}${Math.abs(d) > 1e-6 ? ` · <b class="${d > 0 ? "due" : ""}">${d > 0 ? "over" : "under"} ${qty(Math.abs(d), i.unit)}</b>` : ""}</small></span><span style="display:flex;align-items:center;gap:6px"><input class="rate" data-wdret="${esc(x)}" inputmode="decimal" value="${st.ret[x] ? +(st.ret[x] / b.f).toFixed(3) : ""}" placeholder="0"><span class="unitlbl">${b.u}</span></span></div>`; }).join("")}</div>
  <p class="hint">Used = issued − returned. The difference from the BOM for what was made is the variance, shown on the work order and in Reports.</p>
  <button class="btn btn-ok" data-wdsave>${ICON.oven}Complete · record the batch</button>`);
}
function syncDone() { const st = ui.sheet; const w = ev.get("wos", st.id); const ings = M.ingMap(); const v = s => document.querySelector(s);
  st.date = $("#wdDate").value || today();
  st.lines.forEach((l, ix) => { l.good = Math.max(0, Math.round(num(v(`[data-wdg="${ix}"]`).value))); l.spoiled = Math.max(0, Math.round(num(v(`[data-wds="${ix}"]`).value))); });
  st.prep.forEach((p, ix) => { p.runs = Math.max(0, num(v(`[data-wdr="${ix}"]`).value)); });
  Object.keys(w.issued || {}).forEach(x => { const el = v(`[data-wdret="${x}"]`); if (el && ings[x]) st.ret[x] = Math.min(w.issued[x], Math.max(0, num(el.value) * UNITF(ings[x]).f)); }); }
async function complete(st) {
  syncDone(); if (!await L.saveOk(st)) return; const w = ev.get("wos", st.id); if (w.status !== "issued") { toast("This work order was already completed or cancelled"); woDetail(w.id); return; } const ings = M.ingMap(); const issued = w.issued || {};
  const lines = st.lines.filter(l => l.good + l.spoiled > 0).map(l => ({ item: l.item, qty: l.good + l.spoiled, spoiled: l.spoiled }));
  const prep = st.prep.filter(p => p.runs > 0 && ings[p.ingId]).map(p => ({ ingId: p.ingId, runs: p.runs, qty: ings[p.ingId].yield * p.runs }));
  if (!lines.length && !prep.length) { toast("Enter what was made"); return; }
  const { use, surplus } = stdUse(lines, prep); const me = R.me(); const no = M.nextBatchNo((me && me.prefix) || "");
  const used = {}; Object.keys(issued).forEach(x => { used[x] = issued[x] - (st.ret[x] || 0); });
  const ids = [...new Set([...Object.keys(use), ...Object.keys(used)])].filter(x => ings[x]);
  const variance = ids.map(x => { const c = M.unitCost(ings[x]); const u = used[x] || 0, s = use[x] || 0; return { ingId: x, std: r4(s), used: r4(u), cost: r2((u - s) * c) }; });
  const vc = variance.reduce((s, v) => s + v.cost, 0); const off = variance.filter(v => Math.abs(v.used - v.std) > 1e-6);
  if (!await yesNo(`<p class="cq">Complete ${esc(w.no)} as batch #${esc(no)}?</p><div class="cdetail">${lines.map(l => `${esc(l.item)}: ${l.qty - l.spoiled} good${l.spoiled ? `, ${l.spoiled} spoiled` : ""}`).join("<br>")}${prep.map(p => `<br>${esc(ings[p.ingId].name)}: ${runsTxt(p.runs)}`).join("")}<br><br>${off.length ? `Off the BOM: ${off.map(v => `${esc(ings[v.ingId].name)} ${varCell(v, ings[v.ingId], false)}`).join(", ")}${R.can("money") && Math.abs(vc) >= 0.5 ? ` · value ${varTxt(vc)}` : ""}` : "Materials used match the BOM."}</div>`, "Complete", "btn-ok")) return;
  const bakeId = uid("b");
  for (const x of Object.keys(st.ret)) if (st.ret[x] > 0) await putMove({ ingId: x, type: "return", qty: st.ret[x], date: st.date, note: `${w.no} · returned`, ref: w.id, outletId: w.loc });
  const madeList = Object.keys(surplus).filter(x => ings[x]).map(x => ({ ingId: x, qty: surplus[x], cost: r2(M.unitCost(ings[x]) * surplus[x]) }));
  for (const m of madeList) await putMove({ ingId: m.ingId, type: "make", qty: m.qty, date: st.date, note: `Batch #${no} · ${w.no}`, ref: bakeId, outletId: w.loc });
  const stock = Object.keys(used).filter(x => ings[x] && used[x] > 0).map(x => ({ ingId: x, qty: used[x], cost: r2(M.unitCost(ings[x]) * used[x]) }));
  const net = stock.reduce((s, x) => s + x.cost, 0) - madeList.reduce((s, x) => s + x.cost, 0);
  await ev.put("bakes", { id: bakeId, no, date: st.date, lines, prep, notes: `${w.no}${w.notes ? " · " + w.notes : ""}`, stock, made: madeList, cost: r2(Math.max(0, net)), madeBy: me ? me.id : "", at: new Date().toISOString(), outletId: w.loc, wo: w.id, variance });
  await ev.put("wos", { ...clean(w), status: "done", batchId: bakeId, returned: st.ret, doneAt: new Date().toISOString() }); sync.soon(); toast(`${w.no} done · batch #${no}`); woDetail(w.id);
}

/* ---------- printing ---------- */
function printWo(id) {
  const w = ev.get("wos", id); const ings = M.ingMap(); const { use } = stdUse(w.lines, w.prep || []); const issued = w.issued || {};
  printHtml(`Work order ${w.no} · ${dLong(w.date)}`, `<div class="bcard"><div class="bc-step"><h4>Make</h4><table><tbody>${w.lines.filter(l => l.qty > 0).map(l => `<tr><td>${esc(l.item)}</td><td class="num">${l.qty}</td><td class="tick">Made ____</td></tr>`).join("")}
    ${(w.prep || []).filter(p => p.runs > 0).map(p => `<tr><td>${esc((ings[p.ingId] || {}).name || "?")}</td><td class="num">${runsTxt(p.runs)}</td><td class="tick">☐</td></tr>`).join("")}</tbody></table></div>
    <div class="bc-step"><h4>Materials from the store</h4><table><thead><tr><th>Material</th><th class="num">Standard</th><th class="num">Issued</th><th class="num">Returned</th></tr></thead><tbody>${Object.keys(use).filter(x => ings[x]).map(x => `<tr><td>${esc(ings[x].name)}</td><td class="num">${qty(use[x], ings[x].unit)}</td><td class="num">${issued[x] ? qty(issued[x], ings[x].unit) : "______"}</td><td class="num">______</td></tr>`).join("")}</tbody></table></div>
    <div class="bc-sign"><span>Issued by ________</span><span>Received by ________</span><span>Start __:__</span><span>End __:__</span><span>Checked by ________</span></div></div>`);
}

/* ---------- actions ---------- */
H.click.push(async T => {
  const st = ui.sheet;
  if (T.closest("[data-wonew]")) { woNew({}); return true; }
  const wo = T.closest("[data-wo]"); if (wo) { woDetail(wo.dataset.wo); return true; }
  const wi = T.closest("[data-woissue]"); if (wi) { if (guard("bake.record")) issueSheet(wi.dataset.woissue); return true; }
  const wd = T.closest("[data-wodone]"); if (wd) { if (guard("bake.record")) doneSheet(wd.dataset.wodone); return true; }
  const wp = T.closest("[data-woprint]"); if (wp) { printWo(wp.dataset.woprint); return true; }
  const wc = T.closest("[data-wocancel]"); if (wc) { const w = ev.get("wos", wc.dataset.wocancel); const ings = M.ingMap();
    if (!await yesNo(`<p class="cq">Cancel ${esc(w.no)}?</p><div class="cdetail">${Object.keys(w.issued || {}).length ? "Everything issued goes back into the store. " : ""}It stays in the list marked cancelled.</div>`, "Cancel work order", "btn-danger-solid", "Keep it")) return true;
    for (const [x, q] of Object.entries(w.issued || {})) if (q > 0 && ings[x]) await putMove({ ingId: x, type: "return", qty: q, note: `${w.no} cancelled`, ref: w.id, outletId: w.loc });
    await ev.put("wos", { ...clean(w), status: "cancelled" }); sync.soon(); woDetail(w.id); return true; }
  if (!st) return false;
  if (st.kind === "woNew") {
    const b = T.closest("[data-wnstep]"); if (b) { const [ix, d] = b.dataset.wnstep.split(":").map(Number); st.lines[ix].qty = Math.max(0, st.lines[ix].qty + d); drawNew(st); return true; }
    const p = T.closest("[data-wnpstep]"); if (p) { const [ix, d] = p.dataset.wnpstep.split(":").map(Number); st.prep[ix].runs = Math.max(0, r2(st.prep[ix].runs + d)); drawNew(st); return true; }
    if (T.closest("[data-wosave]")) { st.date = $("#woDate").value || today(); if ($("#woLoc")) st.loc = $("#woLoc").value; st.notes = $("#woNote").value.trim();
      const id = uid("wo"); await ev.put("wos", { id, no: M.nextDocNo("wos", prefix(), "WO"), date: st.date, loc: st.loc, lines: st.lines.filter(l => l.qty > 0), prep: st.prep.filter(x => x.runs > 0), status: "planned", issued: {}, notes: st.notes, by: (R.me() || {}).id || "" });
      sync.soon(); toast("Work order created"); woDetail(id); return true; } }
  if (st.kind === "woIssue" && T.closest("[data-wiss]")) { if (!await L.saveOk(st)) return true; const w = ev.get("wos", st.id); const ings = M.ingMap(); if (!["planned", "issued"].includes(w.status)) { toast("This work order is closed"); woDetail(w.id); return true; }
    st.rows.forEach((r, ix) => { const el = document.querySelector(`[data-wiq="${ix}"]`); if (el) r.now = Math.max(0, num(el.value) * UNITF(ings[r.ingId]).f); });
    const give = st.rows.filter(r => r.now > 0); if (!give.length) { toast("Enter what was issued"); return true; }
    const sm = M.stockMap(M.erpOn() ? w.loc : null); const over = give.filter(r => r.now > Math.max(0, sm[r.ingId] || 0) + 1e-6);
    if (over.length && !await yesNo(`<p class="cq">More than the store holds</p><div class="cdetail">${over.map(r => `${esc(ings[r.ingId].name)}: issuing ${qty(r.now, ings[r.ingId].unit)}, store shows ${qty(Math.max(0, sm[r.ingId] || 0), ings[r.ingId].unit)}`).join("<br>")}<br><br>Stock will go below zero until a GRN or count is recorded.</div>`, "Issue anyway")) return true;
    const issued = { ...(w.issued || {}) };
    for (const r of give) { await putMove({ ingId: r.ingId, type: "issue", qty: -r.now, note: `${w.no} · issued`, ref: w.id, outletId: w.loc }); issued[r.ingId] = r4((issued[r.ingId] || 0) + r.now); }
    await ev.put("wos", { ...clean(ev.get("wos", st.id)), status: "issued", issued }); sync.soon(); toast("Materials issued"); woDetail(st.id); return true; }
  if (st.kind === "woDone" && T.closest("[data-wdsave]")) { await complete(st); return true; }
  return false;
});
H.input.push(T => {
  const st = ui.sheet; if (!st) return false;
  if (st.kind === "woNew" && (T.dataset.wnqty != null || T.dataset.wnrun != null)) { if (T.dataset.wnqty != null) st.lines[+T.dataset.wnqty].qty = Math.max(0, Math.round(num(T.value))); else st.prep[+T.dataset.wnrun].runs = Math.max(0, num(T.value));
    if (T.value.trim() !== "" && !/[.,]$/.test(T.value)) drawNew(st); return true; }
  if (st.kind === "woDone" && (T.dataset.wdg != null || T.dataset.wds != null || T.dataset.wdr != null || T.dataset.wdret != null)) { if (/[.,]$/.test(T.value)) return true; syncDone(); drawDone(st); return true; }
  return false;
});
A.wo = () => { S.view = "wo"; H.render(); };
