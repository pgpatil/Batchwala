// Batches: the register of every batch baked, with pieces, spoiled pieces, stock used, cost and who made it.
import * as ev from "./events.js";
import * as sync from "./sync.js";
import * as M from "./model.js";
import * as R from "./roles.js";
import { asLines, layoutSwitch } from "./table.js";
import * as L from "./lock.js";
import { S, A, V, H, guard, chipBar, searchBox, band, clean } from "./core.js";
import { bakeSheet, undoBatch } from "./inventory.js";
import { historySheet } from "./orders.js";
import { $, esc, rs, rs2, uid, today, addDays, dLong, qty, ICON } from "./util.js";
import { ui, toast, openSheet, closeSheet, ask, yesNo } from "./ui.js";

const time = b => { const t = b.at || b._at; return t ? new Date(t).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : ""; };
const who = b => { const m = ev.get("members", b.madeBy || b._by); return m ? m.name : ""; };
const noOf = b => b.no ? "#" + esc(b.no) : "Batch";
const PERIOD = { today: ["Today", t => t], d7: ["7 days", t => addDays(t, -6)], d30: ["30 days", t => addDays(t, -29)], all: ["All", () => "0000"] };
const inPeriod = (b, k, t) => k === "today" ? b.date === t : b.date >= PERIOD[k][1](t);

/* ---------- Batches view ---------- */
V.batches = () => {
  S.filter.batches = S.filter.batches || "d7";
  const t = today(); const money = R.can("money"); const all = M.batches(); const k = S.filter.batches;
  const q = (S.query.batches || "").toLowerCase().trim();
  const ings = M.ingMap();
  const list = all.filter(b => inPeriod(b, k, t)).filter(b => !q || (b.no + " " + b.notes + " " + M.batchText(b, ings)).toLowerCase().includes(q));
  const live = list.filter(b => !b.void);
  const pcs = live.reduce((s, b) => s + M.batchPcs(b), 0), sp = live.reduce((s, b) => s + M.batchSpoiled(b), 0), cost = live.reduce((s, b) => s + M.batchCost(b), 0);
  let h = band("Batches", R.can("bake.record") ? `<button class="pillbtn" data-batchnew>${ICON.plus}New batch</button>` : "",
    `<div class="stats"><div class="st"><b>${live.length}</b><span>batch${live.length === 1 ? "" : "es"}${list.length > live.length ? ` · ${list.length - live.length} undone` : ""}</span></div><div class="st"><b>${pcs - sp}</b><span>good pieces${sp ? ` · ${sp} spoiled` : ""}</span></div>${money ? `<div class="st"><b>${rs(cost)}</b><span>ingredient cost${pcs - sp > 0 ? ` · ${rs2(cost / (pcs - sp))}/pc` : ""}</span></div>` : ""}</div>`);
  h += `<div class="tools">${searchBox("batches", "Search item, batch # or note")}${layoutSwitch("batches")}${chipBar("batches", Object.entries(PERIOD).map(([key, [l]]) => [key, l, all.filter(b => inPeriod(b, key, t)).length]))}</div>`;
  if (!all.length) return h + `<div class="empty"><strong>No batches yet</strong>Record a batch when it goes into the oven. Each one gets a number, takes its ingredients off stock by recipe and shows its cost here.${R.can("bake.record") ? `<button class="btn btn-primary" data-batchnew style="margin-top:14px">${ICON.oven}Record a batch</button>` : ""}</div>`;
  if (!list.length) return h + `<div class="empty"><strong>Nothing matches</strong>Try another search or period.</div>`;
  if (asLines("batches")) return h + `<div class="card tablecard"><table class="reg"><thead><tr><th>Batch</th><th>Date</th><th>Time</th><th>Items</th><th class="r">Pieces</th><th class="r">Spoiled</th>${money ? `<th class="r">Cost</th><th class="r">Per piece</th>` : ""}<th>Made by</th><th>Note</th></tr></thead>
    <tbody>${list.map(b => { const p = M.batchPcs(b), s = M.batchSpoiled(b), c = M.batchCost(b);
      return `<tr data-batch="${esc(b.id)}" tabindex="0"${b.void ? ` class="void"` : ""}><td><b>${noOf(b)}</b>${b.void ? ` <span class="tag t-due">Undone</span>` : ""}</td><td data-v="${esc(b.date)}">${esc(dLong(b.date))}</td><td>${esc(time(b))}</td><td class="items">${esc(M.batchText(b, ings))}</td><td class="r">${p}</td><td class="r">${s ? `<span class="due">${s}</span>` : "–"}</td>${money ? `<td class="r">${c ? rs2(c) : "–"}</td><td class="r">${c && p - s > 0 ? rs2(c / (p - s)) : "–"}</td>` : ""}<td>${esc(who(b))}</td><td class="items">${esc(b.notes)}</td></tr>`; }).join("")}</tbody>
    <tfoot><tr><td colspan="4">${live.length} batch${live.length === 1 ? "" : "es"}${list.length > live.length ? ` · ${list.length - live.length} undone not counted` : ""}</td><td class="r">${pcs}</td><td class="r">${sp || "–"}</td>${money ? `<td class="r">${rs2(cost)}</td><td></td>` : ""}<td colspan="2"></td></tr></tfoot></table></div>`;
  let cur = ""; h += "<div>";
  list.forEach(b => {
    if (b.date !== cur) { if (cur) h += "</ul>"; cur = b.date; const d = list.filter(x => x.date === cur); h += `<div class="sect">${esc(dLong(cur))}${cur === t ? " · Today" : ""}<span>${d.length} batch${d.length > 1 ? "es" : ""} · ${d.reduce((s, x) => s + M.batchPcs(x), 0)} pcs</span></div><ul class="list" style="padding-top:0">`; }
    const s = M.batchSpoiled(b), c = M.batchCost(b);
    h += `<li class="row${b.void ? " void" : ""}"><button class="who" data-batch="${esc(b.id)}"><div class="nm">${noOf(b)} · ${esc(time(b))}</div><div class="pills">${b.lines.map(l => `<span class="pill">${esc(l.item)}<b>×${l.qty}</b></span>`).join("")}${b.prep.map(p => `<span class="pill">${esc((ings[p.ingId] || {}).name || "?")}<b>×${p.runs} run${p.runs === 1 ? "" : "s"}</b></span>`).join("")}</div>
      <div class="subl">${b.void ? `<span class="tag t-due">Undone</span>` : ""}${s ? `<span class="tag t-due">${s} spoiled</span>` : ""}${money && c ? rs2(c) + " stock" : ""}${who(b) ? " · " + esc(who(b)) : ""}${b.notes ? " · " + esc(b.notes) : ""}</div></button><div class="side"><div class="bignum" style="font-size:26px">${M.batchPcs(b)}</div><small class="mut">pcs</small></div></li>`;
  });
  return h + "</ul></div>";
};
A.batches = () => { S.view = "batches"; H.render(); window.scrollTo({ top: 0 }); };

/* ---------- batch detail ---------- */
export function batchSheet(id) {
  const b = M.batches().find(x => x.id === id); if (!b) { closeSheet(); return; }
  const money = R.can("money"); const edit = R.can("bake.record");
  const ings = Object.fromEntries(M.ingredients().map(i => [i.id, i])); const stock = M.batchStock(b);
  const p = M.batchPcs(b), s = M.batchSpoiled(b), c = M.batchCost(b);
  openSheet({ kind: "batch", id, redraw: () => batchSheet(id) }, `<div class="sh-head"><h2 class="h">Batch ${b.no ? "#" + esc(b.no) : ""}</h2><button class="x" data-close aria-label="Close">×</button></div>${L.banner("bakes", id)}
  <div class="subl" style="margin:-4px 0 10px">${esc(dLong(b.date))} · ${esc(time(b))}${who(b) ? " · " + esc(who(b)) : ""}</div>
  ${b.void ? `<div class="banner bad">Undone${b.voidAt ? " " + esc(new Date(b.voidAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })) : ""}. Not on the bake board; its stock moves were reversed.</div>` : ""}
  <div class="kpis" style="padding:0;margin-bottom:10px"><div class="kpi"><b>${p - s}</b><span>good pieces${s ? ` of ${p}` : ""}</span></div><div class="kpi"><b style="${s ? "color:var(--due)" : ""}">${s}</b><span>spoiled</span></div>
  ${money && !b.lines.length ? `<div class="kpi"><b>${rs2(M.batchMadeValue(b))}</b><span>value of prep made</span></div>` : ""}
  ${money && b.lines.length ? `<div class="kpi"><b>${c ? rs2(c) : "–"}</b><span>${b.prep.length && b.lines.length ? "net cost of pieces" : "ingredient cost"}</span></div><div class="kpi"><b>${c && p - s > 0 ? rs2(c / (p - s)) : "–"}</b><span>cost per good piece</span></div>` : ""}</div>
  ${b.lines.length ? `<label class="f">Pieces</label><div class="kv">${b.lines.map(l => { const lot = M.batchLots().find(x => x.b.id === b.id && x.ix === b.lines.indexOf(l));
    return `<div><span>${esc(l.item)}${l.spoiled ? ` <span class="tag t-due">${l.spoiled} spoiled</span>` : ""}${l.discarded ? ` <span class="tag t-due">${l.discarded} discarded</span>` : ""}${l.cleared ? ` <span class="tag t-part">${l.cleared} cleared on count</span>` : ""}<small class="mut" style="display:block">${lot ? `${lot.left} unsold · ${lot.life}-day shelf life, ${lot.expired ? "expired" : "good till"} ${esc(dLong(addDays(lot.expires, lot.expired ? 0 : -1)))}` : ""}</small></span><b>${l.qty}</b></div>`; }).join("")}</div>` : ""}
  ${b.prep.length ? `<label class="f">Semi-finished made</label><div class="kv">${b.prep.map(p => { const i = ings[p.ingId]; const m = (b.made || []).find(x => x.ingId === p.ingId); return `<div><span>${esc(i ? i.name : "Removed material")} <small class="mut">× ${p.runs} run${p.runs === 1 ? "" : "s"}</small></span><span>${i ? qty(p.qty, i.unit) : p.qty}${money && m && m.cost ? ` <small class="mut">${rs2(m.cost)}</small>` : ""}</span></div>`; }).join("")}</div>` : ""}
  <label class="f">Stock used</label>${stock.length ? `<div class="kv">${stock.map(x => { const i = ings[x.ingId]; return `<div><span>${esc(i ? i.name : "Removed ingredient")}</span><span>${i ? qty(x.qty, i.unit) : x.qty}${money && x.cost ? ` <small class="mut">${rs2(x.cost)}</small>` : ""}</span></div>`; }).join("")}</div>` : `<p class="hint" style="margin-top:0">No recipe for these items, so stock didn’t change.</p>`}
  ${b.notes ? `<p class="hint">Note: ${esc(b.notes)}</p>` : ""}
  ${edit && !b.void ? `<div class="btnrow"><button class="btn btn-ghost" data-bt="spoil" ${b.lines.length ? "" : "disabled"}>Record spoiled</button><button class="btn btn-ghost" data-bt="note">${b.notes ? "Edit note" : "Add note"}</button></div>` : ""}
  ${R.can("history") ? `<button class="btn btn-ghost" data-bt="history">History of changes</button>` : ""}
  ${edit && !b.void ? `<button class="btn btn-danger" data-bt="undo">Undo this batch</button>` : ""}`);
}
async function spoilSheet(b) {
  const lk = await L.open("bakes", b.id, `batch #${b.no}`); if (!lk) return;
  const st = { ...lk, kind: "batchSpoil", id: b.id, lines: b.lines.map(l => ({ ...l })) }; st.redraw = () => drawSpoil(st); drawSpoil(st);
}
function drawSpoil(st) {
  openSheet(st, `<div class="sh-head"><h2 class="h">Spoiled pieces</h2><button class="x" data-close aria-label="Close">×</button></div>
  <p class="hint" style="margin-top:-4px">Burnt, broken or failed pieces from this batch. They come off the bake board count.</p>
  <div class="kv">${st.lines.map((l, ix) => `<div style="align-items:center"><span>${esc(l.item)} <small class="mut">of ${l.qty}</small></span><div class="stepper"><button data-spstep="${ix}:-1" aria-label="One less">−</button><span>${l.spoiled}</span><button data-spstep="${ix}:1" aria-label="One more">+</button></div></div>`).join("")}</div>
  <button class="btn btn-primary" data-bt="saveSpoil">Save</button>`);
}
const sheetBatch = () => M.batches().find(x => x.id === (ui.sheet && ui.sheet.id));
async function saveBatch(b, change) { await ev.put("bakes", clean({ ...b, ...change })); sync.soon(); }
const BT = {
  spoil: () => { if (guard("bake.record")) spoilSheet(sheetBatch()); },
  saveSpoil: async () => { const st = ui.sheet; if (!await L.saveOk(st)) return; await saveBatch(sheetBatch(), { lines: st.lines }); toast("Spoiled pieces saved"); batchSheet(st.id); },
  note: async () => { const b = sheetBatch(); if (!guard("bake.record")) return;
    const v = await ask(`<p class="cq">Batch note</p><input class="in" id="btNote" value="${esc(b.notes)}" placeholder="Oven, tray, flavour, who baked" style="margin-top:12px">`, [{ label: "Cancel", cls: "btn-ghost", value: false }, { label: "Save", cls: "btn-primary", value: true }], true);
    if (v) { await saveBatch(b, { notes: ($("#btNote").value || "").trim() }); batchSheet(b.id); } },
  history: () => { const b = sheetBatch(); historySheet("bakes", b.id, `Batch ${b.no ? "#" + b.no : ""} · ${dLong(b.date)}`, () => batchSheet(b.id)); },
  undo: async () => { const b = sheetBatch(); if (await undoBatch(b.id)) batchSheet(b.id); }
};
H.click.push(async T => {
  const bn = T.closest("[data-batchnew]"); if (bn) { bakeSheet(today()); return true; }
  const bt = T.closest("[data-bt]"); if (bt && BT[bt.dataset.bt]) { await BT[bt.dataset.bt](); return true; }
  const b = T.closest("[data-batch]"); if (b) { batchSheet(b.dataset.batch); return true; }
  const st = ui.sheet;
  if (st && st.kind === "batchSpoil") { const sp = T.closest("[data-spstep]"); if (sp) { const [ix, d] = sp.dataset.spstep.split(":").map(Number); const l = st.lines[ix]; l.spoiled = Math.min(l.qty, Math.max(0, l.spoiled + d)); drawSpoil(st); return true; } }
  return false;
});

/* ---------- past shelf life ---------- */
// Pieces older than their shelf life that haven't been sold: discard them, or update the count when some went without being recorded.
// Opens when the app starts (and when it comes back after a while) until nothing is left to sort out.
const canClear = () => R.can("bake.record") || R.can("stock.waste") || R.can("sale");
export function expirySheet() {
  const lots = M.expiredLots(); if (!lots.length) { if (ui.sheet && ui.sheet.kind === "expiry") { closeSheet(); toast("Nothing left past its shelf life"); } return; }
  const total = lots.reduce((s, l) => s + l.left, 0);
  openSheet({ kind: "expiry", lots, redraw: expirySheet }, `<div class="sh-head"><h2 class="h">Past shelf life</h2><button class="x" data-close aria-label="Close">×</button></div>
  <p class="hint" style="margin-top:-4px">${total} piece${total > 1 ? "s" : ""} older than their shelf life haven’t been sold. Discard them, or update the count if some were sold or used without being recorded. This comes back each time the app opens until it’s cleared.</p>
  <div class="kv">${lots.map((l, i) => `<div class="exprow"><span><b>${esc(l.item)}</b><small class="mut" style="display:block">Batch ${l.b.no ? "#" + esc(l.b.no) : ""} · made ${esc(dLong(l.date))} · ${l.life}-day life, expired ${esc(dLong(l.expires))}</small></span>
    <span class="side"><b class="due">${l.left} left</b><span class="exbtns"><button class="paybtn dangerbtn" data-expdis="${i}">Discard ${l.left}</button><button class="linkbtn" data-expupd="${i}">Update count</button></span></span></div>`).join("")}</div>
  ${lots.length > 1 ? `<button class="btn btn-danger-solid" data-expall>Discard all ${total} pieces</button>` : ""}
  <button class="btn btn-ghost" data-close>Later</button>`);
}
// gone: pieces leaving this batch's count. how: "discarded" (thrown away) or "cleared" (sold or used without a record). With ERP, finished-goods stock at this location changes too.
async function clearLot(l, gone, how) {
  const raw = ev.get("bakes", l.b.id); const b = M.batches().find(x => x.id === l.b.id); if (!raw || !b || gone <= 0) return;
  const lines = b.lines.map((x, ix) => ix === l.ix ? { ...x, [how]: (x[how] || 0) + gone } : x);
  await ev.put("bakes", clean({ ...raw, lines }));
  if (M.erpOn()) await ev.put("fg", { id: uid("f"), loc: M.here(), item: l.item, qty: -gone, type: how === "discarded" ? "waste" : "count", date: today(), note: `Past shelf life · batch ${b.no ? "#" + b.no : ""}` });
  sync.soon();
}
H.expiryCheck = () => { if (R.me() && canClear() && !ui.sheet && M.expiredLots().length) expirySheet(); };
H.expiryBanner = () => { if (!canClear()) return ""; const lots = M.expiredLots(); if (!lots.length) return ""; const n = lots.reduce((s, l) => s + l.left, 0);
  return `<button class="banner bad expbanner" data-act="expiry">${n} piece${n > 1 ? "s" : ""} past shelf life · tap to discard or update</button>`; };
A.expiry = () => expirySheet();
H.click.push(async T => {
  const st = ui.sheet; if (!st || st.kind !== "expiry") return false;
  const d = T.closest("[data-expdis]"); if (d) { const l = st.lots[+d.dataset.expdis];
    if (await yesNo(`<p class="cq">Discard ${l.left} ${esc(l.item)}?</p><div class="cdetail">Batch ${l.b.no ? "#" + esc(l.b.no) : ""}, made ${esc(dLong(l.date))}. Recorded as discarded.</div>`, "Discard", "btn-danger-solid")) { await clearLot(l, l.left, "discarded"); toast(`${l.left} ${l.item} discarded`); expirySheet(); } return true; }
  const u = T.closest("[data-expupd]"); if (u) { const l = st.lots[+u.dataset.expupd];
    const ok = await ask(`<p class="cq">${esc(l.item)}: how many are really left?</p><div class="cdetail">Batch ${l.b.no ? "#" + esc(l.b.no) : ""} should have ${l.left}. Pieces not there were sold or used without a record.</div><input class="in" id="expN" inputmode="numeric" value="0" style="margin-top:12px;text-align:center;font-size:22px">`, [{ label: "Cancel", cls: "btn-ghost", value: false }, { label: "Save count", cls: "btn-primary", value: true }], true);
    if (!ok) return true; const n = Math.round(+($("#expN") || {}).value || 0); if (!(n >= 0 && n <= l.left)) { toast(`Enter a number from 0 to ${l.left}`); return true; }
    if (l.left - n) await clearLot(l, l.left - n, "cleared");
    toast(n ? `${n} still there and past shelf life: discard them` : "Count updated"); expirySheet(); return true; }
  if (T.closest("[data-expall]")) { const total = st.lots.reduce((s, l) => s + l.left, 0);
    if (await yesNo(`<p class="cq">Discard all ${total} pieces?</p><div class="cdetail">${st.lots.map(l => `${esc(l.item)} × ${l.left}`).join("<br>")}</div>`, "Discard all", "btn-danger-solid")) { for (const l of st.lots) await clearLot(l, l.left, "discarded"); toast(`${total} pieces discarded`); expirySheet(); } return true; }
  return false;
});
