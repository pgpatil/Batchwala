// ERP: production for a kitchen, purchases received as GRNs, transfers between locations, finished-goods stock,
// and the outlet bake board that shows what the kitchen has sent. Used when the admin gives someone ERP mode.
import * as ev from "./events.js";
import * as sync from "./sync.js";
import * as M from "./model.js";
import * as R from "./roles.js";
import { asLines, layoutSwitch } from "./table.js";
import * as L from "./lock.js";
import { S, A, V, H, guard, chipBar, searchBox, band, clean } from "./core.js";
import { bakeSheet, putMove } from "./inventory.js";
import { $, esc, rs, rs2, num, uid, today, addDays, dLong, qty, UNITS, ICON, copyText, waHref } from "./util.js";
import { ui, toast, openSheet, closeSheet, yesNo } from "./ui.js";
import { confirmNew, byNameOrAka } from "./match.js";

const big = u => UNITS[u] || null;
// Unit chips for a quantity: base unit, kg / L, and the material's buying pack when it has one. attr is "name=\"index" (closed by the factor).
export const unitOpts = i => { const b = big(i.unit); const p = M.packOf(i); return [[i.unit, 1], ...(b ? [[b.big, b.f]] : []), ...(p ? [[`${p.name} (${qty(p.size, i.unit)})`, p.size]] : [])]; };
const unitPick = (i, f, attr) => { const o = unitOpts(i); return o.length > 1 ? `<div class="chips unitchips">${o.map(([n, v]) => `<button class="chip" data-${attr}:${v}" aria-pressed="${f === v}">${esc(n)}</button>`).join("")}</div>` : `<span class="unitlbl">${esc(i.unit)}</span>`; };
const rateDiff = (got, po, i) => { const d = (got - po) / po * 100; const b = big(i.unit); return Math.abs(d) < 2 ? ` · at PO rate` : ` · <b class="${d > 0 ? "due" : ""}">${d > 0 ? "+" : ""}${Math.round(d)}% vs PO ${rs2(po * (b ? b.f : 1))}/${b ? b.big : i.unit}</b>`; };
// A rise of the alert % or more over the material's previous GRN price is flagged as the bill is entered.
const priceHint = (got, i) => { const p = M.prevGrnRate(i.id); if (!p) return ""; const d = (got - p) / p * 100; const b = big(i.unit); return d >= +(M.config().priceAlertPct ?? 5) ? ` · <b class="due">+${Math.round(d)}% vs last ${rs2(p * (b ? b.f : 1))}/${b ? b.big : i.unit}</b>` : ""; };
const who = x => { const m = ev.get("members", x.by || x._by); return m ? m.name : ""; };
const prefix = () => R.numPrefix();
const r2 = v => Math.round(v * 100) / 100;
const dateChips = (attr, d) => { const t = today(); return `<div class="chips">${[t, addDays(t, 1), addDays(t, 2)].map((x, i) => `<button class="chip" data-${attr}="${x}" aria-pressed="${d === x}">${["Today", "Tomorrow", esc(dLong(x))][i]}</button>`).join("")}</div>`; };
const locOpts = (sel, list = M.locations()) => list.map(l => `<option value="${esc(l.id)}" ${l.id === sel ? "selected" : ""}>${esc(l.name)}${l.kind === "kitchen" ? " (kitchen)" : ""}</option>`).join("");
const prodKitchen = () => { const k = M.kitchens(); const pick = S.prodKitchen || M.here(); return (k.find(x => x.id === pick) || k[0] || M.locations()[0]).id; };
// Production quantities feed the batch sheet and the BOM plan while in ERP mode.
H.prodLines = date => M.production(date, prodKitchen()).filter(r => r.toBake > 0).map(r => ({ item: r.item, qty: r.toBake }));
H.prodKitchen = prodKitchen;

/* ---------- Production (kitchen) ---------- */
V.prod = () => {
  const d = S.prodDate || today(); const k = prodKitchen(); const rows = M.production(d, k); const outs = M.sellingLocs().filter(l => l.id !== k);
  const bakedToday = M.bakesOn(d).filter(b => (b.outletId || M.locations()[0].id) === k);
  const toBake = rows.reduce((s, r) => s + r.toBake, 0);
  let h = band(`Production · ${esc(M.locName(k))}`, `<button class="pillbtn" data-planopen>${ICON.plan}Planning</button>`,
    `<div class="stats"><div class="st"><b>${toBake}</b><span>pieces to bake</span></div><div class="st"><b>${rows.reduce((s, r) => s + r.atKitchen, 0)}</b><span>ready at kitchen</span></div><div class="st"><b>${bakedToday.length}</b><span>batch${bakedToday.length === 1 ? "" : "es"} ${d === today() ? "today" : "for this day"}</span></div></div>`);
  h += `<div class="tools">${dateChips("proddate", d)}${layoutSwitch("prod")}${M.kitchens().length > 1 ? `<div class="chips">${M.kitchens().map(x => `<button class="chip" data-prodk="${esc(x.id)}" aria-pressed="${x.id === k}">${esc(x.name)}</button>`).join("")}</div>` : ""}</div>`;
  if (!rows.length) h += `<div class="empty"><strong>Nothing needed for ${esc(dLong(d))}</strong>Pre-orders and kept-ready levels at every outlet, less what they already hold, appear here.</div>`;
  else if (asLines("prod")) h += `<div class="card tablecard"><table class="reg"><thead><tr><th>Item</th>${outs.map(l => `<th class="r">${esc(l.name)}</th>`).join("")}${M.sellingLocs().some(l => l.id === k) ? `<th class="r">${esc(M.locName(k))}</th>` : ""}<th class="r">Need</th><th class="r">At kitchen</th><th class="r">To bake</th></tr></thead>
    <tbody>${rows.map(r => `<tr><td><b>${esc(r.item)}</b></td>${outs.map(l => `<td class="r">${r.byLoc[l.id] || "–"}</td>`).join("")}${M.sellingLocs().some(l => l.id === k) ? `<td class="r">${r.byLoc[k] || "–"}</td>` : ""}<td class="r">${r.need}</td><td class="r">${r.atKitchen}</td><td class="r"><b>${r.toBake || "–"}</b></td></tr>`).join("")}</tbody></table></div>`;
  else h += `<ul class="list">${rows.map(r => `<li class="row board${r.toBake ? "" : " done"}"><div class="who"><div class="nm big">${esc(r.item)}</div><div class="subl">${Object.entries(r.byLoc).map(([l, n]) => `${esc(M.locName(l))} ${n}`).join(" · ")}${r.atKitchen ? ` · ${r.atKitchen} at kitchen` : ""}</div></div><div class="side"><div class="bignum">${r.toBake}</div><small class="mut">to bake</small></div></li>`).join("")}</ul>`;
  h += `<div class="boardfoot">${R.can("bake.record") ? `<button class="btn btn-primary" data-prodbake="${d}">${ICON.oven}Record a batch</button>` : ""}
    ${R.can("transfer") && outs.length ? `<label class="f">Send to outlets</label><div class="btnrow">${outs.map(l => `<button class="btn btn-ghost" data-xferto="${esc(l.id)}">${ICON.truck}${esc(l.name)}</button>`).join("")}</div>` : ""}
    ${bakedToday.length ? `<label class="f">Batches</label><div class="kv">${bakedToday.map(b => `<div style="align-items:center"><button class="who" data-batch="${esc(b.id)}"><div class="nm" style="font-size:15px">${b.no ? "#" + esc(b.no) : "Batch"}</div><div class="subl">${esc(M.batchText(b))}</div></button><span class="chev">${ICON.chev}</span></div>`).join("")}</div>` : ""}</div>`;
  return h;
};

/* ---------- outlet bake board (restaurant mode with ERP on) ---------- */
const legacyBake = V.bake;
V.bake = () => R.mode() === "restaurant" ? outletBoardView() : legacyBake();
function outletBoardView() {
  const d = S.bakeDate || today(); const loc = M.here(); const rows = M.outletBoard(d, loc); const t = today();
  const inToday = M.transfers().filter(x => !x.void && x.to === loc && x.date === t && M.xferReceived(x));
  const coming = M.transfers().filter(x => !x.void && x.to === loc && !M.xferReceived(x));
  const short = rows.filter(r => r.short);
  S.askText = `🧁 ${M.locName(loc)} needs for ${dLong(d)}:\n` + short.map(r => `• ${r.item}: ${r.short}`).join("\n");
  let h = band(`Bake board · ${esc(M.locName(loc))}`, short.length ? `<button class="pillbtn" data-askcopy>${ICON.wa}Ask kitchen</button>` : "",
    `<div class="stats"><div class="st"><b>${rows.reduce((s, r) => s + Math.max(0, r.onHand), 0)}</b><span>pieces on hand</span></div><div class="st"><b>${rows.reduce((s, r) => s + r.committed, 0)}</b><span>pre-orders to hand over</span></div><div class="st"><b>${short.reduce((s, r) => s + r.short, 0)}</b><span>short · ask the kitchen</span></div></div>`);
  if (H.expiryBanner) h += `<div class="boardfoot" style="padding-bottom:0">${H.expiryBanner()}</div>`;
  h += `<div class="tools">${dateChips("bakedate", d)}${layoutSwitch("bake")}</div>`;
  if (coming.length) h += `<div class="boardfoot"><label class="f">On the way · confirm when it arrives</label><div class="kv">${coming.map(x => `<div style="align-items:center"><button class="who" data-xfer="${esc(x.id)}"><div class="nm" style="font-size:15px">${esc(x.no)} from ${esc(M.locName(x.from))}</div><div class="subl">${esc(xferText(x))}</div></button>${canReceive() ? `<button class="paybtn" data-xferrecv="${esc(x.id)}">Receive</button>` : ""}</div>`).join("")}</div></div>`;
  if (!rows.length) return h + `<div class="empty"><strong>Nothing here yet</strong>Pieces the kitchen sends to ${esc(M.locName(loc))} show here, with pre-orders and kept-ready levels.</div>`;
  if (asLines("bake")) h += `<div class="card tablecard"><table class="reg"><thead><tr><th>Item</th><th class="r">Pre-orders</th><th class="r">Kept ready</th><th class="r">On hand</th><th class="r">Sold</th><th class="r">On the way</th><th class="r">Short</th></tr></thead><tbody>${rows.map(r => `<tr${r.short ? ' class="shortrow"' : ""}><td><b>${esc(r.item)}</b></td><td class="r">${r.committed || "–"}</td><td class="r">${r.par || "–"}</td><td class="r">${r.onHand}</td><td class="r">${r.sold || "–"}</td><td class="r">${r.coming || "–"}</td><td class="r">${r.short ? `<b class="due">${r.short}</b>` : "–"}</td></tr>`).join("")}</tbody></table></div>`;
  else h += `<ul class="list">${rows.map(r => `<li class="row board${r.short ? "" : " done"}"><div class="who"><div class="nm big">${esc(r.item)}</div><div class="subl">${r.committed ? `${r.committed} pre-ordered · ` : ""}${r.par ? `${r.par} kept ready · ` : ""}${r.sold} sold${r.coming ? ` · <span class="tag t-part">${r.coming} on the way</span>` : ""}${r.short ? ` <span class="tag t-due">short ${r.short}</span>` : ""}</div></div><div class="side"><div class="bignum">${r.onHand}</div><small class="mut">on hand</small></div></li>`).join("")}</ul>`;
  if (inToday.length) h += `<div class="boardfoot"><label class="f">Received today</label><div class="kv">${inToday.map(x => `<div><button class="who" data-xfer="${esc(x.id)}"><div class="nm" style="font-size:15px">${esc(x.no)} from ${esc(M.locName(x.from))}</div><div class="subl">${esc(xferText(x))}</div></button></div>`).join("")}</div></div>`;
  return h;
}

/* ---------- Purchases (GRN) ---------- */
const grnTax = lines => { const by = {}; lines.forEach(l => { const r = +l.taxPct || 0; if (r && l.amount) by[r] = (by[r] || 0) + l.amount * r / 100; }); return by; };
function taxRows(by) { const t = M.taxCfg(); const out = []; Object.keys(by).sort((a, b) => a - b).forEach(r => { const v = r2(by[r]); if (t.split) { const h = r2(v / 2); out.push([`C${t.name} ${+r / 2}%`, h], [`S${t.name} ${+r / 2}%`, r2(v - h)]); } else out.push([`${t.name} ${+r}%`, v]); }); return out; }
V.grn = () => {
  S.filter.grn = S.filter.grn || "month"; const t = today(); const k = S.filter.grn; const tax = M.taxCfg().on;
  const from = { month: t.slice(0, 8) + "01", d30: addDays(t, -29), all: "0000" }[k];
  const q = (S.query.grn || "").toLowerCase().trim(); const ings = M.ingMap();
  const all = M.grns(); const list = all.filter(g => g.date >= from).filter(g => !q || (g.no + " " + g.supplier + " " + (g.invoiceNo || "") + " " + g.lines.map(l => (ings[l.ingId] || {}).name).join(" ")).toLowerCase().includes(q));
  const live = list.filter(g => !g.void); const spend = live.reduce((s, g) => s + (+g.total || 0), 0), taxPaid = live.reduce((s, g) => s + (+g.tax || 0), 0);
  const bySup = {}; live.forEach(g => { bySup[g.supplier] = (bySup[g.supplier] || 0) + (+g.total || 0); });
  let h = band("Purchases", R.can("stock.buy") ? `<button class="pillbtn" data-act="invoiceIn">${ICON.inbox}Upload invoice</button>` : "", `<div class="stats"><div class="st"><b>${rs(spend)}</b><span>received${tax ? ` · ${rs(taxPaid)} ${esc(M.taxCfg().name)}` : ""}</span></div><div class="st"><b>${live.length}</b><span>GRNs</span></div><div class="st"><b>${Object.keys(bySup).length}</b><span>suppliers</span></div></div>`);
  h += `<div class="tools">${searchBox("grn", "Search GRN, supplier, invoice or material")}${layoutSwitch("grn")}${chipBar("grn", [["month", "This month"], ["d30", "30 days"], ["all", "All"]])}</div>`;
  if (!all.length) return h + `<div class="empty"><strong>No goods received yet</strong>Record each delivery from a supplier as a GRN: what came, how much, the bill amount${tax ? " and tax" : ""}. It adds stock at the location that received it.${R.can("stock.buy") ? `<button class="btn btn-primary" data-act="newGrn" style="margin-top:14px">${ICON.inbox}New GRN</button>` : ""}</div>`;
  if (!list.length) return h + `<div class="empty"><strong>Nothing matches</strong>Try another search or period.</div>`;
  const items = g => g.lines.map(l => { const i = ings[l.ingId]; return `${i ? i.name : "?"} ${i ? qty(l.qty, i.unit) : l.qty}`; }).join(", ");
  h += asLines("grn") ? `<div class="card tablecard"><table class="reg"><thead><tr><th>GRN</th><th>Date</th><th>Supplier</th><th>Invoice</th>${M.locations().length > 1 ? "<th>At</th>" : ""}<th>Items</th><th class="r">Amount</th>${tax ? `<th class="r">Tax</th>` : ""}<th class="r">Total</th></tr></thead>
    <tbody>${list.map(g => `<tr data-grn="${esc(g.id)}" tabindex="0"${g.void ? ` class="void"` : ""}><td><b>${esc(g.no)}</b>${g.void ? ` <span class="tag t-due">Undone</span>` : ""}</td><td data-v="${esc(g.date)}">${esc(dLong(g.date))}</td><td>${esc(g.supplier)}</td><td>${esc(g.invoiceNo || "")}</td>${M.locations().length > 1 ? `<td>${esc(M.locName(g.loc))}</td>` : ""}<td class="items">${esc(items(g))}</td><td class="r">${rs2(g.amount)}</td>${tax ? `<td class="r">${g.tax ? rs2(g.tax) : "–"}</td>` : ""}<td class="r"><b>${rs2(g.total)}</b></td></tr>`).join("")}</tbody>
    <tfoot><tr><td colspan="${M.locations().length > 1 ? 6 : 5}">${live.length} GRN${live.length === 1 ? "" : "s"}</td><td class="r">${rs2(live.reduce((s, g) => s + (+g.amount || 0), 0))}</td>${tax ? `<td class="r">${rs2(taxPaid)}</td>` : ""}<td class="r">${rs2(spend)}</td></tr></tfoot></table></div>`
    : `<ul class="list">${list.map(g => `<li class="row${g.void ? " void" : ""}"><button class="who" data-grn="${esc(g.id)}"><div class="nm">${esc(g.no)} · ${esc(g.supplier)}</div><div class="subl">${esc(dLong(g.date))}${g.invoiceNo ? " · inv " + esc(g.invoiceNo) : ""}${g.void ? ` <span class="tag t-due">Undone</span>` : ""}</div><div class="subl">${esc(items(g))}</div></button><div class="amt">${rs(g.total)}</div></li>`).join("")}</ul>`;
  const sups = Object.entries(bySup).sort((a, b) => b[1] - a[1]);
  if (sups.length) h += `<div class="card"><h3>By supplier</h3><table><tbody>${sups.map(([n, v]) => `<tr><td>${esc(n)}</td><td>${rs(v)}</td></tr>`).join("")}</tbody></table></div>`;
  return h;
};
A.newGrn = () => grnSheet();
H.grnSheet = opts => grnSheet(opts);
H.grnDetail = id => grnDetail(id);
function grnSheet(opts = {}) {
  if (!guard("stock.buy")) return; const mats = M.ingredients().filter(i => i.type !== "sf");
  if (!mats.length) { toast("Add raw or packing materials in Inventory first"); return; }
  const line = id => { const i = mats.find(x => x.id === id) || mats[0]; return { ingId: i.id, qty: 0, f: M.packOf(i) ? M.packOf(i).size : big(i.unit) ? big(i.unit).f : 1, amount: 0, exp: "", lot: "", taxPct: M.taxCfg().on ? (i.taxPct != null && i.taxPct !== "" ? +i.taxPct : +M.taxCfg().rate || 0) : 0 }; };
  const first = opts.ingId ? mats.find(x => x.id === opts.ingId) : null;
  // opts.lines: a draft read from a supplier invoice ({ ingId, qty in base units, f, amount, taxPct or null }).
  const lines = opts.lines && opts.lines.length ? opts.lines.map(l => ({ ...line(l.ingId), qty: l.qty, f: l.f, amount: l.amount, ...(l.taxPct != null ? { taxPct: l.taxPct } : {}), ...(l.poRate != null ? { poRate: l.poRate } : {}) })) : [line(opts.ingId)];
  const st = { kind: "grn", x: { supplier: opts.supplier || (first && first.supplier) || "", invoiceNo: opts.invoiceNo || "", date: today(), loc: opts.loc || M.here(), notes: "", lines, poId: opts.poId || "" }, line }; st.redraw = () => drawGrn(st); drawGrn(st);
}
function drawGrn(st) {
  const x = st.x; const mats = M.ingredients().filter(i => i.type !== "sf"); const tax = M.taxCfg().on; const sm = M.stockMap(x.loc);
  openSheet(st, `<div class="sh-head"><h2 class="h">New GRN</h2><button class="x" data-close aria-label="Close">×</button></div>
  <p class="hint" style="margin-top:-4px">Goods received note · ${esc(M.nextDocNo("grns", prefix(), "GRN"))}${x.poId ? ` · against ${esc((ev.get("porders", x.poId) || {}).no || "PO")}` : ""}</p>
  <div class="two"><div><label class="f" for="grSup">Supplier</label><input class="in" id="grSup" list="suplist" value="${esc(x.supplier)}" placeholder="Name" autocomplete="off"><datalist id="suplist">${M.suppliers().map(s => `<option value="${esc(s.name)}">`).join("")}</datalist></div>
  <div><label class="f" for="grInv">Supplier invoice no.</label><input class="in" id="grInv" value="${esc(x.invoiceNo)}" placeholder="Optional"></div></div>
  <div class="two"><div><label class="f" for="grDate">Received on</label><input class="in" id="grDate" type="date" value="${x.date}"></div>
  ${M.locations().length > 1 ? `<div><label class="f" for="grLoc">Received at</label><select class="in" id="grLoc">${locOpts(x.loc)}</select></div>` : "<div></div>"}</div>
  <label class="f">Items received</label>
  <div class="grnlines">${x.lines.map((l, ix) => { const i = mats.find(m => m.id === l.ingId) || mats[0]; const b = big(i.unit);
    return `<div class="grnline"><div class="gl1"><select class="in" data-gring="${ix}">${["rm", "pm"].map(t => `<optgroup label="${M.ING_TYPES[t]}">${mats.filter(m => m.type === t).map(m => `<option value="${esc(m.id)}" ${m.id === i.id ? "selected" : ""}>${esc(m.name)}</option>`).join("")}</optgroup>`).join("")}</select><button class="rm" data-grrm="${ix}" aria-label="Remove line">×</button></div>
      <div class="gl2"><label><span>Qty</span><input class="in" data-grqty="${ix}" inputmode="decimal" value="${l.qty ? +(l.qty / l.f).toFixed(3) : ""}" placeholder="0"></label>${unitPick(i, l.f, `grf="${ix}`)}
      <label><span>Amount ₹${tax ? " before tax" : ""}</span><input class="in" data-gramt="${ix}" inputmode="decimal" value="${l.amount || ""}" placeholder="0"></label>${tax ? `<label class="tx"><span>${esc(M.taxCfg().name)} %</span><input class="in" data-grtax="${ix}" inputmode="decimal" value="${l.taxPct}"></label>` : ""}</div>
      <div class="gl2"><label><span>Best before</span><input class="in" type="date" data-grexp="${ix}" value="${esc(l.exp || (i.shelfDays ? addDays(x.date, +i.shelfDays) : ""))}"></label><label><span>Lot / batch no.</span><input class="in" data-grlot="${ix}" value="${esc(l.lot || "")}" placeholder="Optional"></label></div>
      <small class="mut">Have ${qty(Math.max(0, sm[i.id] || 0), i.unit)}${l.qty && l.amount ? ` · ${rs2(l.amount / l.qty * (b ? b.f : 1))}/${b ? b.big : i.unit}` : ""}${l.poRate && l.qty && l.amount ? rateDiff(l.amount / l.qty, l.poRate, i) : l.qty && l.amount ? priceHint(l.amount / l.qty, i) : ""}${l.qty && l.amount && H.contractHint ? H.contractHint(st.x.supplier, i, l.amount / l.qty) : ""}${tax && l.taxPct ? (i.taxInCost ? " · tax added to stock cost" : " · tax recoverable, not in cost") : ""}</small></div>`; }).join("")}</div>
  <button class="add-line" data-gradd>+ Add item</button>
  <div class="kv" id="grTotals" style="margin-top:12px">${grnTotals(x.lines)}</div>
  <label class="f" for="grNote">Note</label><input class="in" id="grNote" value="${esc(x.notes)}" placeholder="Optional · short delivery, damaged items">
  <button class="btn btn-ok" data-act="saveGrn">${ICON.inbox}Save GRN · adds stock</button>`);
}
function grnTotals(lines) { const amount = lines.reduce((s, l) => s + (+l.amount || 0), 0); const tr = taxRows(grnTax(lines));
  return `<div><span>Amount</span><span>${rs2(amount)}</span></div>${tr.map(([n, v]) => `<div><span>${esc(n)}</span><span>${rs2(v)}</span></div>`).join("")}<div class="tot"><span>Total</span><span>${rs2(amount + tr.reduce((s, r) => s + r[1], 0))}</span></div>`; }
H.input.push(T => { const st = ui.sheet; if (!st || st.kind !== "grn" || (T.dataset.grqty == null && T.dataset.gramt == null && T.dataset.grtax == null)) return false; syncGrn(); const el = $("#grTotals"); if (el) el.innerHTML = grnTotals(st.x.lines); return true; });
function syncGrn() {
  const st = ui.sheet; if (!st || st.kind !== "grn") return; const x = st.x; const g = id => document.getElementById(id);
  x.supplier = g("grSup").value; x.invoiceNo = g("grInv").value; x.date = g("grDate").value || today(); if (g("grLoc")) x.loc = g("grLoc").value; x.notes = g("grNote").value;
  x.lines.forEach((l, ix) => { const q = document.querySelector(`[data-grqty="${ix}"]`), a = document.querySelector(`[data-gramt="${ix}"]`), t = document.querySelector(`[data-grtax="${ix}"]`);
    const before = l.qty; if (q) l.qty = num(q.value) * l.f; if (t) l.taxPct = num(t.value);
    // Against a PO, the amount follows the quantity at the PO rate until it is typed by hand.
    if (a) { if (document.activeElement === a || num(a.value) !== r2(before * (l.poRate || 0)) || !l.poRate) l.amount = num(a.value); else { l.amount = r2(l.qty * l.poRate); if (l.qty !== before) a.value = l.amount || ""; } }
    const e = document.querySelector(`[data-grexp="${ix}"]`), lt = document.querySelector(`[data-grlot="${ix}"]`); if (e) l.exp = e.value; if (lt) l.lot = lt.value.trim(); });
}
A.saveGrn = async el => {
  syncGrn(); const st = ui.sheet, x = st.x; const ings = M.ingMap(); let sup = x.supplier.trim();
  if (!sup) { toast("Add the supplier"); return; }
  const known = byNameOrAka(M.suppliers(), sup); if (known) sup = known.name;
  else { const r = await confirmNew("supplier", sup, M.suppliers()); if (!r) return; if (r !== "new") { sup = r.name; x.supplier = sup; } } const lines = x.lines.filter(l => l.qty > 0); if (!lines.length) { toast("Enter what was received"); return; }
  if (x.poId) { const po = ev.get("porders", x.poId); if (!po || !["approved", "part"].includes(M.poState(po))) { toast(`${po ? po.no : "That PO"} is no longer open for receiving (${po ? M.PO_LABEL[M.poState(po)] : "removed"})`); return; } }
  const tax = r2(Object.values(grnTax(lines)).reduce((s, v) => s + v, 0)); const amount = r2(lines.reduce((s, l) => s + (+l.amount || 0), 0));
  const no = M.nextDocNo("grns", prefix(), "GRN");
  if (!await yesNo(`<p class="cq">Save ${esc(no)}?</p><div class="cdetail">${esc(sup)}${x.invoiceNo ? " · inv " + esc(x.invoiceNo) : ""}<br>${lines.map(l => esc(ings[l.ingId].name) + " " + qty(l.qty, ings[l.ingId].unit)).join("<br>")}<br><br>Total ${rs2(amount + tax)} · adds stock at ${esc(M.locName(x.loc))}</div>`, "Save GRN", "btn-ok")) return;
  el.disabled = true; const id = uid("g");
  if (!M.suppliers().some(s => s.name.toLowerCase() === sup.toLowerCase())) await ev.put("suppliers", { id: uid("s"), name: sup });
  // Stock is valued at the bill amount, plus the tax for materials whose purchase tax isn't recoverable (set per material by the admin).
  const costOf = l => r2((+l.amount || 0) * (1 + (ings[l.ingId].taxInCost ? (+l.taxPct || 0) / 100 : 0)));
  for (const l of lines) await putMove({ ingId: l.ingId, type: "purchase", qty: l.qty, amount: costOf(l), date: x.date, note: `${no} · ${sup}`, ref: id, outletId: x.loc });
  await ev.put("grns", { id, no, date: x.date, supplier: sup, invoiceNo: x.invoiceNo.trim(), loc: x.loc, notes: x.notes.trim(), lines: lines.map(l => ({ ingId: l.ingId, qty: l.qty, amount: +l.amount || 0, taxPct: +l.taxPct || 0, cost: costOf(l), ...(l.exp ? { exp: l.exp } : {}), ...(l.lot ? { lot: l.lot } : {}), ...(l.poRate ? { poRate: l.poRate } : {}) })), amount, tax, total: r2(amount + tax), by: (R.me() || {}).id || "", ...(x.poId ? { poId: x.poId } : {}) });
  sync.soon(); closeSheet(); toast(`${no} saved · stock added`);
};
function grnDetail(id) {
  const g = M.grns().find(x => x.id === id); if (!g) { closeSheet(); return; } const ings = M.ingMap(); const tr = taxRows(grnTax(g.lines));
  openSheet({ kind: "grnView", id, redraw: () => grnDetail(id) }, `<div class="sh-head"><h2 class="h">${esc(g.no)}</h2><button class="x" data-close aria-label="Close">×</button></div>
  <div class="subl" style="margin:-4px 0 10px">${esc(g.supplier)}${g.poId ? " · against " + esc((ev.get("porders", g.poId) || {}).no || "PO") : ""}${g.invoiceNo ? " · invoice " + esc(g.invoiceNo) : ""} · ${esc(dLong(g.date))} · at ${esc(M.locName(g.loc))}${who(g) ? " · " + esc(who(g)) : ""}</div>
  ${g.void ? `<div class="banner bad">Undone. Its stock was taken back off.</div>` : ""}
  <div class="kv">${g.lines.map(l => { const i = ings[l.ingId]; return `<div><span>${esc(i ? i.name : "Removed material")} <small class="mut">${i ? qty(l.qty, i.unit) : l.qty}${l.taxPct ? ` · ${l.taxPct}%` : ""}${l.exp ? ` · best before ${esc(dLong(l.exp))}` : ""}${l.lot ? ` · lot ${esc(l.lot)}` : ""}</small></span><span>${rs2(l.amount)}</span></div>`; }).join("")}
  ${tr.map(([n, v]) => `<div><span>${esc(n)}</span><span>${rs2(v)}</span></div>`).join("")}<div class="tot"><span>Total</span><span>${rs2(g.total)}</span></div></div>
  ${g.notes ? `<p class="hint">Note: ${esc(g.notes)}</p>` : ""}
  ${H.grnExtras ? H.grnExtras(g) : ""}
  ${(() => { const dns = M.preturns().filter(d => !d.void && d.grnId === g.id); return dns.length ? `<label class="f">Returned</label><div class="kv">${dns.map(d => `<div><span><button class="linkbtn" data-dn="${esc(d.id)}">${esc(d.no)}</button> · ${esc(dLong(d.date))} · ${esc(d.reason || "")}</span><span>−${rs2(d.total)}</span></div>`).join("")}</div>` : ""; })()}
  ${!g.void && R.can("stock.buy") ? `<div class="btnrow"><button class="btn btn-ghost" data-grnreturn="${esc(g.id)}">Return goods (debit note)</button><button class="btn btn-danger" data-grnundo="${esc(g.id)}">Undo this GRN</button></div>` : ""}`);
}

/* ---------- Transfers ---------- */
const xferText = x => { const ings = M.ingMap(); return (x.lines || []).map(l => l.item ? `${l.item} × ${l.qty}` : `${(ings[l.ingId] || {}).name || "?"} ${ings[l.ingId] ? qty(l.qty, ings[l.ingId].unit) : l.qty}`).join(", "); };
V.xfer = () => {
  S.filter.xfer = S.filter.xfer || "all"; const f = S.filter.xfer; const all = M.transfers(); const t = today();
  const list = all.filter(x => f === "all" || x.from === f || x.to === f);
  const todays = list.filter(x => !x.void && x.date === t); const transit = list.filter(x => !x.void && !M.xferReceived(x));
  let h = band("Transfers", "", `<div class="stats"><div class="st"><b>${transit.length}</b><span>in transit</span></div><div class="st"><b>${todays.length}</b><span>today</span></div><div class="st"><b>${todays.reduce((s, x) => s + x.lines.filter(l => l.item).reduce((a, l) => a + l.qty, 0), 0)}</b><span>pieces sent today</span></div><div class="st"><b>${M.locations().length}</b><span>locations</span></div></div>`);
  h += `<div class="tools">${layoutSwitch("xfer")}${M.locations().length > 1 ? `<div class="chips"><button class="chip" data-filter="xfer:all" aria-pressed="${f === "all"}">All</button>${M.locations().map(l => `<button class="chip" data-filter="xfer:${esc(l.id)}" aria-pressed="${f === l.id}">${esc(l.name)}</button>`).join("")}</div>` : ""}</div>`;
  if (M.locations().length < 2) h += `<p class="hint" style="padding:0 4px">Only one location so far. Add outlets in More → Business settings → Locations to send stock between them.</p>`;
  if (!list.length) return h + `<div class="empty"><strong>No transfers yet</strong>A transfer moves finished goods (and materials, like boxes) from the kitchen to an outlet. The outlet’s bake board shows what arrived.${R.can("transfer") && M.locations().length > 1 ? `<button class="btn btn-primary" data-act="newTransfer" style="margin-top:14px">${ICON.truck}New transfer</button>` : ""}</div>`;
  return h + (asLines("xfer") ? `<div class="card tablecard"><table class="reg"><thead><tr><th>No.</th><th>Date</th><th>From</th><th>To</th><th>Items</th><th class="r">Pieces</th><th>By</th></tr></thead><tbody>${list.map(x => `<tr data-xfer="${esc(x.id)}" tabindex="0"${x.void ? ` class="void"` : ""}><td><b>${esc(x.no)}</b> ${statusTag(x)}</td><td data-v="${esc(x.date)}">${esc(dLong(x.date))}</td><td>${esc(M.locName(x.from))}</td><td>${esc(M.locName(x.to))}</td><td class="items">${esc(xferText(x))}</td><td class="r">${x.lines.filter(l => l.item).reduce((a, l) => a + l.qty, 0)}</td><td>${esc(who(x))}</td></tr>`).join("")}</tbody></table></div>`
    : `<ul class="list">${list.map(x => `<li class="row${x.void ? " void" : ""}"><button class="who" data-xfer="${esc(x.id)}"><div class="nm">${esc(x.no)} · ${esc(M.locName(x.from))} → ${esc(M.locName(x.to))}</div><div class="subl">${esc(dLong(x.date))} ${statusTag(x)}</div><div class="subl">${esc(xferText(x))}</div></button>${!x.void && !M.xferReceived(x) && canReceive() ? `<button class="paybtn" data-xferrecv="${esc(x.id)}">Receive</button>` : ""}</li>`).join("")}</ul>`);
};
A.newTransfer = () => transferSheet();
H.transferSheet = opts => transferSheet(opts);
function transferSheet(opts = {}) {
  if (!guard("transfer")) return; const locs = M.locations(); if (locs.length < 2) { toast("Add an outlet in Business settings → Locations first"); return; }
  const from = opts.from || prodKitchen(); const to = opts.to || (locs.find(l => l.id !== from) || locs[0]).id;
  const st = { kind: "xfer", x: { from, to, date: today(), note: "", fg: [], mats: [] } }; fillFg(st, true); st.redraw = () => drawXfer(st); drawXfer(st);
}
// Finished-goods lines: every item on sale, suggested from what the destination is short of today and the source holds.
function fillFg(st, suggest) {
  const x = st.x; const have = M.fgStock()[x.from] || {}; const need = Object.fromEntries(M.outletBoard(today(), x.to).map(r => [r.item, r.short]));
  x.fg = M.menuActive().map(m => ({ item: m.name, qty: suggest ? Math.max(0, Math.min(need[m.name] || 0, have[m.name] || 0)) : ((x.fg.find(l => l.item === m.name) || {}).qty || 0) }));
}
function drawXfer(st) {
  const x = st.x; const locs = M.locations(); const have = M.fgStock()[x.from] || {}; const sm = M.stockMap(x.from); const ings = M.ingMap(); const mats = M.ingredients();
  const over = x.fg.filter(l => l.qty > Math.max(0, have[l.item] || 0));
  openSheet(st, `<div class="sh-head"><h2 class="h">New transfer</h2><button class="x" data-close aria-label="Close">×</button></div>
  <p class="hint" style="margin-top:-4px">${esc(M.nextDocNo("transfers", prefix(), "T"))} · suggested from what ${esc(M.locName(x.to))} is short of today</p>
  <div class="two"><div><label class="f" for="xfFrom">From</label><select class="in" id="xfFrom">${locOpts(x.from)}</select></div><div><label class="f" for="xfTo">To</label><select class="in" id="xfTo">${locOpts(x.to, locs.filter(l => l.id !== x.from))}</select></div></div>
  <label class="f">Finished goods</label><div class="kv">${x.fg.map((l, ix) => `<div style="align-items:center"><span>${esc(l.item)}<small class="mut" style="display:block">${Math.max(0, have[l.item] || 0)} at ${esc(M.locName(x.from))}</small></span><div class="stepper"><button data-xfstep="${ix}:-1" aria-label="One less">−</button><span>${l.qty}</span><button data-xfstep="${ix}:1" aria-label="One more">+</button></div></div>`).join("") || "<div>No items on sale</div>"}</div>
  <label class="f">Materials <small class="mut">(optional · boxes, bags, cream for the outlet)</small></label>
  ${x.mats.length ? `<div class="kv">${x.mats.map((l, ix) => { const i = ings[l.ingId]; return `<div style="align-items:center;gap:8px"><select class="in" data-xmi="${ix}" style="flex:1;min-width:0">${mats.map(m => `<option value="${esc(m.id)}" ${m.id === l.ingId ? "selected" : ""}>${esc(m.name)}</option>`).join("")}</select><input class="rate" data-xmq="${ix}" inputmode="decimal" value="${l.qty || ""}" placeholder="0"><span class="unitlbl">${i ? i.unit : ""}</span><button class="rm" data-xmrm="${ix}" aria-label="Remove line">×</button></div><small class="mut" style="padding:0 14px 8px;display:block">have ${i ? qty(Math.max(0, sm[i.id] || 0), i.unit) : ""}</small>`; }).join("")}</div>` : ""}
  ${mats.length ? `<button class="add-line" data-xmadd>+ Add material</button>` : ""}
  <label class="f" for="xfNote">Note</label><input class="in" id="xfNote" value="${esc(x.note)}" placeholder="Optional · driver, crate no.">
  ${over.length ? `<p class="hint" style="color:var(--due)">More than ${esc(M.locName(x.from))} holds: ${over.map(l => esc(l.item)).join(", ")}. Record the batch first, or send anyway and fix with a count.</p>` : ""}
  <button class="btn btn-primary" data-act="saveTransfer" ${x.fg.some(l => l.qty > 0) || x.mats.some(l => l.qty > 0) ? "" : "disabled"}>${ICON.truck}Send to ${esc(M.locName(x.to))}</button>`);
}
const syncXfer = () => { const st = ui.sheet; if (!st || st.kind !== "xfer") return; st.x.note = ($("#xfNote") || {}).value || ""; st.x.mats.forEach((l, ix) => { const q = document.querySelector(`[data-xmq="${ix}"]`); if (q) l.qty = num(q.value); }); };
A.saveTransfer = async el => {
  syncXfer(); const st = ui.sheet, x = st.x; const ings = M.ingMap();
  const lines = [...x.fg.filter(l => l.qty > 0).map(l => ({ item: l.item, qty: l.qty })), ...x.mats.filter(l => l.qty > 0 && ings[l.ingId]).map(l => ({ ingId: l.ingId, qty: l.qty }))];
  if (!lines.length) return; el.disabled = true; const id = uid("t"); const no = M.nextDocNo("transfers", prefix(), "T");
  // Sending takes stock off the sender now; the receiver gains it when it confirms what arrived.
  for (const l of lines.filter(l => l.ingId)) await putMove({ ingId: l.ingId, type: "transfer", qty: -l.qty, note: `${no} to ${M.locName(x.to)}`, ref: id, outletId: x.from });
  await ev.put("transfers", { id, no, date: x.date, from: x.from, to: x.to, lines, note: x.note.trim(), status: "sent", sentAt: new Date().toISOString(), by: (R.me() || {}).id || "" });
  sync.soon(); closeSheet(); toast(`${no} on its way to ${M.locName(x.to)}`);
};
const canReceive = () => R.can("transfer") || R.can("sale");
const lineName = (l, ings) => l.item || ((ings[l.ingId] || {}).name || "?");
const lineQty = (l, v, ings) => l.item ? String(v) : (ings[l.ingId] ? qty(v, ings[l.ingId].unit) : String(v));
const statusTag = x => x.void ? `<span class="tag t-due">Undone</span>` : !M.xferReceived(x) ? `<span class="tag t-part">In transit</span>` : M.xferShort(x) ? `<span class="tag t-due">Received short</span>` : `<span class="tag t-paid">${ICON.check}Received</span>`;
// The receiving location confirms each line; anything short is recorded on the transfer.
async function receiveSheet(id) {
  const x = M.transfers().find(t => t.id === id); if (!x || x.void || M.xferReceived(x)) return; if (!canReceive()) { guard("transfer"); return; }
  const lk = await L.open("transfers", id, x.no); if (!lk) return;
  const st = { ...lk, kind: "xferRecv", id, lines: x.lines.map(l => ({ ...l, recv: +l.qty })), note: "" }; st.redraw = () => drawRecv(st); drawRecv(st);
}
function drawRecv(st) {
  const x = M.transfers().find(t => t.id === st.id); const ings = M.ingMap(); const short = st.lines.filter(l => l.recv < l.qty);
  openSheet(st, `<div class="sh-head"><h2 class="h">Receive ${esc(x.no)}</h2><button class="x" data-close aria-label="Close">×</button></div>
  <p class="hint" style="margin-top:-4px">From ${esc(M.locName(x.from))} · sent ${esc(new Date(x.sentAt || x._at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }))}${who(x) ? " by " + esc(who(x)) : ""}. Count what arrived; change any line that’s short or damaged.</p>
  <div class="kv">${st.lines.map((l, ix) => `<div style="align-items:center"><span>${esc(lineName(l, ings))}<small class="mut" style="display:block">sent ${esc(lineQty(l, l.qty, ings))}</small></span>${l.item
    ? `<div class="stepper"><button data-rvstep="${ix}:-1" aria-label="One less">−</button><span>${l.recv}</span><button data-rvstep="${ix}:1" aria-label="One more">+</button></div>`
    : `<span style="display:flex;align-items:center;gap:6px"><input class="rate" data-rvq="${ix}" inputmode="decimal" value="${l.recv}"><span class="unitlbl">${ings[l.ingId] ? ings[l.ingId].unit : ""}</span></span>`}</div>`).join("")}</div>
  <label class="f" for="rvNote">Note</label><input class="in" id="rvNote" value="${esc(st.note)}" placeholder="${short.length ? "What happened to the missing pieces" : "Optional"}">
  ${short.length ? `<p class="hint" style="color:var(--due)">Short: ${short.map(l => esc(lineName(l, ings)) + " " + esc(lineQty(l, l.qty - l.recv, ings))).join(", ")}. It stays recorded on the transfer.</p>` : ""}
  <button class="btn btn-ok" data-act="saveReceive">${ICON.check}${short.length ? "Receive with shortage" : "Received in full"}</button>`);
}
const syncRecv = () => { const st = ui.sheet; if (!st || st.kind !== "xferRecv") return; st.note = ($("#rvNote") || {}).value || ""; st.lines.forEach((l, ix) => { const q = document.querySelector(`[data-rvq="${ix}"]`); if (q) l.recv = Math.min(+l.qty, Math.max(0, num(q.value))); }); };
A.saveReceive = async el => {
  syncRecv(); const st = ui.sheet; if (!await L.saveOk(st)) return; const x = M.transfers().find(t => t.id === st.id); if (!x || M.xferReceived(x) || x.void) { closeSheet(); toast(x && x.void ? "This transfer was undone" : "Already received"); return; }
  el.disabled = true;
  for (const l of st.lines.filter(l => l.ingId && l.recv > 0)) await putMove({ ingId: l.ingId, type: "transfer", qty: l.recv, note: `${x.no} from ${M.locName(x.from)}`, ref: x.id, outletId: x.to });
  await ev.put("transfers", clean({ ...ev.get("transfers", x.id), status: "received", lines: st.lines, receivedAt: new Date().toISOString(), receivedBy: (R.me() || {}).id || "", recvNote: st.note.trim() }));
  sync.soon(); closeSheet(); toast(`${x.no} received at ${M.locName(x.to)}`);
};
function xferDetail(id) {
  const x = M.transfers().find(t => t.id === id); if (!x) { closeSheet(); return; } const ings = M.ingMap();
  const rcv = M.xferReceived(x); const rb = x.receivedBy ? (ev.get("members", x.receivedBy) || {}).name : "";
  const when = t => t ? new Date(t).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "";
  openSheet({ kind: "xferView", id, redraw: () => xferDetail(id) }, `<div class="sh-head"><h2 class="h">${esc(x.no)}</h2><button class="x" data-close aria-label="Close">×</button></div>
  <div class="subl" style="margin:-4px 0 10px">${esc(M.locName(x.from))} → ${esc(M.locName(x.to))} · ${esc(dLong(x.date))} ${statusTag(x)}</div>
  ${x.void ? `<div class="banner bad">Undone. Everything went back to ${esc(M.locName(x.from))}.</div>` : ""}
  <div class="kv"><div><span class="mut">Item</span><span class="mut">Sent${rcv && x.status ? " · received" : ""}</span></div>${x.lines.map(l => `<div><span>${esc(lineName(l, ings))}</span><b>${esc(lineQty(l, l.qty, ings))}${rcv && l.recv != null ? ` · <span class="${+l.recv < +l.qty ? "due" : ""}">${esc(lineQty(l, l.recv, ings))}</span>` : ""}</b></div>`).join("")}</div>
  <div class="kv" style="margin-top:10px"><div><span>Sent</span><span>${esc(when(x.sentAt || x._at))}${who(x) ? " · " + esc(who(x)) : ""}</span></div>${x.receivedAt ? `<div><span>Received</span><span>${esc(when(x.receivedAt))}${rb ? " · " + esc(rb) : ""}</span></div>` : ""}</div>
  ${x.note ? `<p class="hint">Note: ${esc(x.note)}</p>` : ""}${x.recvNote ? `<p class="hint">On receipt: ${esc(x.recvNote)}</p>` : ""}
  ${!x.void && !rcv && canReceive() ? `<button class="btn btn-ok" data-xferrecv="${esc(x.id)}">${ICON.check}Receive at ${esc(M.locName(x.to))}</button>` : ""}
  ${!x.void && R.can("transfer") ? `<button class="btn btn-danger" data-xferundo="${esc(x.id)}">Undo this transfer</button>` : ""}`);
}

/* ---------- Finished goods ---------- */
V.fg = () => {
  const fg = M.fgStock(); const locs = M.locations(); const names = [...new Set([...M.menuActive().map(m => m.name), ...Object.values(fg).flatMap(o => Object.keys(o))])];
  const tot = n => locs.reduce((s, l) => s + ((fg[l.id] || {})[n] || 0), 0);
  const rows = names.filter(n => tot(n) || M.menuActive().some(m => m.name === n)).sort((a, b) => tot(b) - tot(a) || a.localeCompare(b));
  const adj = ev.all("fg").sort((a, b) => b._at.localeCompare(a._at)).slice(0, 12);
  let h = band("Finished goods", (R.can("stock.count") || R.can("stock.waste")) ? `<button class="pillbtn" data-act="fgAdjust">Adjust</button>` : "",
    `<div class="stats">${locs.map(l => `<div class="st"><b>${Object.values(fg[l.id] || {}).reduce((s, v) => s + Math.max(0, v), 0)}</b><span>${esc(l.name)}</span></div>`).join("")}</div>`);
  if (!rows.length) return h + `<div class="empty"><strong>No finished goods yet</strong>Batches add pieces at the kitchen, transfers move them to outlets and sales take them off.</div>`;
  h += `<div class="tools">${layoutSwitch("fg")}</div><div class="card tablecard" style="margin-top:6px"><table class="reg"><thead><tr><th>Item</th>${locs.map(l => `<th class="r">${esc(l.name)}</th>`).join("")}<th class="r">Total</th></tr></thead><tbody>${rows.map(n => `<tr style="cursor:default"><td><b>${esc(n)}</b></td>${locs.map(l => { const v = (fg[l.id] || {})[n] || 0; return `<td class="r${v < 0 ? " due" : ""}">${v || "–"}</td>`; }).join("")}<td class="r"><b>${tot(n)}</b></td></tr>`).join("")}</tbody></table></div>
  <p class="hint" style="padding:0 4px">Counted from ${esc(dLong(M.config().erpStart || today()))}, when ERP started: good pieces from batches, plus transfers in, less transfers out and delivered orders. A negative number means something was sold before it was recorded; fix it with Adjust → Count.</p>`;
  if (adj.length) h += `<div class="card"><h3>Recent adjustments</h3><table><tbody>${adj.map(a => `<tr><td>${esc(a.item)} <small class="mut">${esc(M.locName(a.loc))} · ${a.type === "waste" ? "wasted" : "count"}${a.note ? " · " + esc(a.note) : ""}</small></td><td>${a.qty > 0 ? "+" : ""}${a.qty}</td></tr>`).join("")}</tbody></table></div>`;
  return h;
};
A.fgAdjust = () => { if (!R.can("stock.count") && !R.can("stock.waste")) return guard("stock.count");
  const st = { kind: "fgAdj", loc: M.here(), item: (M.menuActive()[0] || {}).name || "", type: R.can("stock.count") ? "count" : "waste" }; st.redraw = () => drawFgAdj(st); drawFgAdj(st); };
function drawFgAdj(st) {
  const on = (M.fgStock()[st.loc] || {})[st.item] || 0;
  openSheet(st, `<div class="sh-head"><h2 class="h">Adjust finished goods</h2><button class="x" data-close aria-label="Close">×</button></div>
  <div class="two"><div><label class="f" for="faLoc">Location</label><select class="in" id="faLoc">${locOpts(st.loc)}</select></div><div><label class="f" for="faItem">Item</label><select class="in" id="faItem">${M.menuActive().map(m => `<option ${m.name === st.item ? "selected" : ""}>${esc(m.name)}</option>`).join("")}</select></div></div>
  <div class="chips" style="margin-top:12px">${[["count", "Count on the shelf", "stock.count"], ["waste", "Wasted / expired", "stock.waste"]].filter(x => R.can(x[2])).map(([k, l]) => `<button class="chip" data-fat="${k}" aria-pressed="${st.type === k}">${l}</button>`).join("")}</div>
  <p class="hint">On hand now: <b>${on}</b></p>
  <label class="f" for="faQty">${st.type === "count" ? "Pieces actually there" : "Pieces wasted"}</label><input class="in" id="faQty" inputmode="numeric" placeholder="0">
  <label class="f" for="faNote">Note</label><input class="in" id="faNote" placeholder="Optional">
  <button class="btn btn-primary" data-act="saveFgAdj">Save</button>`);
}
A.saveFgAdj = async () => { const st = ui.sheet; const n = num($("#faQty").value); const on = (M.fgStock()[st.loc] || {})[st.item] || 0;
  const delta = st.type === "count" ? n - on : -n; if (!delta) { toast(st.type === "count" ? "That’s what the app shows already" : "Enter the pieces wasted"); return; }
  await ev.put("fg", { id: uid("f"), loc: st.loc, item: st.item, qty: delta, type: st.type, date: today(), note: $("#faNote").value.trim() }); sync.soon(); closeSheet(); toast(`${st.item} at ${M.locName(st.loc)}: ${delta > 0 ? "+" : ""}${delta}`); };

/* ---------- interactions ---------- */
async function voidDoc(kind, id, what) {
  if (!guard(kind === "transfers" ? "transfer" : "stock.buy")) return false;
  if (!await yesNo(`<p class="cq">Undo this ${what}?</p><div class="cdetail">Its stock moves are reversed. It stays in the list, marked undone.</div>`, "Undo", "btn-danger-solid")) return false;
  // Re-read after the question: another device may have undone it meanwhile, and its reversal may already be here.
  const cur = ev.get(kind, id); if (!cur || cur.void || ev.all("moves").some(m => m.ref === id + ":undo")) { toast(`This ${what} was already undone`); return true; }
  if (kind === "grns" && M.preturns().some(d => !d.void && d.grnId === id)) { toast("Undo its debit notes first"); return false; }
  // A GRN undo takes the money back out too, so the average cost and last price drop the cancelled purchase.
  for (const m of ev.all("moves").filter(m => m.ref === id)) await putMove({ ingId: m.ingId, type: m.type === "purchase" ? "purchase" : "adjust", qty: -m.qty, ...(m.type === "purchase" && m.amount ? { amount: -m.amount } : {}), note: `${what} undone`, ref: id + ":undo", outletId: m.outletId });
  await ev.put(kind, clean({ ...ev.get(kind, id), void: true, voidAt: new Date().toISOString() })); sync.soon(); toast(`${what[0].toUpperCase() + what.slice(1)} undone`); return true;
}
H.click.push(async T => {
  const st = ui.sheet;
  const pd = T.closest("[data-proddate]"); if (pd) { S.prodDate = pd.dataset.proddate; H.render(); return true; }
  const pk = T.closest("[data-prodk]"); if (pk) { S.prodKitchen = pk.dataset.prodk; H.render(); return true; }
  const pb = T.closest("[data-prodbake]"); if (pb) { bakeSheet(pb.dataset.prodbake); return true; }
  if (T.closest("[data-planopen]")) { S.planDate = S.prodDate || today(); S.view = "plan"; H.render(); return true; }
  const xt = T.closest("[data-xferto]"); if (xt) { transferSheet({ from: prodKitchen(), to: xt.dataset.xferto }); return true; }
  if (T.closest("[data-askcopy]")) { const ok = await copyText(S.askText || ""); toast(ok ? "Request copied. Paste it to the kitchen." : "Couldn’t copy here"); return true; }
  const gr = T.closest("[data-grn]"); if (gr) { grnDetail(gr.dataset.grn); return true; }
  const gu = T.closest("[data-grnundo]"); if (gu) { if (await voidDoc("grns", gu.dataset.grnundo, "GRN")) grnDetail(gu.dataset.grnundo); return true; }
  const xd = T.closest("[data-xfer]"); if (xd) { xferDetail(xd.dataset.xfer); return true; }
  const xr = T.closest("[data-xferrecv]"); if (xr) { receiveSheet(xr.dataset.xferrecv); return true; }
  const xu = T.closest("[data-xferundo]"); if (xu) { if (await voidDoc("transfers", xu.dataset.xferundo, "transfer")) xferDetail(xu.dataset.xferundo); return true; }
  if (!st) return false;
  if (st.kind === "grn") {
    if (T.closest("[data-gradd]")) { syncGrn(); st.x.lines.push(st.line()); drawGrn(st); return true; }
    const rm = T.closest("[data-grrm]"); if (rm) { syncGrn(); st.x.lines.splice(+rm.dataset.grrm, 1); if (!st.x.lines.length) st.x.lines.push(st.line()); drawGrn(st); return true; }
    const gf = T.closest("[data-grf]"); if (gf) { syncGrn(); const [ix, f] = gf.dataset.grf.split(":").map(Number); st.x.lines[ix].f = f; drawGrn(st); return true; }
  }
  if (st.kind === "xfer") {
    const s2 = T.closest("[data-xfstep]"); if (s2) { syncXfer(); const [ix, d] = s2.dataset.xfstep.split(":").map(Number); st.x.fg[ix].qty = Math.max(0, st.x.fg[ix].qty + d); drawXfer(st); return true; }
    if (T.closest("[data-xmadd]")) { syncXfer(); const m = M.ingredients().find(i => i.type === "pm") || M.ingredients()[0]; st.x.mats.push({ ingId: m.id, qty: 0 }); drawXfer(st); return true; }
    const xr = T.closest("[data-xmrm]"); if (xr) { syncXfer(); st.x.mats.splice(+xr.dataset.xmrm, 1); drawXfer(st); return true; }
  }
  if (st.kind === "xferRecv") { const rv = T.closest("[data-rvstep]"); if (rv) { syncRecv(); const [ix, d] = rv.dataset.rvstep.split(":").map(Number); const l = st.lines[ix]; l.recv = Math.min(+l.qty, Math.max(0, l.recv + d)); drawRecv(st); return true; } }
  if (st.kind === "fgAdj") { const ft = T.closest("[data-fat]"); if (ft) { st.type = ft.dataset.fat; drawFgAdj(st); return true; } }
  return false;
});
H.change.push(T => {
  const st = ui.sheet; if (!st) return false;
  if (st.kind === "grn" && (T.dataset.gring != null || T.id === "grLoc")) { syncGrn(); if (T.dataset.gring != null) { const l = st.x.lines[+T.dataset.gring]; const fresh = st.line(T.value); Object.assign(l, { ingId: fresh.ingId, f: fresh.f, taxPct: fresh.taxPct }); } drawGrn(st); return true; }
  if (st.kind === "xfer" && (T.id === "xfFrom" || T.id === "xfTo")) { syncXfer(); st.x[T.id === "xfFrom" ? "from" : "to"] = T.value; if (st.x.from === st.x.to) st.x.to = (M.locations().find(l => l.id !== st.x.from) || {}).id; fillFg(st, true); drawXfer(st); return true; }
  if (st.kind === "xfer" && T.dataset.xmi != null) { syncXfer(); st.x.mats[+T.dataset.xmi].ingId = T.value; drawXfer(st); return true; }
  if (st.kind === "fgAdj" && (T.id === "faLoc" || T.id === "faItem")) { st[T.id === "faLoc" ? "loc" : "item"] = T.value; drawFgAdj(st); return true; }
  return false;
});
