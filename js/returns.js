// Purchase returns: goods sent back to a supplier, recorded as a debit note (DN-PA-3). Stock comes off at what it cost,
// so the average cost isn't disturbed, and the supplier's balance drops by the amount returned plus its tax.
import * as ev from "./events.js";
import * as sync from "./sync.js";
import * as M from "./model.js";
import * as R from "./roles.js";
import { asLines, layoutSwitch } from "./table.js";
import { S, V, H, guard, searchBox, band, clean } from "./core.js";
import { putMove } from "./inventory.js";
import { $, esc, rs, rs2, num, uid, today, dLong, qty, UNITS, ICON } from "./util.js";
import { ui, toast, openSheet, closeSheet, yesNo } from "./ui.js";
import { byNameOrAka } from "./match.js";

export const REASONS = ["Damaged", "Expired / near expiry", "Wrong item", "Quality not as ordered", "Excess supplied", "Other"];
const big = u => UNITS[u] || null;
const r2 = v => Math.round(v * 100) / 100;
const who = x => { const m = ev.get("members", x.by || x._by); return m ? m.name : ""; };
const dnText = d => { const ings = M.ingMap(); return d.lines.map(l => `${(ings[l.ingId] || {}).name || "?"} ${ings[l.ingId] ? qty(l.qty, ings[l.ingId].unit) : l.qty}`).join(", "); };
const lineTax = l => (+l.amount || 0) * (+l.taxPct || 0) / 100;
// What is still returnable from a GRN line: received less what earlier debit notes sent back.
export function returnable(g) {
  const back = {}; M.preturns().filter(d => !d.void && d.grnId === g.id).forEach(d => d.lines.forEach(l => { back[l.ingId] = (back[l.ingId] || 0) + l.qty; }));
  return g.lines.filter(l => l.qty > 0).map(l => { const left = Math.max(0, l.qty - (back[l.ingId] || 0)); back[l.ingId] = Math.max(0, (back[l.ingId] || 0) - l.qty); return { ...l, left }; });
}

V.dn = () => {
  const q = (S.query.dn || "").toLowerCase().trim(); const all = M.preturns(); const m0 = today().slice(0, 8) + "01";
  const list = all.filter(d => !q || `${d.no} ${d.supplier} ${d.reason}`.toLowerCase().includes(q)); const month = all.filter(d => !d.void && d.date >= m0);
  let h = band("Purchase returns", R.can("stock.buy") ? `<button class="pillbtn" data-dnnew>${ICON.plus}New return</button>` : "",
    `<div class="stats"><div class="st"><b>${month.length}</b><span>debit notes this month</span></div>${R.can("money") ? `<div class="st"><b>${rs(month.reduce((s, d) => s + d.total, 0))}</b><span>returned this month</span></div>` : ""}</div>`);
  h += `<div class="tools">${searchBox("dn", "Search supplier, DN or reason")}${layoutSwitch("dn")}</div>`;
  if (!list.length) return h + `<div class="empty"><strong>No returns yet</strong>When goods go back to a supplier (damaged, expired, wrong item), record a debit note here or from the GRN. Stock comes off and the supplier’s balance drops.</div>`;
  return h + (asLines("dn") ? `<div class="card tablecard"><table class="reg"><thead><tr><th>No.</th><th>Date</th><th>Supplier</th><th>Against</th><th>Items</th><th>Reason</th><th class="r">Total</th></tr></thead><tbody>${list.map(d => `<tr data-dn="${esc(d.id)}" tabindex="0"${d.void ? ` class="void"` : ""}><td><b>${esc(d.no)}</b>${d.void ? ` <span class="tag t-due">Undone</span>` : ""}</td><td data-v="${esc(d.date)}">${esc(dLong(d.date))}</td><td>${esc(d.supplier)}</td><td>${esc(d.grnNo || "–")}</td><td class="items">${esc(dnText(d))}</td><td>${esc(d.reason || "")}</td><td class="r" data-v="${d.total}">${rs2(d.total)}</td></tr>`).join("")}</tbody></table></div>`
    : `<ul class="list">${list.map(d => `<li class="row${d.void ? " void" : ""}"><button class="who" data-dn="${esc(d.id)}"><div class="nm">${esc(d.no)} · ${esc(d.supplier)}</div><div class="subl">${esc(dLong(d.date))}${d.grnNo ? " · " + esc(d.grnNo) : ""}${d.reason ? " · " + esc(d.reason) : ""}${d.void ? ` <span class="tag t-due">Undone</span>` : ""}</div><div class="subl">${esc(dnText(d))}</div></button><div class="amt">${rs(d.total)}</div></li>`).join("")}</ul>`);
};

// opts.grnId: return against a GRN, limited to what it brought in. Otherwise a free return to a chosen supplier.
export function dnSheet(opts = {}) {
  if (!guard("stock.buy")) return; const g = opts.grnId ? M.grns().find(x => x.id === opts.grnId) : null;
  if (g && g.void) { toast("That GRN was undone"); return; }
  const lines = g ? returnable(g).filter(l => l.left > 0).map(l => ({ ingId: l.ingId, max: l.left, qty: 0, rate: l.qty ? (+l.amount || 0) / l.qty : 0, costRate: l.qty ? (+l.cost || +l.amount || 0) / l.qty : 0, taxPct: +l.taxPct || 0, f: big((M.ingMap()[l.ingId] || {}).unit) ? big(M.ingMap()[l.ingId].unit).f : 1 })) : [];
  if (g && !lines.length) { toast(`Everything on ${g.no} has already been returned`); return; }
  if (!g && !M.ingredients().some(i => i.type !== "sf")) { toast("Add raw or packing materials in Inventory first"); return; }
  const st = { kind: "dnNew", x: { grnId: g ? g.id : "", supplier: g ? g.supplier : (opts.supplier || ""), loc: g ? g.loc || M.here() : M.here(), date: today(), reason: "", note: "", lines } };
  if (!g) st.x.lines.push(freeLine());
  st.redraw = () => drawDn(st); drawDn(st);
}
H.dnSheet = dnSheet;
function freeLine(id) { const mats = M.ingredients().filter(i => i.type !== "sf"); const i = mats.find(m => m.id === id) || mats[0]; if (!i) return null; const r = M.lastPrice(i) || M.unitCost(i);
  return { ingId: i.id, qty: 0, rate: r, costRate: M.unitCost(i), taxPct: M.taxCfg().on ? (i.taxPct != null && i.taxPct !== "" ? +i.taxPct : +M.taxCfg().rate || 0) : 0, f: big(i.unit) ? big(i.unit).f : 1 }; }
function totals(x) { const amount = x.lines.reduce((s, l) => s + r2(l.qty * l.rate), 0); const tax = x.lines.reduce((s, l) => s + lineTax({ amount: r2(l.qty * l.rate), taxPct: l.taxPct }), 0); return { amount: r2(amount), tax: r2(tax), total: r2(amount + tax) }; }
function drawDn(st) {
  const x = st.x; const ings = M.ingMap(); const g = x.grnId ? M.grns().find(y => y.id === x.grnId) : null; const mats = M.ingredients().filter(i => i.type !== "sf"); const t = totals(x); const sm = M.stockMap(x.loc);
  openSheet(st, `<div class="sh-head"><h2 class="h">Return to supplier</h2><button class="x" data-close aria-label="Close">×</button></div>
  <p class="hint" style="margin-top:-4px">Debit note ${esc(M.nextDocNo("preturns", R.numPrefix(), "DN"))}${g ? ` · against ${esc(g.no)}${g.invoiceNo ? " (invoice " + esc(g.invoiceNo) + ")" : ""}` : ""}</p>
  ${g ? `<label class="f">Supplier</label><input class="in" value="${esc(g.supplier)}" disabled>` : `<label class="f" for="dnSup">Supplier</label><input class="in" id="dnSup" list="dnsuplist" value="${esc(x.supplier)}" placeholder="Name" autocomplete="off"><datalist id="dnsuplist">${M.suppliers().map(s => `<option value="${esc(s.name)}">`).join("")}</datalist>`}
  <div class="two"><div><label class="f" for="dnDate">Returned on</label><input class="in" id="dnDate" type="date" value="${esc(x.date)}"></div>${!g && M.locations().length > 1 ? `<div><label class="f" for="dnLoc">Sent from</label><select class="in" id="dnLoc">${M.locations().map(l => `<option value="${esc(l.id)}" ${l.id === x.loc ? "selected" : ""}>${esc(l.name)}</option>`).join("")}</select></div>` : "<div></div>"}</div>
  <label class="f">Items going back</label>
  <div class="grnlines">${x.lines.map((l, ix) => { const i = ings[l.ingId]; const b = big(i.unit);
    return `<div class="grnline"><div class="gl1">${g ? `<b>${esc(i.name)}</b>` : `<select class="in" data-dning="${ix}">${mats.map(m => `<option value="${esc(m.id)}" ${m.id === i.id ? "selected" : ""}>${esc(m.name)}</option>`).join("")}</select><button class="rm" data-dnrm="${ix}" aria-label="Remove line">×</button>`}</div>
      <div class="gl2"><label><span>Qty${b ? " " + b.big : " " + esc(i.unit)}</span><input class="in" data-dnq="${ix}" inputmode="decimal" value="${l.qty ? +(l.qty / l.f).toFixed(3) : ""}" placeholder="0"></label>
      <label><span>Rate ₹/${b ? b.big : esc(i.unit)}</span><input class="in" data-dnr="${ix}" inputmode="decimal" value="${l.rate ? r2(l.rate * l.f) : ""}" placeholder="0"></label>${M.taxCfg().on ? `<label class="tx"><span>${esc(M.taxCfg().name)} %</span><input class="in" data-dnt="${ix}" inputmode="decimal" value="${l.taxPct}"></label>` : ""}</div>
      <small class="mut">${g ? `Up to ${qty(l.max, i.unit)} · ` : ""}have ${qty(Math.max(0, sm[i.id] || 0), i.unit)}${l.qty ? ` · ${rs2(r2(l.qty * l.rate))}` : ""}</small></div>`; }).join("")}</div>
  ${g ? "" : `<button class="add-line" data-dnadd>+ Add item</button>`}
  <div class="kv" id="dnTot" style="margin-top:12px">${totRows(t)}</div>
  <label class="f" for="dnReason">Reason</label><select class="in" id="dnReason"><option value="">Choose…</option>${REASONS.map(r => `<option ${x.reason === r ? "selected" : ""}>${esc(r)}</option>`).join("")}</select>
  <label class="f" for="dnNote">Note</label><input class="in" id="dnNote" value="${esc(x.note)}" placeholder="Optional · supplier's credit note no.">
  <button class="btn btn-danger" data-dnsave>Save debit note · takes stock off</button>`);
}
const totRows = t => `<div><span>Amount</span><span>${rs2(t.amount)}</span></div>${t.tax ? `<div><span>${esc(M.taxCfg().name)}</span><span>${rs2(t.tax)}</span></div>` : ""}<div class="tot"><span>Debit note total</span><span>${rs2(t.total)}</span></div>`;
function syncDn() {
  const st = ui.sheet; if (!st || st.kind !== "dnNew") return; const x = st.x; const v = id => (document.getElementById(id) || {}).value;
  if ($("#dnSup")) x.supplier = v("dnSup"); x.date = v("dnDate") || today(); if ($("#dnLoc")) x.loc = v("dnLoc"); x.reason = v("dnReason") || ""; x.note = v("dnNote") || "";
  x.lines.forEach((l, ix) => { const q = document.querySelector(`[data-dnq="${ix}"]`), r = document.querySelector(`[data-dnr="${ix}"]`), t = document.querySelector(`[data-dnt="${ix}"]`);
    if (q) { l.qty = Math.max(0, num(q.value) * l.f); if (l.max != null && l.qty > l.max + 1e-9) { l.qty = l.max; q.value = +(l.max / l.f).toFixed(3); } } if (r) l.rate = num(r.value) / l.f; if (t) l.taxPct = num(t.value); });
}
async function saveDn() {
  syncDn(); const x = ui.sheet.x; const ings = M.ingMap(); let sup = x.supplier.trim(); if (!sup) { toast("Choose the supplier"); return; }
  const known = byNameOrAka(M.suppliers(), sup); if (known) sup = known.name; else if (!x.grnId) { toast("Pick a supplier you have bought from"); return; }
  const lines = x.lines.filter(l => l.qty > 0); if (!lines.length) { toast("Enter what is going back"); return; }
  if (!x.reason) { toast("Choose a reason"); return; }
  const g = x.grnId ? M.grns().find(y => y.id === x.grnId) : null;
  if (g) { if (g.void) { toast(`${g.no} was undone meanwhile`); return; } const left = Object.fromEntries(returnable(g).map(l => [l.ingId, l.left])); const over = lines.find(l => l.qty > (left[l.ingId] || 0) + 1e-9); if (over) { toast(`Only ${qty(left[over.ingId] || 0, ings[over.ingId].unit)} of ${ings[over.ingId].name} is left to return`); closeSheet(); dnSheet({ grnId: g.id }); return; } }
  const t = totals({ lines }); const no = M.nextDocNo("preturns", R.numPrefix(), "DN");
  if (!await yesNo(`<p class="cq">Save ${esc(no)}?</p><div class="cdetail">${esc(sup)}${g ? " · against " + esc(g.no) : ""}<br>${lines.map(l => esc(ings[l.ingId].name) + " " + qty(l.qty, ings[l.ingId].unit)).join("<br>")}<br><br>${rs2(t.total)} comes off what you owe · stock comes off at ${esc(M.locName(x.loc))}</div>`, "Save debit note", "btn-danger-solid")) return;
  const id = uid("dn");
  // Stock leaves at what it cost when it came in (the GRN's cost, or today's average), keeping the average cost steady.
  for (const l of lines) await putMove({ ingId: l.ingId, type: "purchase", qty: -l.qty, amount: -r2(l.qty * (l.costRate || 0)), ret: true, date: x.date, note: `${no} · returned to ${sup}`, ref: id, outletId: x.loc });
  await ev.put("preturns", { id, no, date: x.date, supplier: sup, loc: x.loc, ...(g ? { grnId: g.id, grnNo: g.no } : {}), reason: x.reason, note: x.note.trim(),
    lines: lines.map(l => ({ ingId: l.ingId, qty: l.qty, amount: r2(l.qty * l.rate), taxPct: +l.taxPct || 0, cost: r2(l.qty * (l.costRate || 0)) })), amount: t.amount, tax: t.tax, total: t.total, by: (R.me() || {}).id || "" });
  sync.soon(); closeSheet(); toast(`${no} saved · ${rs2(t.total)} off ${sup}’s balance`);
}
function dnDetail(id) {
  const d = M.preturns().find(x => x.id === id); if (!d) { closeSheet(); return; } const ings = M.ingMap();
  openSheet({ kind: "dnView", id, redraw: () => dnDetail(id) }, `<div class="sh-head"><h2 class="h">${esc(d.no)}</h2><button class="x" data-close aria-label="Close">×</button></div>
  <div class="subl" style="margin:-4px 0 10px">Debit note · ${esc(d.supplier)}${d.grnNo ? " · against " + esc(d.grnNo) : ""} · ${esc(dLong(d.date))} · from ${esc(M.locName(d.loc))}${who(d) ? " · " + esc(who(d)) : ""}</div>
  ${d.void ? `<div class="banner bad">Undone. The stock was put back and the supplier owes nothing back for it.</div>` : ""}
  <div class="kv">${d.lines.map(l => { const i = ings[l.ingId]; return `<div><span>${esc(i ? i.name : "Removed material")} <small class="mut">${i ? qty(l.qty, i.unit) : l.qty}${l.taxPct ? ` · ${l.taxPct}%` : ""}</small></span><span>${rs2(l.amount)}</span></div>`; }).join("")}
  ${d.tax ? `<div><span>${esc(M.taxCfg().name)}</span><span>${rs2(d.tax)}</span></div>` : ""}<div class="tot"><span>Total</span><span>${rs2(d.total)}</span></div></div>
  <p class="hint">Reason: ${esc(d.reason || "–")}${d.note ? ` · ${esc(d.note)}` : ""}</p>
  ${!d.void && R.can("stock.buy") ? `<button class="btn btn-danger" data-dnundo="${esc(d.id)}">Undo this debit note</button>` : ""}`);
}
async function undoDn(id) {
  if (!guard("stock.buy")) return; if (!await yesNo(`<p class="cq">Undo this debit note?</p><div class="cdetail">The stock goes back in and the supplier’s balance goes back up. It stays in the list, marked undone.</div>`, "Undo", "btn-danger-solid")) return;
  const cur = ev.get("preturns", id); if (!cur || cur.void || ev.all("moves").some(m => m.ref === id + ":undo")) { toast("Already undone"); return; }
  for (const m of ev.all("moves").filter(m => m.ref === id)) await putMove({ ingId: m.ingId, type: "adjust", qty: -m.qty, note: "Debit note undone", ref: id + ":undo", outletId: m.outletId });
  await ev.put("preturns", clean({ ...cur, void: true, voidAt: new Date().toISOString() })); sync.soon(); toast(`${cur.no} undone`); dnDetail(id);
}
H.click.push(async T => {
  if (T.closest("[data-dnnew]")) { dnSheet(); return true; }
  const gr = T.closest("[data-grnreturn]"); if (gr) { dnSheet({ grnId: gr.dataset.grnreturn }); return true; }
  const dd = T.closest("[data-dn]"); if (dd) { dnDetail(dd.dataset.dn); return true; }
  const du = T.closest("[data-dnundo]"); if (du) { await undoDn(du.dataset.dnundo); return true; }
  const st = ui.sheet; if (!st || st.kind !== "dnNew") return false;
  if (T.closest("[data-dnadd]")) { syncDn(); const l = freeLine(); if (l) st.x.lines.push(l); drawDn(st); return true; }
  const rm = T.closest("[data-dnrm]"); if (rm) { syncDn(); st.x.lines.splice(+rm.dataset.dnrm, 1); if (!st.x.lines.length) st.x.lines.push(freeLine()); drawDn(st); return true; }
  if (T.closest("[data-dnsave]")) { await saveDn(); return true; }
  return false;
});
H.input.push(T => { const st = ui.sheet; if (!st || st.kind !== "dnNew" || (T.dataset.dnq == null && T.dataset.dnr == null && T.dataset.dnt == null)) return false; syncDn(); const el = $("#dnTot"); if (el) el.innerHTML = totRows(totals(st.x)); return true; });
H.change.push(T => { const st = ui.sheet; if (!st || st.kind !== "dnNew") return false;
  if (T.dataset.dning != null) { syncDn(); const l = freeLine(T.value); st.x.lines[+T.dataset.dning] = l; drawDn(st); return true; }
  if (T.id === "dnLoc") { syncDn(); drawDn(st); return true; }
  return false; });
