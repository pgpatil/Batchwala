// Buying and stock controls: the supplier's bill checked against the GRN (and the PO), rate contracts with suppliers, returnable
// packaging (crates and trays out with customers, outlets or suppliers), and lot tracing from a GRN to batches to customers and back.
import * as ev from "./events.js";
import * as sync from "./sync.js";
import * as M from "./model.js";
import * as R from "./roles.js";
import { asLines, layoutSwitch } from "./table.js";
import { S, V, H, guard, band, clean } from "./core.js";
import { putMove } from "./inventory.js";
import { esc, rs, rs2, num, uid, today, addDays, dLong, dLabel, qty, UNITS, ICON, copyText } from "./util.js";
import { ui, toast, openSheet, closeSheet, yesNo } from "./ui.js";

const r2 = v => Math.round(v * 100) / 100;
const big = u => UNITS[u] || null;
const perBig = (i, v) => { const b = big(i.unit); return `${rs2(v * (b ? b.f : 1))}/${b ? b.big : i.unit}`; };

/* ---------- supplier bill against the GRN (and the PO) ---------- */
// The bill's state: none yet, matching the GRN (within ₹1), or differing (accepted as what is owed, or held to sort out).
export const billState = g => !g.bill ? "none" : Math.abs((+g.bill.total || 0) - (+g.total || 0)) <= 1 ? "matched" : g.bill.use ? "accepted" : "differs";
const BILL_TAG = { none: ["t-camp", "No bill yet"], matched: ["t-paid", "Bill matches"], accepted: ["t-part", "Bill differs · accepted"], differs: ["t-due", "Bill differs"] };
H.grnAttention = () => M.grns().filter(g => !g.void && (billState(g) === "differs" || (billState(g) === "none" && g.date < addDays(today(), -7)))).length;
H.grnExtras = g => {
  if (g.void) return ""; const ings = M.ingMap(); const st = billState(g); const po = g.poId && ev.get("porders", g.poId); const [cls, lbl] = BILL_TAG[st]; const b = g.bill;
  const poRows = po ? g.lines.map(l => { const pl = po.lines.find(x => x.ingId === l.ingId); const i = ings[l.ingId]; if (!pl || !i || !l.qty || !pl.rate) return ""; const got = l.amount / l.qty; const d = (got - pl.rate) / pl.rate * 100;
    return `<tr><td>${esc(i.name)}</td><td class="r">${perBig(i, pl.rate)}</td><td class="r">${perBig(i, got)}</td><td class="r">${Math.abs(d) < 1 ? "–" : `<b class="${d > 0 ? "due" : ""}">${d > 0 ? "+" : ""}${Math.round(d)}%</b>`}</td></tr>`; }).join("") : "";
  return `<label class="f" style="margin-top:12px">Supplier bill <span class="tag ${cls}">${lbl}</span></label>
  ${b ? `<div class="kv"><div><span>Bill ${esc(b.no || "")} · ${esc(dLong(b.date))}</span><span>${rs2(b.total)}</span></div><div><span>GRN total</span><span>${rs2(g.total)}</span></div>${st !== "matched" ? `<div><span>Difference</span><b class="due">${b.total > g.total ? "+" : "−"}${rs2(Math.abs(b.total - g.total))}</b></div>` : ""}</div>
    ${st === "differs" ? `<p class="hint">Payables still use the GRN total. Accept the bill, or raise a debit note for the difference.</p>` : ""}` : `<p class="hint">Enter the supplier’s bill to check it against what was received${po ? " and the PO" : ""}.</p>`}
  ${poRows ? `<div class="card tablecard" style="margin:8px 0 0"><table class="reg"><thead><tr><th>Material</th><th class="r">PO rate</th><th class="r">GRN rate</th><th class="r">Diff</th></tr></thead><tbody>${poRows}</tbody></table></div>` : ""}
  <div class="btnrow">${R.can("stock.buy") || R.can("payables") ? `<button class="btn btn-ghost" data-billnew="${esc(g.id)}">${b ? "Change bill" : "Enter supplier bill"}</button>${st === "differs" ? `<button class="btn btn-ghost" data-billuse="${esc(g.id)}">Accept the bill’s total</button>` : ""}` : ""}<button class="btn btn-ghost" data-trace="grn:${esc(g.id)}">Trace this delivery</button></div>`;
};
function billSheet(id) {
  const g = M.grns().find(x => x.id === id); if (!g) return; const b = g.bill || {};
  openSheet({ kind: "billNew", id, redraw: () => billSheet(id) }, `<div class="sh-head"><h2 class="h">Supplier bill · ${esc(g.no)}</h2><button class="x" data-close aria-label="Close">×</button></div>
  <p class="hint" style="margin-top:-4px">${esc(g.supplier)} · GRN amount ${rs2(g.amount)} + tax ${rs2(g.tax || 0)} = ${rs2(g.total)}</p>
  <div class="two"><div><label class="f" for="bNo">Bill number</label><input class="in" id="bNo" value="${esc(b.no || g.invoiceNo || "")}"></div><div><label class="f" for="bDate">Bill date</label><input class="in" id="bDate" type="date" value="${esc(b.date || g.date)}"></div></div>
  <div class="two"><div><label class="f" for="bAmt">Amount before tax ₹</label><input class="in" id="bAmt" inputmode="decimal" value="${b.amount ?? ""}" placeholder="${g.amount}"></div><div><label class="f" for="bTax">Tax ₹</label><input class="in" id="bTax" inputmode="decimal" value="${b.tax ?? ""}" placeholder="${g.tax || 0}"></div></div>
  <button class="btn btn-primary" data-billsave="${esc(id)}">Check and save</button>`);
}
async function saveBill(id) {
  const g = M.grns().find(x => x.id === id); const v = k => document.getElementById(k).value; const amount = r2(v("bAmt").trim() === "" ? g.amount : num(v("bAmt"))), tax = r2(v("bTax").trim() === "" ? (g.tax || 0) : num(v("bTax")));
  const total = r2(amount + tax); const diff = r2(total - g.total); let use = Math.abs(diff) <= 1;
  if (!use) use = !!await yesNo(`<p class="cq">The bill is ${rs2(Math.abs(diff))} ${diff > 0 ? "more" : "less"} than the GRN</p><div class="cdetail">Bill ${rs2(total)} · GRN ${rs2(g.total)}.<br><br>Owe the bill’s total, or keep the GRN’s and sort the difference out with the supplier (a debit note, or a corrected bill)?</div>`, "Owe the bill’s total", "btn-primary", "Keep the GRN’s");
  await ev.put("grns", { ...clean(ev.get("grns", id)), bill: { no: v("bNo").trim(), date: v("bDate") || g.date, amount, tax, total, use, at: new Date().toISOString(), by: (R.me() || {}).id || "" } }); sync.soon();
  toast(Math.abs(diff) <= 1 ? "Bill matches the GRN" : use ? "Bill saved · payables use its total" : "Bill saved · flagged to sort out"); H.grnDetail(id);
}

/* ---------- rate contracts ---------- */
export const contracts = () => ev.all("contracts");
H.contractHint = (sup, i, rate) => { const c = M.contractRate(sup, i.id); if (!c) return ""; const d = (rate - c) / c * 100; return Math.abs(d) < 1 ? ` · at contract rate` : ` · <b class="${d > 0 ? "due" : ""}">${d > 0 ? "+" : ""}${Math.round(d)}% vs contract ${perBig(i, c)}</b>`; };
H.supExtras = name => { const ings = M.ingMap(); const t = today(); const cs = contracts().filter(c => M.nameKey(c.supplier) === M.nameKey(name)).sort((a, b) => (ings[a.ingId] || {}).name < (ings[b.ingId] || {}).name ? -1 : 1);
  return `<label class="f" style="margin-top:12px">Rate contracts</label>${cs.length ? `<div class="kv">${cs.map(c => { const i = ings[c.ingId]; if (!i) return ""; const live = (!c.from || c.from <= t) && (!c.to || c.to >= t);
    return `<div><span>${esc(i.name)} <small class="mut">${c.from ? esc(dLong(c.from)) : "any time"} – ${c.to ? esc(dLong(c.to)) : "open"}${c.minQty ? ` · min ${qty(c.minQty, i.unit)}` : ""}</small>${live ? "" : ` <span class="tag t-camp">${c.to && c.to < t ? "Ended" : "Not started"}</span>`}</span><span>${perBig(i, c.rate)}${R.can("stock.buy") ? ` <button class="linkbtn" data-ctdel="${esc(c.id)}" aria-label="Remove">×</button>` : ""}</span></div>`; }).join("")}</div>` : `<p class="hint">Agreed prices with this supplier. New POs use them first, and GRNs flag a bill that doesn’t.</p>`}
  ${R.can("stock.buy") ? `<button class="btn btn-ghost" data-ctnew="${esc(name)}">Add a rate contract</button>` : ""}`; };
function contractSheet(name) {
  const mats = M.ingredients().filter(i => i.type !== "sf"); if (!mats.length) { toast("Add materials first"); return; } const st = { kind: "ctNew", name, ingId: mats[0].id }; st.redraw = () => drawCt(st); drawCt(st);
}
function drawCt(st) {
  const mats = M.ingredients().filter(i => i.type !== "sf"); const i = mats.find(m => m.id === st.ingId) || mats[0]; const b = big(i.unit);
  openSheet(st, `<div class="sh-head"><h2 class="h">Rate contract · ${esc(st.name)}</h2><button class="x" data-close aria-label="Close">×</button></div>
  <label class="f" for="ctIng">Material</label><select class="in" id="ctIng">${mats.map(m => `<option value="${esc(m.id)}" ${m.id === i.id ? "selected" : ""}>${esc(m.name)}</option>`).join("")}</select>
  <div class="two"><div><label class="f" for="ctRate">Rate ₹ per ${b ? b.big : esc(i.unit)}</label><input class="in" id="ctRate" inputmode="decimal" placeholder="${M.lastRate(st.name, i.id) ? r2(M.lastRate(st.name, i.id) * (b ? b.f : 1)) : ""}"></div><div><label class="f" for="ctMin">Minimum order (${b ? b.big : esc(i.unit)})</label><input class="in" id="ctMin" inputmode="decimal" placeholder="Optional"></div></div>
  <div class="two"><div><label class="f" for="ctFrom">From</label><input class="in" id="ctFrom" type="date" value="${today()}"></div><div><label class="f" for="ctTo">Until</label><input class="in" id="ctTo" type="date" value="${addDays(today(), 90)}"></div></div>
  <button class="btn btn-primary" data-ctsave>Save rate contract</button>`);
}

/* ---------- returnable packaging ---------- */
// Crates, trays and cake stands are packing materials marked returnable. Sending them out takes them off the shelf and onto
// the party holding them; getting them back puts them back. "lends" keeps who holds how many.
export const returnables = () => M.ingredients().filter(i => i.returnable);
const lends = () => ev.all("lends");
export function holdings() { const by = {}; lends().forEach(l => { const k = l.party + "|" + l.ingId; const x = by[k] = by[k] || { party: l.party, ingId: l.ingId, qty: 0, since: "" }; x.qty += +l.qty || 0; if (l.qty > 0 && (!x.since || l.date < x.since)) x.since = l.date; });
  return Object.values(by).filter(x => Math.abs(x.qty) > 1e-9); }
V.rtn = () => {
  const items = returnables(); const hold = holdings(); const sm = M.stockMap(); const t = today();
  let h = band("Returnables", R.can("stock.count") || R.can("sale") || R.can("deliver") ? `<button class="pillbtn" data-rtnmove="out">Send out</button><button class="pillbtn" data-rtnmove="back">Got back</button>` : "",
    `<div class="stats">${items.map(i => { const out = hold.filter(x => x.ingId === i.id).reduce((s, x) => s + x.qty, 0); return `<div class="st"><b>${Math.max(0, sm[i.id] || 0)} + ${out}</b><span>${esc(i.name)}: here + out</span></div>`; }).join("") || `<div class="st"><b>0</b><span>returnable items</span></div>`}</div>`);
  if (!items.length) return h + `<div class="empty"><strong>No returnable packaging yet</strong>Mark crates, trays or cake stands as returnable on the packing material (Inventory → edit). Then record them going out with an order, an outlet or a supplier, and coming back.</div>`;
  h += `<div class="tools">${layoutSwitch("rtn")}</div>`;
  if (!hold.length) return h + `<div class="empty"><strong>Everything is in</strong>Nobody holds any crates or trays.</div>`;
  const ings = M.ingMap(); const rows = hold.sort((a, b) => a.since < b.since ? -1 : 1);
  return h + `<div class="card tablecard"><table class="reg"><thead><tr><th>Who has them</th><th>Item</th><th class="r">Out</th><th>Since</th><th></th></tr></thead><tbody>${rows.map(x => { const days = x.since ? Math.round((new Date(t) - new Date(x.since)) / 864e5) : 0;
    return `<tr><td><b>${esc(x.party)}</b></td><td>${esc((ings[x.ingId] || {}).name || "?")}</td><td class="r">${x.qty}</td><td data-v="${esc(x.since)}">${x.since ? esc(dLabel(x.since)) + (days > 7 ? ` <span class="tag t-due">${days} days</span>` : "") : "–"}</td><td><button class="linkbtn" data-rtnback="${esc(x.party)}|${esc(x.ingId)}">Got back</button></td></tr>`; }).join("")}</tbody></table></div>`;
};
function rtnSheet(dir, pre = {}) {
  const items = returnables(); if (!items.length) { toast("Mark a packing material as returnable first"); return; }
  const st = { kind: "rtnMove", dir, ingId: pre.ingId || items[0].id, party: pre.party || "", qty: pre.qty || "" }; st.redraw = () => drawRtn(st); drawRtn(st);
}
function drawRtn(st) {
  const items = returnables(); const parties = [...new Set([...M.customers().map(c => c.customer + (c.flat ? " · " + c.flat : "")), ...M.locations().map(l => l.name), ...M.suppliers().map(s => s.name), ...holdings().map(h => h.party)])].sort();
  const held = st.party ? holdings().find(h => h.party === st.party && h.ingId === st.ingId) : null;
  openSheet(st, `<div class="sh-head"><h2 class="h">${st.dir === "out" ? "Send out" : "Got back"}</h2><button class="x" data-close aria-label="Close">×</button></div>
  <label class="f" for="rtIng">Item</label><select class="in" id="rtIng">${items.map(i => `<option value="${esc(i.id)}" ${i.id === st.ingId ? "selected" : ""}>${esc(i.name)}</option>`).join("")}</select>
  <label class="f" for="rtParty">${st.dir === "out" ? "Given to" : "Returned by"}</label><input class="in" id="rtParty" list="rtParties" value="${esc(st.party)}" placeholder="Customer, outlet or supplier" autocomplete="off"><datalist id="rtParties">${parties.map(p => `<option value="${esc(p)}">`).join("")}</datalist>
  ${held ? `<p class="hint">${esc(st.party)} has ${held.qty}.</p>` : ""}
  <div class="two"><div><label class="f" for="rtQty">How many</label><input class="in" id="rtQty" inputmode="numeric" value="${esc(st.qty)}"></div><div><label class="f" for="rtNote">Note</label><input class="in" id="rtNote" placeholder="e.g. order #P-58"></div></div>
  <button class="btn btn-primary" data-rtnsave>Save</button>`);
}
async function saveRtn(st) {
  const g = id => document.getElementById(id); const party = g("rtParty").value.trim(); const n = Math.round(num(g("rtQty").value)); const i = M.ingMap()[g("rtIng").value];
  if (!party) { toast("Who is it with?"); return; } if (!(n > 0)) { toast("Enter how many"); return; }
  if (st.dir === "back") { const held = (holdings().find(h => h.party === party && h.ingId === i.id) || { qty: 0 }).qty; if (n > held && !await yesNo(`<p class="cq">${esc(party)} only had ${held}</p><div class="cdetail">Record ${n} back anyway?</div>`, "Record")) return; }
  const id = uid("ln"); const q = st.dir === "out" ? n : -n;
  await ev.put("lends", { id, date: today(), ingId: i.id, party, qty: q, note: g("rtNote").value.trim(), by: (R.me() || {}).id || "" });
  await putMove({ ingId: i.id, type: "lend", qty: -q, note: `${st.dir === "out" ? "Out to" : "Back from"} ${party}`, ref: id }); sync.soon(); closeSheet(); toast(`${n} ${i.name} ${st.dir === "out" ? "out to" : "back from"} ${party}`); H.render();
}

/* ---------- lot tracing ---------- */
// Batches record which GRN lots their materials came from (oldest stock first). Orders aren't scanned, so the customers who may
// have had a batch are those who got that item, at that location, between its baking day and the end of its shelf life.
const batchLots = b => [...(b.lots || []), ...((b.wo && (ev.get("wos", b.wo) || {}).lots) || [])];
function ordersFor(b) { const home = M.locations()[0].id; const loc = b.outletId || home; const out = [];
  b.lines.forEach(l => { const m = M.menuByName(l.item); const end = addDays(b.date, M.shelfLife(m) - 1);
    M.orders(false).filter(o => o.date >= b.date && o.date <= end && o.items.some(i => i.item === l.item) && (M.locations().length < 2 || (o.outletId || home) === loc || M.PREORDER.includes(o.channel))).forEach(o => out.push({ o, item: l.item })); });
  return out; }
function batchesForOrder(o) { return o.items.flatMap(i => { const m = M.menuByName(i.item); const from = addDays(o.date, -(M.shelfLife(m) - 1)); return M.batches().filter(b => !b.void && b.date >= from && b.date <= o.date && b.lines.some(l => l.item === i.item)).map(b => ({ b, item: i.item })); }); }
function traceSheet(kind, id) {
  const ings = M.ingMap(); let title = "", body = "";
  const lotRows = lots => { const by = {}; lots.forEach(l => { const k = l.ingId + "|" + l.grnId; by[k] = by[k] || { ...l, qty: 0 }; by[k].qty += l.qty; });
    return Object.values(by).map(l => { const i = ings[l.ingId] || { name: "?", unit: "" }; const g = l.grnId && M.grns().find(x => x.id === l.grnId); const gl = g && g.lines.find(x => x.ingId === l.ingId);
      return `<tr><td>${esc(i.name)}</td><td class="r">${qty(l.qty, i.unit)}</td><td>${g ? `<button class="linkbtn" data-grn="${esc(g.id)}">${esc(g.no)}</button> · ${esc(g.supplier)}` : `<span class="mut">no GRN (counted or older stock)</span>`}</td><td>${esc((gl && gl.lot) || "")}${gl && gl.exp ? ` <small class="mut">bb ${esc(dLong(gl.exp))}</small>` : ""}</td></tr>`; }).join(""); };
  const custRows = list => { const by = new Map(); list.forEach(({ o, item }) => { const k = o.id; if (!by.has(k)) by.set(k, { o, items: new Set() }); by.get(k).items.add(item); });
    return [...by.values()].sort((a, b) => a.o.date < b.o.date ? -1 : 1).map(({ o, items }) => `<tr><td>${esc(dLong(o.date))}</td><td><button class="linkbtn" data-open="${esc(o.id)}">${esc(o.no)}</button></td><td>${esc(o.customer || M.CHANNELS[o.channel])}${o.flat ? ` <small class="mut">${esc(o.flat)}</small>` : ""}</td><td>${R.can("phone") ? esc(o.phone || "") : ""}</td><td>${esc([...items].join(", "))}</td></tr>`).join(""); };
  let custList = [];
  if (kind === "grn") { const g = M.grns().find(x => x.id === id); title = `Trace ${g.no}`; const bs = M.batches().filter(b => !b.void && batchLots(b).some(l => l.grnId === id));
    custList = bs.flatMap(ordersFor);
    body = `<p class="hint" style="margin-top:-4px">${esc(g.supplier)} · received ${esc(dLong(g.date))}</p><label class="f">Batches that used it · ${bs.length}</label>${bs.length ? `<div class="kv">${bs.map(b => `<div><button class="linkbtn" data-batch="${esc(b.id)}">#${esc(b.no)}</button><span>${esc(dLong(b.date))} · ${esc(M.batchText(b))}</span></div>`).join("")}</div>` : `<p class="hint">No batch has used it yet (or it was used before tracing began).</p>`}`; }
  if (kind === "batch") { const b = M.batches().find(x => x.id === id); title = `Trace batch #${b.no}`; custList = ordersFor(b); const lots = batchLots(b);
    body = `<p class="hint" style="margin-top:-4px">${esc(dLong(b.date))} · ${esc(M.batchText(b))}</p><label class="f">Materials and where they came from</label>${lots.length ? `<div class="card tablecard" style="margin:0"><table class="reg"><thead><tr><th>Material</th><th class="r">Qty</th><th>GRN · supplier</th><th>Lot</th></tr></thead><tbody>${lotRows(lots)}</tbody></table></div>` : `<p class="hint">This batch was saved before tracing began.</p>`}`; }
  if (kind === "order") { const o = M.orders().find(x => x.id === id); title = `Trace order ${o.no}`; const bs = batchesForOrder(o);
    body = `<p class="hint" style="margin-top:-4px">${esc(o.customer)} · ${esc(dLong(o.date))}</p><label class="f">Batches it could have come from</label>${bs.length ? `<div class="kv">${bs.map(({ b, item }) => `<div><button class="linkbtn" data-batch="${esc(b.id)}">#${esc(b.no)}</button><span>${esc(item)} · ${esc(dLong(b.date))}</span></div>`).join("")}</div>
      <label class="f" style="margin-top:10px">Their materials</label><div class="card tablecard" style="margin:0"><table class="reg"><thead><tr><th>Material</th><th class="r">Qty</th><th>GRN · supplier</th><th>Lot</th></tr></thead><tbody>${lotRows(bs.flatMap(x => batchLots(x.b))) || `<tr><td colspan="4">No lots recorded.</td></tr>`}</tbody></table></div>` : `<p class="hint">No batch of these items within their shelf life before this date.</p>`}`; }
  const cr = custRows(custList); const n = new Set(custList.map(x => x.o.id)).size;
  openSheet({ kind: "trace", redraw: () => traceSheet(kind, id) }, `<div class="sh-head"><h2 class="h">${esc(title)}</h2><button class="x" data-close aria-label="Close">×</button></div>${body}
  ${kind !== "order" ? `<label class="f" style="margin-top:12px">Orders that may have had it · ${n}</label>${cr ? `<div class="card tablecard" style="margin:0"><table class="reg"><thead><tr><th>Date</th><th>Order</th><th>Customer</th><th>Phone</th><th>Items</th></tr></thead><tbody>${cr}</tbody></table></div>
    ${R.can("phone") ? `<button class="btn btn-ghost" data-tracecopy>Copy the customer list (recall)</button>` : ""}` : `<p class="hint">None.</p>`}<p class="hint">Orders aren’t scanned, so this lists everyone who got the item at that location between its baking day and the end of its shelf life.</p>` : ""}`);
  S.traceCopy = [...new Map(custList.map(x => [x.o.id, x.o])).values()].map(o => `${o.customer}${o.flat ? " " + o.flat : ""}${o.phone ? " " + o.phone : ""} · order ${o.no} · ${o.date}`).join("\n");
}
// The trace buttons on a batch and an order.
H.batchExtras = b => `<button class="btn btn-ghost" data-trace="batch:${esc(b.id)}">Trace this batch</button>`;
{ const prev = H.orderExtras; H.orderExtras = o => (prev ? prev(o) : "") + (R.can("money") || R.can("orders.edit") ? `<button class="btn btn-ghost" data-trace="order:${esc(o.id)}">Trace (materials and batches)</button>` : ""); }

/* ---------- actions ---------- */
H.click.push(async T => {
  const bn = T.closest("[data-billnew]"); if (bn) { if (!R.can("stock.buy") && !R.can("payables")) return true; billSheet(bn.dataset.billnew); return true; }
  const bs = T.closest("[data-billsave]"); if (bs) { await saveBill(bs.dataset.billsave); return true; }
  const bu = T.closest("[data-billuse]"); if (bu) { const g = ev.get("grns", bu.dataset.billuse); if (await yesNo(`<p class="cq">Owe the bill’s total?</p><div class="cdetail">${rs2(g.bill.total)} instead of the GRN’s ${rs2(g.total)}.</div>`, "Owe the bill’s total")) { await ev.put("grns", { ...clean(g), bill: { ...g.bill, use: true } }); sync.soon(); H.grnDetail(g.id); } return true; }
  const cn = T.closest("[data-ctnew]"); if (cn) { if (!guard("stock.buy")) return true; contractSheet(cn.dataset.ctnew); return true; }
  if (T.closest("[data-ctsave]")) { const st = ui.sheet; const g = id => document.getElementById(id); const i = M.ingMap()[g("ctIng").value]; const b = big(i.unit); const f = b ? b.f : 1; const rate = num(g("ctRate").value);
    if (!(rate > 0)) { toast("Enter the agreed rate"); return true; } if (g("ctTo").value && g("ctFrom").value && g("ctTo").value < g("ctFrom").value) { toast("Until is before From"); return true; }
    await ev.put("contracts", { id: uid("ct"), supplier: st.name, ingId: i.id, rate: rate / f, minQty: num(g("ctMin").value) * f || 0, from: g("ctFrom").value, to: g("ctTo").value, by: (R.me() || {}).id || "" }); sync.soon(); toast("Rate contract saved"); H.supSheet ? H.supSheet(st.name) : closeSheet(); return true; }
  const cd = T.closest("[data-ctdel]"); if (cd) { const c = ev.get("contracts", cd.dataset.ctdel); if (c && await yesNo(`<p class="cq">Remove this rate contract?</p>`, "Remove", "btn-danger-solid")) { await ev.del("contracts", c.id); sync.soon(); H.supSheet && H.supSheet(c.supplier); } return true; }
  const rm = T.closest("[data-rtnmove]"); if (rm) { rtnSheet(rm.dataset.rtnmove); return true; }
  const rb = T.closest("[data-rtnback]"); if (rb) { const [party, ingId] = rb.dataset.rtnback.split("|"); const h = holdings().find(x => x.party === party && x.ingId === ingId); rtnSheet("back", { party, ingId, qty: h ? h.qty : "" }); return true; }
  if (T.closest("[data-rtnsave]")) { await saveRtn(ui.sheet); return true; }
  const tr = T.closest("[data-trace]"); if (tr) { const [k, id] = tr.dataset.trace.split(":"); traceSheet(k, id); return true; }
  if (T.closest("[data-tracecopy]")) { toast(await copyText(S.traceCopy || "") ? "Customer list copied" : "Couldn’t copy here"); return true; }
  return false;
});
H.change.push(T => { const st = ui.sheet;
  if (st && st.kind === "ctNew" && T.id === "ctIng") { st.ingId = T.value; drawCt(st); return true; }
  if (st && st.kind === "rtnMove" && (T.id === "rtIng" || T.id === "rtParty")) { st.ingId = document.getElementById("rtIng").value; st.party = document.getElementById("rtParty").value.trim(); st.qty = document.getElementById("rtQty").value; drawRtn(st); return true; }
  return false; });
