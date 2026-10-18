// Purchasing: purchase orders (draft → approved → received through GRNs, or closed short), suppliers and what is owed to them.
import * as ev from "./events.js";
import * as sync from "./sync.js";
import * as M from "./model.js";
import * as R from "./roles.js";
import { asLines, layoutSwitch } from "./table.js";
import { S, A, V, H, guard, chipBar, searchBox, band, clean } from "./core.js";
import { $, esc, rs, rs2, num, uid, today, addDays, dLong, qty, UNITS, ICON, copyText, waHref } from "./util.js";
import { ui, toast, openSheet, closeSheet, yesNo, ask } from "./ui.js";
import { confirmNew, byNameOrAka } from "./match.js";

const big = u => UNITS[u] || null;
const r2 = v => Math.round(v * 100) / 100;
const prefix = () => (R.me() || {}).prefix || "";
const perBig = (i, v) => `${rs2(v * (big(i.unit) ? big(i.unit).f : 1))}/${big(i.unit) ? big(i.unit).big : i.unit}`;
const stateTag = st => `<span class="tag ${{ draft: "t-part", approved: "t-camp", part: "t-part", received: "t-paid", closed: "t-camp", cancelled: "t-due" }[st]}">${esc(M.PO_LABEL[st])}</span>`;
const unitOpts = i => { const b = big(i.unit); const p = M.packOf(i); return [[i.unit, 1], ...(b ? [[b.big, b.f]] : []), ...(p ? [[`${p.name} (${qty(p.size, i.unit)})`, p.size]] : [])]; };
const canApprove = () => R.can("po.approve");
// Shortfall quantities are rounded up to whole packs when the material is bought in packs.
const roundPack = (i, q) => { const p = M.packOf(i); return p ? Math.ceil(q / p.size - 1e-9) * p.size : q; };
const taxFor = i => M.taxCfg().on ? (i.taxPct != null && i.taxPct !== "" ? +i.taxPct : +M.taxCfg().rate || 0) : 0;

/* ---------- creating POs ---------- */
// Draft POs from a list of { ingId, qty }: one per usual supplier, at that supplier's last rate. Returns the POs made.
export async function draftPOs(rows, note = "") {
  const ings = M.ingMap(); const by = new Map(); const wait = M.onOrder();
  rows.forEach(r => { const i = ings[r.ingId]; if (!i || i.type === "sf") return; const q = roundPack(i, Math.max(0, r.qty - (wait[i.id] || 0))); if (q <= 0) return;
    const sup = M.usualSupplier(i) || ""; (by.get(sup) || by.set(sup, []).get(sup)).push({ ingId: i.id, qty: q, rate: r2((M.lastRate(sup, i.id) || M.lastPrice(i)) * 1e4) / 1e4, taxPct: taxFor(i) }); });
  const made = [];
  for (const [sup, lines] of by) { const no = M.nextDocNo("porders", prefix(), "PO");
    const po = { id: uid("po"), no, date: today(), supplier: sup, loc: M.here(), expected: addDays(today(), 1), lines, status: "draft", notes: note, by: (R.me() || {}).id || "" };
    await ev.put("porders", po); made.push(po); }
  sync.soon(); return made;
}
H.draftPOs = draftPOs;

/* ---------- PO list ---------- */
V.po = () => {
  S.filter.po = S.filter.po || "open"; const k = S.filter.po; const all = M.porders().map(p => ({ ...p, st: M.poState(p) })); const ings = M.ingMap();
  const q = (S.query.po || "").toLowerCase().trim();
  const groups = { open: p => ["draft", "approved", "part"].includes(p.st), draft: p => p.st === "draft", done: p => ["received", "closed", "cancelled"].includes(p.st), all: () => true };
  const list = all.filter(groups[k]).filter(p => !q || (p.no + " " + p.supplier + " " + p.lines.map(l => (ings[l.ingId] || {}).name).join(" ")).toLowerCase().includes(q));
  const open = all.filter(groups.open); const low = M.ingredients().filter(i => i.type !== "sf" && i.reorder && M.stockLevel(i).on <= i.reorder && !(M.onOrder()[i.id] > 0));
  let h = band("Purchase orders", R.can("stock.buy") ? `<button class="pillbtn" data-ponew>${ICON.plus}New PO</button>` : "",
    `<div class="stats"><div class="st"><b>${open.length}</b><span>open</span></div><div class="st"><b>${all.filter(groups.draft).length}</b><span>waiting for approval</span></div>${R.can("money") ? `<div class="st"><b>${rs(open.filter(p => p.st !== "draft").reduce((s, p) => s + M.poValue(p), 0))}</b><span>on order</span></div>` : ""}</div>`);
  if (low.length && R.can("stock.buy")) h += `<button class="banner warn expbanner" data-polow>${low.length} material${low.length > 1 ? "s" : ""} below reorder level and not on order · tap to draft POs</button>`;
  h += `<div class="tools">${searchBox("po", "Search PO, supplier or material")}${layoutSwitch("po")}${chipBar("po", [["open", "Open", open.length], ["draft", "To approve", all.filter(groups.draft).length], ["done", "Done"], ["all", "All", all.length]])}</div>`;
  if (!all.length) return h + `<div class="empty"><strong>No purchase orders yet</strong>Raise a PO to a supplier, have it approved, then receive the goods against it as a GRN. Planning → Indent can draft POs for everything that’s short.</div>`;
  if (!list.length) return h + `<div class="empty"><strong>Nothing here</strong>Try another filter.</div>`;
  const items = p => p.lines.map(l => { const i = ings[l.ingId]; return `${i ? i.name : "?"} ${i ? qty(l.qty, i.unit) : l.qty}`; }).join(", ");
  return h + (asLines("po") ? `<div class="card tablecard"><table class="reg"><thead><tr><th>PO</th><th>Date</th><th>Supplier</th><th>Expected</th><th>Items</th>${R.can("money") ? `<th class="r">Value</th>` : ""}<th>Status</th></tr></thead><tbody>${list.map(p => `<tr data-po="${esc(p.id)}" tabindex="0"><td><b>${esc(p.no)}</b></td><td data-v="${esc(p.date)}">${esc(dLong(p.date))}</td><td>${esc(p.supplier || "No supplier")}</td><td data-v="${esc(p.expected || "")}">${p.expected ? esc(dLong(p.expected)) : "–"}</td><td class="items">${esc(items(p))}</td>${R.can("money") ? `<td class="r">${rs(M.poValue(p))}</td>` : ""}<td>${stateTag(p.st)}</td></tr>`).join("")}</tbody></table></div>`
    : `<ul class="list">${list.map(p => `<li class="row"><button class="who" data-po="${esc(p.id)}"><div class="nm">${esc(p.no)} · ${esc(p.supplier || "No supplier")}</div><div class="subl">${esc(dLong(p.date))}${p.expected ? " · expected " + esc(dLong(p.expected)) : ""} ${stateTag(p.st)}</div><div class="subl">${esc(items(p))}</div></button>${R.can("money") ? `<div class="amt">${rs(M.poValue(p))}</div>` : ""}</li>`).join("")}</ul>`);
};

/* ---------- PO editor ---------- */
function poSheet(po) {
  if (!guard("stock.buy")) return; const mats = M.ingredients().filter(i => i.type !== "sf"); if (!mats.length) { toast("Add raw or packing materials in Inventory first"); return; }
  const x = po ? JSON.parse(JSON.stringify(po)) : { id: uid("po"), no: M.nextDocNo("porders", prefix(), "PO"), date: today(), supplier: "", loc: M.here(), expected: addDays(today(), 1), lines: [], status: "draft", notes: "" };
  x.lines = x.lines.map(l => { const i = M.ingMap()[l.ingId]; const p = M.packOf(i); return { ...l, f: p && l.qty % p.size === 0 ? p.size : big(i.unit) && l.qty % big(i.unit).f === 0 ? big(i.unit).f : 1 }; });
  if (!x.lines.length) x.lines.push(newLine(mats[0], x.supplier));
  const st = { kind: "poEdit", x, isNew: !po }; st.redraw = () => drawPo(st); drawPo(st);
}
const newLine = (i, sup) => ({ ingId: i.id, qty: 0, f: M.packOf(i) ? M.packOf(i).size : big(i.unit) ? big(i.unit).f : 1, rate: r2((M.lastRate(sup, i.id) || M.lastPrice(i)) * 1e4) / 1e4, taxPct: taxFor(i) });
function drawPo(st) {
  const x = st.x; const mats = M.ingredients().filter(i => i.type !== "sf"); const ings = M.ingMap(); const tax = M.taxCfg().on; const sm = M.stockMap(x.loc);
  openSheet(st, `<div class="sh-head"><h2 class="h">${st.isNew ? "New purchase order" : "Edit " + esc(x.no)}</h2><button class="x" data-close aria-label="Close">×</button></div>
  <p class="hint" style="margin-top:-4px">${esc(x.no)} · drafts need approval before goods are received against them</p>
  <div class="two"><div><label class="f" for="poSup">Supplier</label><input class="in" id="poSup" list="posups" value="${esc(x.supplier)}" placeholder="Name" autocomplete="off"><datalist id="posups">${M.suppliers().map(s => `<option value="${esc(s.name)}">`).join("")}</datalist></div>
  <div><label class="f" for="poExp">Expected on</label><input class="in" id="poExp" type="date" value="${esc(x.expected || "")}"></div></div>
  ${M.locations().length > 1 ? `<label class="f" for="poLoc">Deliver to</label><select class="in" id="poLoc">${M.locations().map(l => `<option value="${esc(l.id)}" ${l.id === x.loc ? "selected" : ""}>${esc(l.name)}</option>`).join("")}</select>` : ""}
  <label class="f">Items</label>
  <div class="grnlines">${x.lines.map((l, ix) => { const i = ings[l.ingId] || mats[0]; const b = big(i.unit);
    return `<div class="grnline"><div class="gl1"><select class="in" data-poing="${ix}">${["rm", "pm"].map(t => `<optgroup label="${M.ING_TYPES[t]}">${mats.filter(m => m.type === t).map(m => `<option value="${esc(m.id)}" ${m.id === i.id ? "selected" : ""}>${esc(m.name)}</option>`).join("")}</optgroup>`).join("")}</select><button class="rm" data-porm="${ix}" aria-label="Remove line">×</button></div>
    <div class="gl2"><label><span>Qty</span><input class="in" data-poqty="${ix}" inputmode="decimal" value="${l.qty ? +(l.qty / l.f).toFixed(3) : ""}" placeholder="0"></label>${unitOpts(i).length > 1 ? `<div class="chips unitchips">${unitOpts(i).map(([n, f]) => `<button class="chip" data-pof="${ix}:${f}" aria-pressed="${l.f === f}">${esc(n)}</button>`).join("")}</div>` : `<span class="unitlbl">${esc(i.unit)}</span>`}
    <label><span>Rate ₹ per ${b ? b.big : i.unit}</span><input class="in" data-porate="${ix}" inputmode="decimal" value="${l.rate ? +(l.rate * (b ? b.f : 1)).toFixed(2) : ""}" placeholder="0"></label>${tax ? `<label class="tx"><span>${esc(M.taxCfg().name)} %</span><input class="in" data-potax="${ix}" inputmode="decimal" value="${l.taxPct}"></label>` : ""}</div>
    <small class="mut">Have ${qty(Math.max(0, sm[i.id] || 0), i.unit)}${i.reorder ? ` · reorder at ${qty(i.reorder, i.unit)}` : ""}${M.lastRate(x.supplier, i.id) ? ` · last from this supplier ${perBig(i, M.lastRate(x.supplier, i.id))}` : ""}${l.qty && l.rate ? ` · line ${rs2(l.qty * l.rate)}` : ""}</small></div>`; }).join("")}</div>
  <button class="add-line" data-poadd>+ Add item</button>
  <div class="kv" id="poTot" style="margin-top:12px">${poTotals(x)}</div>
  <label class="f" for="poNote">Note to supplier</label><input class="in" id="poNote" value="${esc(x.notes || "")}" placeholder="Optional · delivery time, brand">
  <div class="btnrow"><button class="btn btn-ghost" data-posave="draft">Save draft</button>${canApprove() ? `<button class="btn btn-ok" data-posave="approve">${ICON.check}Save & approve</button>` : ""}</div>
  ${canApprove() ? "" : `<p class="hint">An admin or management approves it before goods are received.</p>`}`);
}
const poTotals = x => { const a = x.lines.reduce((s, l) => s + (l.qty * l.rate || 0), 0), t = x.lines.reduce((s, l) => s + (l.qty * l.rate * (+l.taxPct || 0) / 100 || 0), 0);
  return `<div><span>Amount</span><span>${rs2(a)}</span></div>${t ? `<div><span>${esc(M.taxCfg().name)}</span><span>${rs2(t)}</span></div>` : ""}<div class="tot"><span>Total</span><span>${rs2(a + t)}</span></div>`; };
function syncPo() {
  const st = ui.sheet; if (!st || st.kind !== "poEdit") return; const x = st.x; const g = id => document.getElementById(id); const ings = M.ingMap();
  x.supplier = g("poSup").value; x.expected = g("poExp").value; if (g("poLoc")) x.loc = g("poLoc").value; x.notes = g("poNote").value;
  x.lines.forEach((l, ix) => { const i = ings[l.ingId]; const b = big(i.unit); const v = a => document.querySelector(`[data-${a}="${ix}"]`);
    if (v("poqty")) l.qty = num(v("poqty").value) * l.f; if (v("porate")) l.rate = num(v("porate").value) / (b ? b.f : 1); if (v("potax")) l.taxPct = num(v("potax").value); });
}
async function savePo(approve) {
  syncPo(); const st = ui.sheet, x = st.x; let sup = x.supplier.trim(); if (!sup) { toast("Add the supplier"); return; }
  const known = byNameOrAka(M.suppliers(), sup); if (known) sup = known.name; else { const r = await confirmNew("supplier", sup, M.suppliers()); if (!r) return; if (r !== "new") sup = r.name; }
  const lines = x.lines.filter(l => l.qty > 0).map(l => ({ ingId: l.ingId, qty: l.qty, rate: +l.rate || 0, taxPct: +l.taxPct || 0 })); if (!lines.length) { toast("Enter what to order"); return; }
  if (lines.some(l => !l.rate) && !await yesNo(`<p class="cq">Some lines have no rate</p><div class="cdetail">Save anyway? The GRN will take the bill amount.</div>`, "Save")) return;
  if (!M.supplierByName(sup)) await ev.put("suppliers", { id: uid("s"), name: sup });
  const rec = { ...clean(x), supplier: sup, lines, status: approve ? "approved" : "draft", ...(approve ? { approvedBy: (R.me() || {}).id || "", approvedAt: new Date().toISOString() } : {}) };
  await ev.put("porders", rec); sync.soon(); toast(approve ? `${x.no} approved` : `${x.no} saved as draft`); poDetail(x.id);
}

/* ---------- PO detail ---------- */
const poText = p => { const ings = M.ingMap(); return `🧾 Purchase order ${p.no} from ${M.config().business}\nDate ${dLong(p.date)}${p.expected ? ` · deliver by ${dLong(p.expected)}` : ""}${M.locations().length > 1 ? ` · to ${M.locName(p.loc)}` : ""}\n\n`
  + p.lines.map(l => { const i = ings[l.ingId]; if (!i) return ""; const pk = M.packOf(i); return `• ${i.name}: ${qty(l.qty, i.unit)}${pk && l.qty % pk.size === 0 ? ` (${l.qty / pk.size} ${pk.name})` : ""}${l.rate ? ` @ ${perBig(i, l.rate)}` : ""}`; }).filter(Boolean).join("\n")
  + (p.notes ? `\n\n${p.notes}` : "") + (M.taxCfg().gstin ? `\n\n${M.taxCfg().name}IN ${M.taxCfg().gstin}` : ""); };
function poDetail(id) {
  const p = ev.get("porders", id); if (!p) { closeSheet(); return; } const ings = M.ingMap(); const st = M.poState(p); const got = M.poReceived(p); const sup = M.supplierByName(p.supplier) || {};
  const grnsFor = M.grns().filter(g => g.poId === id && !g.void); const appr = p.approvedBy && ev.get("members", p.approvedBy);
  openSheet({ kind: "poView", id, redraw: () => poDetail(id) }, `<div class="sh-head"><h2 class="h">${esc(p.no)}</h2><button class="x" data-close aria-label="Close">×</button></div>
  <div class="subl" style="margin:-4px 0 10px">${esc(p.supplier || "No supplier")} · ${esc(dLong(p.date))}${p.expected ? " · expected " + esc(dLong(p.expected)) : ""} ${stateTag(st)}${appr ? ` · approved by ${esc(appr.name)}` : ""}</div>
  <div class="card tablecard" style="margin:0"><table class="reg"><thead><tr><th>Material</th><th class="r">Ordered</th><th class="r">Received</th><th class="r">Pending</th>${R.can("money") ? `<th class="r">Rate</th>` : ""}</tr></thead><tbody>${p.lines.map(l => { const i = ings[l.ingId] || { name: "Removed material", unit: "" }; const g = got[l.ingId] || 0;
    return `<tr><td>${esc(i.name)}</td><td class="r">${qty(l.qty, i.unit)}</td><td class="r">${g ? qty(g, i.unit) : "–"}</td><td class="r">${l.qty - g > 1e-6 && !["closed", "cancelled"].includes(st) ? `<b>${qty(l.qty - g, i.unit)}</b>` : "–"}</td>${R.can("money") ? `<td class="r">${l.rate && i.unit ? perBig(i, l.rate) : "–"}</td>` : ""}</tr>`; }).join("")}</tbody></table></div>
  ${R.can("money") ? `<div class="kv" style="margin-top:10px"><div class="tot"><span>PO value${M.taxCfg().on ? " with tax" : ""}</span><span>${rs2(M.poValue(p))}</span></div></div>` : ""}
  ${grnsFor.length ? `<p class="hint">Received on ${grnsFor.map(g => `<button class="linkbtn" data-grnopen="${esc(g.id)}">${esc(g.no)}</button> (${esc(dLong(g.date))})`).join(", ")}</p>` : ""}
  ${p.notes ? `<p class="hint">Note: ${esc(p.notes)}</p>` : ""}
  ${st === "draft" ? `<div class="btnrow">${R.can("stock.buy") ? `<button class="btn btn-ghost" data-poedit="${esc(id)}">Edit</button>` : ""}${canApprove() ? `<button class="btn btn-ok" data-poapprove="${esc(id)}">${ICON.check}Approve</button>` : ""}</div>` : ""}
  ${["approved", "part"].includes(st) ? `${R.can("stock.buy") ? `<button class="btn btn-ok" data-poreceive="${esc(id)}">${ICON.inbox}Receive goods (GRN)</button>` : ""}
    <div class="btnrow"><a class="btn btn-wa" href="${esc(waHref(sup.phone || "", poText(p)))}" target="_blank" rel="noopener">${ICON.wa}Send to supplier</a><button class="btn btn-ghost" data-pocopy="${esc(id)}">Copy</button></div>` : ""}
  ${st === "part" && R.can("stock.buy") ? `<button class="btn btn-ghost" data-poclose="${esc(id)}">Close short · nothing more is coming</button>` : ""}
  ${["draft", "approved"].includes(st) && R.can("stock.buy") ? `<button class="btn btn-danger" data-pocancel="${esc(id)}">Cancel PO</button>` : ""}`);
}
function receivePo(id) {
  const p = ev.get("porders", id); const got = M.poReceived(p); const ings = M.ingMap();
  const lines = p.lines.map(l => { const i = ings[l.ingId]; const left = Math.max(0, l.qty - (got[l.ingId] || 0)); if (!i || !left) return null; const pk = M.packOf(i);
    return { ingId: l.ingId, qty: left, f: pk && left % pk.size === 0 ? pk.size : big(i.unit) ? big(i.unit).f : 1, amount: r2(left * l.rate), taxPct: +l.taxPct || 0, poRate: l.rate || null }; }).filter(Boolean);
  if (!lines.length) { toast("Everything on this PO has been received"); return; }
  H.grnSheet({ lines, supplier: p.supplier, poId: id, loc: p.loc });
}

/* ---------- suppliers and payables ---------- */
V.sup = () => {
  const list = M.payables(); const q = (S.query.sup || "").toLowerCase().trim(); const t = today(); const m0 = t.slice(0, 8) + "01";
  const rows = list.filter(s => !q || s.name.toLowerCase().includes(q)).sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name));
  const due = list.reduce((s, x) => s + Math.max(0, x.balance), 0), over = list.reduce((s, x) => s + x.overdue, 0), paid = M.spays().filter(p => p.date >= m0).reduce((s, p) => s + (+p.amount || 0), 0);
  let h = band("Suppliers & payables", R.can("stock.buy") ? `<button class="pillbtn" data-supnew>${ICON.plus}Add supplier</button>` : "",
    `<div class="stats"><div class="st"><b>${rs(due)}</b><span>owed to suppliers</span></div><div class="st"><b class="${over ? "due" : ""}">${rs(over)}</b><span>overdue</span></div><div class="st"><b>${rs(paid)}</b><span>paid this month</span></div></div>`);
  h += `<div class="tools">${searchBox("sup", "Search supplier")}${layoutSwitch("sup")}</div>`;
  if (!rows.length) return h + `<div class="empty"><strong>No suppliers yet</strong>Suppliers are added with their first PO or GRN, or here. Each one’s bills (GRNs), payments and balance show here.</div>`;
  const openPo = n => M.porders().filter(p => p.supplier.toLowerCase() === n.toLowerCase() && ["approved", "part", "draft"].includes(M.poState(p))).length;
  return h + (asLines("sup") ? `<div class="card tablecard"><table class="reg"><thead><tr><th>Supplier</th><th class="r">Owed</th><th class="r">Overdue</th><th>Oldest due</th><th class="r">Credit days</th><th class="r">Open POs</th><th>Phone</th></tr></thead><tbody>${rows.map(s => `<tr data-sup="${esc(s.name)}" tabindex="0"><td><b>${esc(s.name)}</b></td><td class="r" data-v="${s.balance}">${rs2(s.balance)}</td><td class="r" data-v="${s.overdue}">${s.overdue ? `<span class="due">${rs2(s.overdue)}</span>` : "–"}</td><td data-v="${esc(s.oldest)}">${s.oldest ? esc(dLong(s.oldest)) : "–"}</td><td class="r">${s.days || 0}</td><td class="r">${openPo(s.name) || "–"}</td><td>${esc(s.sup.phone || "")}</td></tr>`).join("")}</tbody></table></div>`
    : `<ul class="list">${rows.map(s => `<li class="row${s.overdue ? " warn" : ""}"><button class="who" data-sup="${esc(s.name)}"><div class="nm">${esc(s.name)}</div><div class="subl">${s.overdue ? `<span class="tag t-due">${rs(s.overdue)} overdue</span> ` : ""}${s.oldest ? "oldest due " + esc(dLong(s.oldest)) : "nothing due"}${openPo(s.name) ? ` · ${openPo(s.name)} open PO` : ""}</div></button><div class="amt">${rs(s.balance)}</div></li>`).join("")}</ul>`);
};
function supSheet(name) {
  const L = M.supplierLedger(name); const s = L.sup; const money = R.can("money");
  const text = `Statement from ${M.config().business} for ${s.name}\n` + L.open.map(b => `• ${b.doc} ${dLong(b.date)}: ${rs2(b.open)}${b.due < today() ? " (overdue)" : ""}`).join("\n") + `\nBalance ${rs2(L.balance)}`;
  openSheet({ kind: "sup", id: name, redraw: () => supSheet(name) }, `<div class="sh-head"><h2 class="h">${esc(s.name)}</h2><button class="x" data-close aria-label="Close">×</button></div>
  <div class="kpis" style="padding:0;margin-bottom:10px"><div class="kpi"><b>${rs2(L.balance)}</b><span>owed</span></div><div class="kpi"><b class="${L.overdue ? "due" : ""}">${rs2(L.overdue)}</b><span>overdue · ${L.days || 0} credit days</span></div></div>
  ${R.can("payables") && L.balance > 0 ? `<button class="btn btn-ok" data-suppay="${esc(s.name)}">Record a payment</button>` : ""}
  <label class="f" style="margin-top:12px">Details</label><div class="two"><div><label class="f" for="spPhone">Phone</label><input class="in" id="spPhone" value="${esc(s.phone || "")}" inputmode="tel"></div><div><label class="f" for="spDays">Credit days</label><input class="in" id="spDays" inputmode="numeric" value="${s.days || ""}" placeholder="0"></div></div>
  <label class="f" for="spGst">${esc(M.taxCfg().name)}IN</label><input class="in" id="spGst" value="${esc(s.gstin || "")}" autocapitalize="characters" placeholder="Optional">
  ${R.can("stock.buy") ? `<button class="btn btn-ghost" data-supsave="${esc(s.name)}">Save details</button>` : ""}
  ${L.open.length ? `<label class="f" style="margin-top:12px">Unpaid bills</label><div class="kv">${L.open.map(b => `<div><span>${esc(b.doc)} · ${esc(dLong(b.date))}<small class="mut" style="display:block">due ${esc(dLong(b.due))}${b.due < today() ? ` <span class="tag t-due">overdue</span>` : ""}</small></span><b>${rs2(b.open)}</b></div>`).join("")}</div>
    <div class="btnrow"><a class="btn btn-wa" href="${esc(waHref(s.phone || "", text))}" target="_blank" rel="noopener">${ICON.wa}Share statement</a></div>` : ""}
  ${money ? `<label class="f" style="margin-top:12px">Ledger</label><div class="card tablecard" style="margin:0"><table class="reg"><thead><tr><th>Date</th><th>Entry</th><th class="r">Bill</th><th class="r">Paid</th><th class="r">Balance</th><th></th></tr></thead><tbody>${L.entries.map(e => `<tr><td data-v="${esc(e.date)}">${esc(dLong(e.date))}</td><td>${esc(e.doc)}</td><td class="r">${e.bill ? rs2(e.bill) : "–"}</td><td class="r">${e.paid ? rs2(e.paid) : "–"}</td><td class="r">${rs2(e.bal)}</td><td>${e.pay && e.pay.amount > 0 && R.can("payables") ? `<button class="linkbtn" data-suprev="${esc(e.pay.id)}">Reverse</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="6">No bills or payments yet.</td></tr>`}</tbody></table></div>` : ""}`);
}
function payDraw(st) {
  const L = M.supplierLedger(st.name);
  openSheet(st, `<div class="sh-head"><h2 class="h">Pay ${esc(st.name)}</h2><button class="x" data-close aria-label="Close">×</button></div>
  <p class="hint" style="margin-top:-4px">Owed ${rs2(L.balance)}${L.overdue ? ` · ${rs2(L.overdue)} overdue` : ""}. Payments settle the oldest bills first.</p>
  <div class="two"><div><label class="f" for="spAmt">Amount ₹</label><input class="in" id="spAmt" inputmode="decimal" value="${L.balance > 0 ? L.balance : ""}"></div><div><label class="f" for="spDate">Paid on</label><input class="in" id="spDate" type="date" value="${today()}"></div></div>
  <label class="f">Paid by</label><div class="chips">${["Bank", "UPI", "Cash", "Cheque"].map(m => `<button class="chip" data-spmode="${m}" aria-pressed="${st.mode === m}">${m}</button>`).join("")}</div>
  <label class="f" for="spRef">Reference <small class="mut">(UTR, cheque no.)</small></label><input class="in" id="spRef" placeholder="Optional">
  <button class="btn btn-ok" data-spsave>Save payment</button>`);
}

/* ---------- actions ---------- */
H.click.push(async T => {
  const st = ui.sheet;
  if (T.closest("[data-ponew]")) { poSheet(null); return true; }
  const po = T.closest("[data-po]"); if (po) { poDetail(po.dataset.po); return true; }
  if (T.closest("[data-polow]")) { const low = M.ingredients().filter(i => i.type !== "sf" && i.reorder && M.stockLevel(i).on <= i.reorder);
    const made = await draftPOs(low.map(i => ({ ingId: i.id, qty: Math.max(i.reorder * 2 - Math.max(0, M.stockLevel(i).on), i.reorder) })), "Reorder");
    toast(made.length ? `${made.length} draft PO${made.length > 1 ? "s" : ""} made` : "Everything low is already on order"); return true; }
  const pe = T.closest("[data-poedit]"); if (pe) { poSheet(ev.get("porders", pe.dataset.poedit)); return true; }
  const pa = T.closest("[data-poapprove]"); if (pa) { if (!guard("po.approve")) return true; const p = ev.get("porders", pa.dataset.poapprove); if (!p.supplier) { toast("Give the PO a supplier first"); poSheet(p); return true; }
    await ev.put("porders", { ...clean(p), status: "approved", approvedBy: (R.me() || {}).id || "", approvedAt: new Date().toISOString() }); sync.soon(); toast(`${p.no} approved`); poDetail(p.id); return true; }
  const pr = T.closest("[data-poreceive]"); if (pr) { receivePo(pr.dataset.poreceive); return true; }
  const pc = T.closest("[data-pocopy]"); if (pc) { toast(await copyText(poText(ev.get("porders", pc.dataset.pocopy))) ? "PO copied" : "Couldn’t copy here"); return true; }
  const pcl = T.closest("[data-poclose]"); if (pcl) { const p = ev.get("porders", pcl.dataset.poclose); if (await yesNo(`<p class="cq">Close ${esc(p.no)} short?</p><div class="cdetail">What hasn’t arrived is no longer expected and stops counting as on order.</div>`, "Close PO")) { await ev.put("porders", { ...clean(p), status: "closed" }); sync.soon(); poDetail(p.id); } return true; }
  const pcn = T.closest("[data-pocancel]"); if (pcn) { const p = ev.get("porders", pcn.dataset.pocancel); if (await yesNo(`<p class="cq">Cancel ${esc(p.no)}?</p><div class="cdetail">It stays in the list marked cancelled.</div>`, "Cancel PO", "btn-danger-solid", "Keep it")) { await ev.put("porders", { ...clean(p), status: "cancelled" }); sync.soon(); poDetail(p.id); } return true; }
  const go = T.closest("[data-grnopen]"); if (go) { H.grnDetail(go.dataset.grnopen); return true; }
  if (st && st.kind === "poEdit") {
    if (T.closest("[data-poadd]")) { syncPo(); const used = new Set(st.x.lines.map(l => l.ingId)); const i = M.ingredients().filter(m => m.type !== "sf").find(m => !used.has(m.id)) || M.ingredients().find(m => m.type !== "sf"); st.x.lines.push(newLine(i, st.x.supplier)); drawPo(st); return true; }
    const rm = T.closest("[data-porm]"); if (rm) { syncPo(); st.x.lines.splice(+rm.dataset.porm, 1); drawPo(st); return true; }
    const f = T.closest("[data-pof]"); if (f) { syncPo(); const [ix, v] = f.dataset.pof.split(":").map(Number); st.x.lines[ix].f = v; drawPo(st); return true; }
    const sv = T.closest("[data-posave]"); if (sv) { await savePo(sv.dataset.posave === "approve"); return true; } }
  const sp = T.closest("[data-sup]"); if (sp) { supSheet(sp.dataset.sup); return true; }
  if (T.closest("[data-supnew]")) { const ok = await ask(`<p class="cq">New supplier</p><input class="in" id="supNewName" placeholder="Supplier name">`, [{ label: "Cancel", cls: "btn-ghost", value: false }, { label: "Add", cls: "btn-primary", value: true }], true);
    const name = ok ? (document.getElementById("supNewName") || {}).value?.trim() : ""; if (!name) return true; const r = await confirmNew("supplier", name, M.suppliers()); if (!r) return true;
    if (r === "new") { await ev.put("suppliers", { id: uid("s"), name }); sync.soon(); } supSheet(r === "new" ? name : r.name); return true; }
  const ss = T.closest("[data-supsave]"); if (ss) { const s = M.supplierByName(ss.dataset.supsave) || { id: uid("s"), name: ss.dataset.supsave };
    await ev.put("suppliers", { ...clean(s), phone: $("#spPhone").value.trim(), gstin: $("#spGst").value.trim().toUpperCase(), days: Math.max(0, Math.round(num($("#spDays").value))) }); sync.soon(); toast("Supplier saved"); supSheet(s.name); return true; }
  const pay = T.closest("[data-suppay]"); if (pay) { if (!guard("payables")) return true; const s2 = { kind: "spay", name: pay.dataset.suppay, mode: "Bank" }; s2.redraw = () => payDraw(s2); payDraw(s2); return true; }
  if (st && st.kind === "spay") { const m = T.closest("[data-spmode]"); if (m) { const a = $("#spAmt").value, d = $("#spDate").value, r = $("#spRef").value; st.mode = m.dataset.spmode; payDraw(st); $("#spAmt").value = a; $("#spDate").value = d; $("#spRef").value = r; return true; }
    if (T.closest("[data-spsave]")) { const amt = r2(num($("#spAmt").value)); if (!(amt > 0)) { toast("Enter the amount paid"); return true; }
      if (!await yesNo(`<p class="cq">Record ${rs2(amt)} paid to ${esc(st.name)}?</p><div class="cdetail">${esc(st.mode)}${$("#spRef").value.trim() ? " · " + esc($("#spRef").value.trim()) : ""}</div>`, "Save payment", "btn-ok")) return true;
      await ev.put("spays", { id: uid("sp"), supplier: st.name, date: $("#spDate").value || today(), amount: amt, mode: st.mode, ref: $("#spRef").value.trim(), by: (R.me() || {}).id || "" }); sync.soon(); toast("Payment recorded"); supSheet(st.name); return true; } }
  const rv = T.closest("[data-suprev]"); if (rv) { if (!guard("payables")) return true; const p = ev.get("spays", rv.dataset.suprev);
    if (p && await yesNo(`<p class="cq">Reverse this payment?</p><div class="cdetail">${rs2(p.amount)} on ${esc(dLong(p.date))}. A reversing entry is added; the original stays.</div>`, "Reverse")) { await ev.put("spays", { id: uid("sp"), supplier: p.supplier, date: today(), amount: -p.amount, mode: "Reversal", ref: p.ref || "", by: (R.me() || {}).id || "" }); sync.soon(); supSheet(p.supplier); } return true; }
  return false;
});
H.input.push(T => { const st = ui.sheet; if (!st || st.kind !== "poEdit" || !(T.dataset.poqty != null || T.dataset.porate != null || T.dataset.potax != null)) return false; syncPo(); const el = $("#poTot"); if (el) el.innerHTML = poTotals(st.x); return true; });
H.change.push(T => { const st = ui.sheet; if (!st || st.kind !== "poEdit") return false;
  if (T.dataset.poing != null) { syncPo(); const i = M.ingMap()[T.value]; st.x.lines[+T.dataset.poing] = { ...newLine(i, st.x.supplier.trim()), qty: 0 }; drawPo(st); return true; }
  if (T.id === "poSup") { syncPo(); st.x.lines.forEach(l => { const r = M.lastRate(st.x.supplier.trim(), l.ingId); if (r) l.rate = r; }); drawPo(st); return true; }
  return false; });
