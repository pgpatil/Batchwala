// Sales beyond the single order: quotations, standing (repeating) orders, credit notes for returns, price lists by customer group,
// credit limits, customer details (birthday, anniversary) with celebration reminders, and WhatsApp broadcasts to a group of customers.
import * as ev from "./events.js";
import * as sync from "./sync.js";
import * as M from "./model.js";
import * as R from "./roles.js";
import { asLines, layoutSwitch } from "./table.js";
import { S, A, V, H, guard, chipBar, searchBox, band, clean, saveOrder, addPayment } from "./core.js";
import { compose, orderText } from "./orders.js";
import { esc, rs, rs2, num, uid, today, addDays, dObj, dLong, dLabel, ICON, copyText, waHref } from "./util.js";
import { ui, toast, openSheet, closeSheet, ask, yesNo } from "./ui.js";

const r2 = v => Math.round(v * 100) / 100;
const custOf = o => M.customers().find(c => c.key === M.ckey(o));
const master = key => ev.get("custs", key);
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const dow = d => (dObj(d).getDay() + 6) % 7;

/* ---------- price lists ---------- */
// A price list is a customer group (wholesale, cafés, staff) with a % off the menu price and any item prices of its own.
export const priceLists = () => M.config().priceLists || [];
export function priceFor(m, o) { const c = o && o.customer ? master(M.ckey(o)) : null; const pl = c && c.group ? priceLists().find(p => p.id === c.group) : null;
  if (!pl) return m.price; const own = (pl.items || {})[m.id]; return own != null && own !== "" ? +own : Math.round(m.price * (1 - (+pl.pct || 0) / 100) * 100) / 100; }
H.priceFor = priceFor;
// Picking a customer with a price list re-prices lines still at the plain menu price.
H.repriceFor = o => { const menu = M.menu(); o.items.forEach(i => { const m = i.menuId && menu.find(x => x.id === i.menuId); if (m && i.rate === m.price) i.rate = priceFor(m, o); }); };
function priceListsSheet() {
  if (!R.isAdmin() && !R.can("prices")) { toast("Only the admin or management can change price lists"); return; }
  const st = { kind: "priceLists", lists: JSON.parse(JSON.stringify(priceLists())), open: S.plOpen || "" }; st.redraw = () => drawPl(st); drawPl(st);
}
function drawPl(st) {
  const menu = M.menuActive(); const cnt = id => ev.all("custs").filter(c => c.group === id).length;
  openSheet(st, `<div class="sh-head"><h2 class="h">Price lists</h2><button class="x" data-close aria-label="Close">×</button></div>
  <p class="hint" style="margin-top:-4px">Give a group of customers (wholesale, cafés, staff) their own prices: a % off the menu, and any item at its own price. Set a customer’s price list on their page.</p>
  ${st.lists.map((p, ix) => `<div class="card" style="margin:10px 0;padding:10px 12px"><div class="two"><div><label class="f" for="plN${ix}">Name</label><input class="in" id="plN${ix}" data-pln="${ix}" value="${esc(p.name)}"></div><div><label class="f" for="plP${ix}">% off menu price</label><input class="in" id="plP${ix}" data-plp="${ix}" inputmode="decimal" value="${p.pct || ""}" placeholder="0"></div></div>
    <p class="hint">${cnt(p.id)} customer${cnt(p.id) === 1 ? "" : "s"} on this list. <button class="linkbtn" data-plopen="${esc(p.id)}">${st.open === p.id ? "Hide item prices" : "Item prices"}</button> · <button class="linkbtn" data-plrm="${ix}">Remove</button></p>
    ${st.open === p.id ? `<div class="kv">${menu.map(m => `<div style="align-items:center"><span>${esc(m.name)} <small class="mut">menu ${rs(m.price)}</small></span><input class="in" data-plitem="${ix}:${esc(m.id)}" inputmode="decimal" value="${(p.items || {})[m.id] ?? ""}" placeholder="${rs(Math.round(m.price * (1 - (+p.pct || 0) / 100)))}" style="max-width:110px"></div>`).join("")}</div>` : ""}</div>`).join("") || `<p class="hint">No price lists yet.</p>`}
  <button class="add-line" data-pladd>+ Add a price list</button>
  <button class="btn btn-primary" data-plsave>Save price lists</button>`);
}
function syncPl(st) { st.lists.forEach((p, ix) => { const n = document.querySelector(`[data-pln="${ix}"]`), pc = document.querySelector(`[data-plp="${ix}"]`); if (n) p.name = n.value.trim(); if (pc) p.pct = Math.max(0, Math.min(100, num(pc.value)));
  document.querySelectorAll(`[data-plitem^="${ix}:"]`).forEach(el => { const id = el.dataset.plitem.split(":")[1]; p.items = p.items || {}; if (el.value.trim() === "") delete p.items[id]; else p.items[id] = num(el.value); }); }); }

/* ---------- customer details: price list, credit limit, birthday, anniversary ---------- */
function custDetails(key) {
  const c = M.customers().find(x => x.key === key); if (!c) return; const m = master(key) || {};
  openSheet({ kind: "custEdit", key, redraw: () => custDetails(key) }, `<div class="sh-head"><h2 class="h">${esc(c.customer)}</h2><button class="x" data-close aria-label="Close">×</button></div>
  <div class="two"><div><label class="f" for="ceBday">Birthday</label><input class="in" id="ceBday" type="date" value="${esc(m.birthday || "")}"></div><div><label class="f" for="ceAnni">Anniversary</label><input class="in" id="ceAnni" type="date" value="${esc(m.anniversary || "")}"></div></div>
  <p class="hint">The year doesn’t matter; you’re reminded a week ahead every year.</p>
  ${priceLists().length ? `<label class="f" for="ceGroup">Price list</label><select class="in" id="ceGroup"><option value="">Menu prices</option>${priceLists().map(p => `<option value="${esc(p.id)}" ${m.group === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select>` : ""}
  ${R.can("money") ? `<label class="f" for="ceLimit">Credit limit ₹ <small class="mut">(blank = no limit · new orders past it need the admin or management)</small></label><input class="in" id="ceLimit" inputmode="numeric" value="${m.creditLimit || ""}" placeholder="No limit">` : ""}
  <label class="f" for="ceNotes">Notes</label><input class="in" id="ceNotes" value="${esc(m.notes || c.notes || "")}" placeholder="e.g. no nuts, prefers morning delivery">
  <button class="btn btn-primary" data-cesave="${esc(key)}">Save</button>`);
}
async function saveCust(key) {
  const c = M.customers().find(x => x.key === key); if (!c) return; const m = master(key); const g = id => document.getElementById(id);
  const rec = { ...(m ? clean(m) : { id: key }), customer: c.customer, flat: c.flat || "", phone: (m && m.phone) || c.phone || "", birthday: g("ceBday").value, anniversary: g("ceAnni").value, notes: g("ceNotes").value.trim(),
    ...(g("ceGroup") ? { group: g("ceGroup").value } : {}), ...(g("ceLimit") ? { creditLimit: Math.max(0, Math.round(num(g("ceLimit").value))) } : {}) };
  await ev.put("custs", rec); sync.soon(); toast("Saved"); H.custSheet ? H.custSheet(key) : closeSheet();
}
// Over the credit limit: owed so far (less credit held) plus this order. The admin and management can let it through.
H.creditCheck = async (o, st) => {
  const m = master(M.ckey(o)); if (!m || !(+m.creditLimit > 0)) return true; const c = custOf(o); const prev = !st.isNew ? M.orders().find(x => x.id === o.id) : null;
  const owed = (c ? c.balance - (c.credit || 0) : 0) - (prev ? M.bal(prev) : 0) + M.total(M.withTax(o)); if (owed <= m.creditLimit + 0.5) return true;
  const boss = R.isAdmin() || R.role() === "management";
  if (!boss) { toast(`${o.customer} would owe ${rs(owed)}, over their limit of ${rs(m.creditLimit)}. Collect first, or ask the admin.`); return false; }
  return !!await yesNo(`<p class="cq">Over the credit limit</p><div class="cdetail">${esc(o.customer)} would owe ${rs(owed)}; their limit is ${rs(m.creditLimit)}.</div>`, "Save anyway", "btn-danger-solid", "Go back");
};

/* ---------- quotations ---------- */
export const quotes = () => ev.all("quotes").sort((a, b) => (b.date + b._at).localeCompare(a.date + a._at));
const qState = q => q.status === "open" && q.valid && q.valid < today() ? "expired" : q.status;
const Q_LABEL = { open: "Open", accepted: "Accepted", declined: "Declined", expired: "Expired" };
const qTag = q => { const s = qState(q); return `<span class="tag ${{ open: "t-part", accepted: "t-paid", declined: "t-due", expired: "t-camp" }[s]}">${Q_LABEL[s]}</span>`; };
H.quoteCount = () => quotes().filter(q => qState(q) === "open").length;
H.saveQuote = async (o, st) => {
  if (!o.customer.trim()) { toast("Add the customer’s name"); return; }
  const prev = o.id && ev.get("quotes", o.id); const c = M.config();
  const rec = { ...clean(M.withTax(o)), id: prev ? o.id : uid("qt"), no: prev ? prev.no : M.nextDocNo("quotes", R.numPrefix(), "QT"), date: prev ? prev.date : today(), valid: prev ? prev.valid : addDays(today(), +(c.quoteDays || 7)), status: prev ? prev.status : "open", by: (R.me() || {}).id || "" };
  ["status_", "deliveredAt", "billSentAt", "billTotal"].forEach(k => delete rec[k]); rec.status = prev ? prev.status : "open";
  await ev.put("quotes", rec); sync.soon(); ui.sheet = null; closeSheet(); toast(`${rec.no} saved`); S.view = "quotes"; H.render();
};
H.quoteAccepted = async (qid, orderId) => { const q = ev.get("quotes", qid); if (q) await ev.put("quotes", { ...clean(q), status: "accepted", orderId }); };
A.composeAsQuote = () => { const st = ui.sheet; if (!st || st.kind !== "compose") return; st.quote = true; st.redraw(); };
const quoteText = q => { const c = M.config(); return `Hi ${(q.customer || "").split(" ")[0]}! 🧁 Quotation ${q.no} from ${c.business}${q.date ? ` (${dLong(q.date)})` : ""}:\n` + q.items.map(i => `• ${i.item} × ${i.qty} — ${rs(i.qty * i.rate)}`).join("\n")
  + (M.disc(q) ? `\n${M.offerText(q)} — −${rs(M.disc(q))}` : "") + (q.charges || []).map(ch => `\n${ch.name} — ${rs(ch.amount)}`).join("") + `\n*Total ${rs(M.total(q))}*${q.date ? `\nFor ${dLong(q.date)}` : ""}\nValid till ${dLong(q.valid)}.${q.notes ? `\n${q.notes}` : ""}\n\nReply to confirm. Thank you! 💛`; };
function quoteHtml(q) {
  const c = M.config(); const t = M.taxCfg(); const tl = M.taxLines(q);
  return `<div class="inv"><div class="inv-head"><div><h2>${esc(c.business)}</h2>${c.address ? `<div>${esc(c.address).replace(/\n/g, "<br>")}</div>` : ""}${c.phone ? `<div>Phone ${esc(c.phone)}</div>` : ""}${t.gstin ? `<div>${esc(t.name)}IN <b>${esc(t.gstin)}</b></div>` : ""}</div>
    <div class="inv-meta"><h3>QUOTATION</h3><div>No. <b>${esc(q.no)}</b></div><div>Date ${esc(dLong(q.date))}</div><div>Valid till <b>${esc(dLong(q.valid))}</b></div></div></div>
    <div class="inv-to"><small>For</small><b>${esc(q.customer)}</b>${q.flat ? ` · ${esc(q.flat)}` : ""}${q.phone ? ` · ${esc(q.phone)}` : ""}${q.date ? `<div>Wanted on ${esc(dLong(q.date))}</div>` : ""}</div>
    <table class="inv-t"><thead><tr><th>#</th><th>Item</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead><tbody>${q.items.map((i, ix) => `<tr><td>${ix + 1}</td><td>${esc(i.item)}</td><td class="num">${i.qty}</td><td class="num">${rs2(i.rate)}</td><td class="num">${rs2(i.qty * i.rate)}</td></tr>`).join("")}
    ${(q.charges || []).map(ch => `<tr><td></td><td>${esc(ch.name)}</td><td class="num">1</td><td class="num">${rs2(ch.amount)}</td><td class="num">${rs2(ch.amount)}</td></tr>`).join("")}</tbody></table>
    <div class="inv-tot"><div><span>Items</span><b>${rs2(M.sub(q))}</b></div>${M.disc(q) ? `<div><span>${esc(M.offerText(q))}</span><b>−${rs2(M.disc(q))}</b></div>` : ""}${tl.map(([n, v]) => `<div><span>${q.taxIncl ? "incl. " : ""}${esc(n)}</span><b>${rs2(v)}</b></div>`).join("")}<div class="grand"><span>Total</span><b>${rs2(M.total(q))}</b></div><div class="inv-words">Rupees ${H.words ? H.words(M.total(q)) : M.total(q)} only</div></div>
    <div class="inv-foot">${q.notes ? esc(q.notes) + "<br>" : ""}Prices valid till ${esc(dLong(q.valid))}. An advance confirms the order.${c.upi ? ` UPI: ${esc(c.upi)}` : ""}</div></div>`;
}
V.quotes = () => {
  S.filter.qt = S.filter.qt || "open"; const all = quotes(); const k = S.filter.qt; const q = (S.query.quotes || "").toLowerCase().trim();
  const list = all.filter(x => k === "all" || qState(x) === k).filter(x => !q || `${x.no} ${x.customer} ${x.flat}`.toLowerCase().includes(q));
  const open = all.filter(x => qState(x) === "open"); const won = all.filter(x => x.status === "accepted").length, decided = all.filter(x => ["accepted", "declined"].includes(x.status)).length;
  let h = band("Quotations", R.can("orders.edit") ? `<button class="pillbtn" data-qnew>${ICON.plus}New quotation</button>` : "", `<div class="stats"><div class="st"><b>${open.length}</b><span>open · ${rs(open.reduce((s, x) => s + M.total(x), 0))}</span></div><div class="st"><b>${decided ? Math.round(won / decided * 100) + "%" : "–"}</b><span>accepted of decided</span></div></div>`);
  h += `<div class="tools">${searchBox("quotes", "Search customer or QT number")}${layoutSwitch("quotes")}${chipBar("qt", [["open", "Open", open.length], ["accepted", "Accepted"], ["declined", "Declined"], ["expired", "Expired"], ["all", "All", all.length]])}</div>`;
  if (!list.length) return h + `<div class="empty"><strong>No quotations here</strong>For bulk and event enquiries: a priced quotation with a validity date, shared on WhatsApp or printed, then turned into an order when the customer confirms.</div>`;
  return h + (asLines("quotes") ? `<div class="card tablecard"><table class="reg"><thead><tr><th>No.</th><th>Date</th><th>Customer</th><th>Wanted on</th><th>Valid till</th><th class="r">Total</th><th>Status</th></tr></thead><tbody>${list.map(x => `<tr data-quote="${esc(x.id)}" tabindex="0"><td><b>${esc(x.no)}</b></td><td data-v="${esc(x.date)}">${esc(dLong(x.date))}</td><td>${esc(x.customer)}${x.flat ? ` <small class="mut">${esc(x.flat)}</small>` : ""}</td><td>${x.date ? esc(dLong(x.date)) : "–"}</td><td data-v="${esc(x.valid)}">${esc(dLong(x.valid))}</td><td class="r" data-v="${M.total(x)}">${rs(M.total(x))}</td><td>${qTag(x)}</td></tr>`).join("")}</tbody></table></div>`
    : `<ul class="list">${list.map(x => `<li class="row"><button class="who" data-quote="${esc(x.id)}"><div class="nm">${esc(x.no)} · ${esc(x.customer)}</div><div class="subl">${qTag(x)} valid till ${esc(dLong(x.valid))} · ${esc(x.items.map(i => i.item + " ×" + i.qty).join(", "))}</div></button><div class="amt">${rs(M.total(x))}</div></li>`).join("")}</ul>`);
};
function quoteDetail(id) {
  const q = ev.get("quotes", id); if (!q) { closeSheet(); return; } const s = qState(q); const edit = R.can("orders.edit");
  openSheet({ kind: "quoteView", id, redraw: () => quoteDetail(id) }, `<div class="sh-head"><h2 class="h">${esc(q.no)}</h2><button class="x" data-close aria-label="Close">×</button></div>
  <div class="subl" style="margin:-4px 0 10px">${esc(q.customer)}${q.flat ? " · " + esc(q.flat) : ""} · made ${esc(dLong(q.date))} · valid till ${esc(dLong(q.valid))} ${qTag(q)}</div>
  <div class="kv">${q.items.map(i => `<div><span>${esc(i.item)} × ${i.qty} <small class="mut">@ ${rs(i.rate)}</small></span><span>${rs(i.qty * i.rate)}</span></div>`).join("")}${M.disc(q) ? `<div><span>${esc(M.offerText(q))}</span><span>−${rs(M.disc(q))}</span></div>` : ""}${(q.charges || []).map(ch => `<div><span>${esc(ch.name)}</span><span>${rs(ch.amount)}</span></div>`).join("")}<div class="tot"><span>Total</span><span>${rs(M.total(q))}</span></div></div>
  ${q.orderId ? `<p class="hint">Became order <button class="linkbtn" data-open="${esc(q.orderId)}">${esc((M.orders().find(o => o.id === q.orderId) || {}).no || "")}</button>.</p>` : ""}
  <div class="btnrow"><a class="btn btn-wa" href="${esc(waHref(q.phone || "", quoteText(q)))}" target="_blank" rel="noopener">${ICON.wa}Send</a><button class="btn btn-ghost" data-qprint="${esc(id)}">${ICON.print}Print / PDF</button></div>
  ${edit && s !== "accepted" ? `<button class="btn btn-ok" data-qconvert="${esc(id)}">${ICON.check}Customer confirmed · make the order</button>
  <div class="btnrow"><button class="btn btn-ghost" data-qedit="${esc(id)}">Edit</button>${s === "open" || s === "expired" ? `<button class="btn btn-ghost" data-qextend="${esc(id)}">Extend 7 days</button><button class="btn btn-danger" data-qdecline="${esc(id)}">Declined</button>` : ""}</div>` : ""}`);
}

/* ---------- standing orders ---------- */
export const standings = () => ev.all("standing").sort((a, b) => a.customer.localeCompare(b.customer));
H.standingFields = o => { o.days = o.days || [0, 1, 2, 3, 4, 5]; return `<label class="f">Repeat on</label><div class="chips">${DOW.map((d, i) => `<button class="chip" data-sodow="${i}" aria-pressed="${o.days.includes(i)}">${d}</button>`).join("")}</div>
  <div class="two"><div><label class="f" for="soFrom">From</label><input class="in" type="date" id="soFrom" value="${esc(o.from || addDays(today(), 1))}"></div><div><label class="f" for="soUntil">Until <small class="mut">(blank = no end)</small></label><input class="in" type="date" id="soUntil" value="${esc(o.until || "")}"></div></div>`; };
H.saveStanding = async (o, st) => {
  if (!o.customer.trim()) { toast("Add the customer’s name"); return; } const from = (document.getElementById("soFrom") || {}).value || o.from || today(), until = (document.getElementById("soUntil") || {}).value || "";
  if (!(o.days || []).length) { toast("Pick the days it repeats on"); return; } if (until && until < from) { toast("Until is before From"); return; }
  const prev = o.id && ev.get("standing", o.id);
  const rec = { id: prev ? o.id : uid("so"), no: prev ? prev.no : M.nextDocNo("standing", R.numPrefix(), "SO"), customer: o.customer.trim(), flat: o.flat.trim().toUpperCase(), phone: o.phone.trim(), channel: o.channel || "whatsapp", items: o.items.map(({ item, qty, rate, menuId }) => ({ item, qty, rate, ...(menuId ? { menuId } : {}) })),
    discountPct: o.discountPct || 0, discountAmt: o.discountAmt || 0, charges: o.charges || [], days: [...o.days].sort(), from, until, slot: o.slot || "", notes: o.notes || "", active: prev ? prev.active !== false : true, skip: prev ? prev.skip || [] : [] };
  await ev.put("standing", rec); sync.soon(); ui.sheet = null; closeSheet(); await runStanding(); toast(`${rec.no} saved · orders are made ${AHEAD} days ahead`); S.view = "standing"; H.render();
};
const AHEAD = 2;
const sDates = (s, from, to) => { const out = []; for (let d = from; d <= to; d = addDays(d, 1)) if (d >= s.from && (!s.until || d <= s.until) && s.days.includes(dow(d)) && !(s.skip || []).includes(d)) out.push(d); return out; };
// Makes the standing orders' orders for today and the next days. Each has a fixed id (standing + date), so two phones making it
// at the same time make the same order; one that was cancelled or deleted is never made again.
export async function runStanding() {
  const t = today(); let n = 0;
  for (const s of standings().filter(x => x.active !== false)) for (const d of sDates(s, t, addDays(t, AHEAD))) { const id = `so-${s.id}-${d}`;
    if (ev.get("orders", id) || ev.history("orders", id).length) continue;
    await saveOrder({ id, no: `${s.no}/${d.slice(5).replace("-", "")}`, customer: s.customer, flat: s.flat, phone: s.phone, channel: s.channel, date: d, items: s.items.map(i => ({ ...i })), discountPct: s.discountPct || 0, discountAmt: s.discountAmt || 0, charges: s.charges || [], slot: s.slot || "", notes: s.notes || "", status: "received", tag: "", standingId: s.id, createdAt: new Date().toISOString() }); n++; }
  return n;
}
H.standingRun = runStanding;
V.standing = () => {
  const all = standings(); const t = today(); const next = s => sDates(s, t, addDays(t, 14))[0];
  let h = band("Standing orders", R.can("orders.edit") ? `<button class="pillbtn" data-sonew>${ICON.plus}New standing order</button>` : "", `<div class="stats"><div class="st"><b>${all.filter(s => s.active !== false).length}</b><span>active</span></div><div class="st"><b>${rs(all.filter(s => s.active !== false).reduce((x, s) => x + M.total(M.withTax(s)) * s.days.length, 0))}</b><span>a week</span></div></div>`);
  h += `<div class="tools">${layoutSwitch("standing")}</div>`;
  if (!all.length) return h + `<div class="empty"><strong>No standing orders</strong>For customers who take the same thing on set days (a café’s daily bread, Sunday cakes): the orders are made by themselves ${AHEAD} days ahead and show on Today and the bake board like any other.</div>`;
  return h + `<div class="card tablecard"><table class="reg"><thead><tr><th>No.</th><th>Customer</th><th>Items</th><th>Days</th><th>Next</th><th class="r">Each</th><th>Status</th></tr></thead><tbody>${all.map(s => `<tr data-so="${esc(s.id)}" tabindex="0"><td><b>${esc(s.no)}</b></td><td>${esc(s.customer)}${s.flat ? ` <small class="mut">${esc(s.flat)}</small>` : ""}</td><td class="items">${esc(s.items.map(i => i.item + " ×" + i.qty).join(", "))}</td><td>${esc(s.days.map(i => DOW[i]).join(" "))}</td><td>${next(s) ? esc(dLabel(next(s))) : "–"}</td><td class="r">${rs(M.total(M.withTax(s)))}</td><td>${s.active === false ? `<span class="tag t-camp">Paused</span>` : s.until && s.until < t ? `<span class="tag t-camp">Ended</span>` : `<span class="tag t-paid">Active</span>`}</td></tr>`).join("")}</tbody></table></div>`;
};
function soDetail(id) {
  const s = ev.get("standing", id); if (!s) { closeSheet(); return; } const t = today(); const up = sDates({ ...s, skip: [] }, t, addDays(t, 13)); const made = M.orders().filter(o => o.standingId === id).sort((a, b) => a.date < b.date ? 1 : -1).slice(0, 8);
  openSheet({ kind: "soView", id, redraw: () => soDetail(id) }, `<div class="sh-head"><h2 class="h">${esc(s.no)} · ${esc(s.customer)}</h2><button class="x" data-close aria-label="Close">×</button></div>
  <div class="subl" style="margin:-4px 0 10px">${esc(s.days.map(i => DOW[i]).join(", "))} · from ${esc(dLong(s.from))}${s.until ? " until " + esc(dLong(s.until)) : ""}${s.slot ? " · " + esc(s.slot) : ""}</div>
  <div class="kv">${s.items.map(i => `<div><span>${esc(i.item)} × ${i.qty}</span><span>${rs(i.qty * i.rate)}</span></div>`).join("")}<div class="tot"><span>Each order</span><span>${rs(M.total(M.withTax(s)))}</span></div></div>
  <label class="f">Next two weeks <small class="mut">(tap a day to skip it or bring it back)</small></label><div class="chips">${up.map(d => `<button class="chip" data-soskip="${esc(d)}" aria-pressed="${!(s.skip || []).includes(d)}">${esc(dLabel(d))}</button>`).join("") || `<span class="hint">None</span>`}</div>
  ${made.length ? `<label class="f" style="margin-top:12px">Orders made</label><div class="kv">${made.map(o => `<div><button class="linkbtn" data-open="${esc(o.id)}">${esc(o.no)}</button><span>${esc(dLong(o.date))} · ${esc(M.STATUS_LABEL[o.status] || o.status)}</span></div>`).join("")}</div>` : ""}
  <p class="hint">Changes apply to orders not made yet; the next ${AHEAD} days’ orders are already on the board and are changed like any order.</p>
  ${R.can("orders.edit") ? `<div class="btnrow"><button class="btn btn-ghost" data-soedit="${esc(id)}">Edit</button><button class="btn btn-ghost" data-sopause="${esc(id)}">${s.active === false ? "Resume" : "Pause"}</button></div><button class="btn btn-danger" data-sodel="${esc(id)}">Remove standing order</button>` : ""}`);
}

/* ---------- sales returns: credit notes ---------- */
// Goods sent back or found faulty: a credit note for the lines returned. It counts as received on the order (mode "Credit note"),
// so what's owed drops; if the order was already paid, the usual "paid above the total" choice refunds it or keeps it as credit.
export const creditNotes = () => ev.all("creturns").sort((a, b) => (b.date + b._at).localeCompare(a.date + a._at));
const returnedOf = o => { const r = {}; creditNotes().filter(c => c.orderId === o.id && !c.void).forEach(c => c.lines.forEach(l => { r[l.item] = (r[l.item] || 0) + l.qty; })); return r; };
H.orderExtras = o => {
  const cns = creditNotes().filter(c => c.orderId === o.id && !c.void); const s = o.standingId && ev.get("standing", o.standingId); const qt = quotes().find(q => q.orderId === o.id);
  return `${cns.length ? `<div class="kv" style="margin-bottom:8px">${cns.map(c => `<div><span>Credit note <b>${esc(c.no)}</b> · ${esc(dLong(c.date))} · ${esc(c.reason || "")}</span><span>−${rs2(c.total)}</span></div>`).join("")}</div>` : ""}
  ${s || qt ? `<p class="hint">${s ? `From standing order <button class="linkbtn" data-so="${esc(s.id)}">${esc(s.no)}</button>. ` : ""}${qt ? `From quotation <button class="linkbtn" data-quote="${esc(qt.id)}">${esc(qt.no)}</button>.` : ""}</p>` : ""}
  ${R.can("money") && R.can("pay.record") && M.isDelivered(o) && o.status !== "cancelled" ? `<button class="btn btn-ghost" data-cnnew="${esc(o.id)}">Return / credit note</button>` : ""}`;
};
const RET_REASONS = ["Damaged in delivery", "Quality complaint", "Wrong item", "Not delivered in time", "Other"];
function cnSheet(id) {
  const o = M.orders().find(x => x.id === id); if (!o) return; const back = returnedOf(o); const f = 1 - M.discF(o);
  const lines = o.items.map(i => ({ item: i.item, max: i.qty - (back[i.item] || 0), qty: 0, rate: i.rate * f, taxPct: +i.taxPct || 0 })).filter(l => l.max > 0);
  if (!lines.length) { toast("Everything on this order is already credited"); return; }
  const st = { kind: "cnNew", id, lines, reason: "" }; st.redraw = () => drawCn(st); drawCn(st);
}
const cnTot = (o, lines) => { let taxable = 0, tax = 0; lines.forEach(l => { const g = l.qty * l.rate; const tx = o.taxIncl ? g - g / (1 + l.taxPct / 100) : g * l.taxPct / 100; taxable += o.taxIncl ? g - tx : g; tax += tx; }); return { taxable: r2(taxable), tax: r2(tax), total: Math.round(taxable + tax) }; };
function drawCn(st) {
  const o = M.orders().find(x => x.id === st.id); const t = cnTot(o, st.lines);
  openSheet(st, `<div class="sh-head"><h2 class="h">Credit note · order ${esc(o.no)}</h2><button class="x" data-close aria-label="Close">×</button></div>
  <p class="hint" style="margin-top:-4px">Pick what came back or is being credited. Prices are what the customer paid, after any offer.</p>
  <div class="kv">${st.lines.map((l, ix) => `<div style="align-items:center"><span>${esc(l.item)} <small class="mut">up to ${l.max} · ${rs2(l.rate)} each</small></span><div class="stepper"><button data-cnstep="${ix}:-1" aria-label="One less">−</button><span>${l.qty}</span><button data-cnstep="${ix}:1" aria-label="One more">+</button></div></div>`).join("")}</div>
  <label class="f" for="cnReason">Reason</label><select class="in" id="cnReason"><option value="">Choose…</option>${RET_REASONS.map(r => `<option ${st.reason === r ? "selected" : ""}>${esc(r)}</option>`).join("")}</select>
  <div class="kv" style="margin-top:10px">${t.tax ? `<div><span>Taxable</span><span>${rs2(t.taxable)}</span></div><div><span>${esc(M.taxCfg().name)}</span><span>${rs2(t.tax)}</span></div>` : ""}<div class="tot"><span>Credit note total</span><span>${rs(t.total)}</span></div></div>
  <button class="btn btn-primary" data-cnsave ${t.total > 0 ? "" : "disabled"}>Save credit note</button>`);
}
async function saveCn(st) {
  const o = M.orders().find(x => x.id === st.id); st.reason = (document.getElementById("cnReason") || {}).value || ""; if (!st.reason) { toast("Choose a reason"); return; }
  const lines = st.lines.filter(l => l.qty > 0); const t = cnTot(o, lines); if (!(t.total > 0)) return;
  const back = returnedOf(o); if (lines.some(l => l.qty > (o.items.find(i => i.item === l.item) || { qty: 0 }).qty - (back[l.item] || 0))) { toast("Some of that was credited meanwhile"); closeSheet(); return; }
  const id = uid("cn"); const no = M.nextDocNo("creturns", R.numPrefix(), "CN");
  await ev.put("creturns", { id, no, date: today(), orderId: o.id, orderNo: o.no, customer: o.customer, flat: o.flat || "", lines: lines.map(({ item, qty, rate, taxPct }) => ({ item, qty, rate: r2(rate), taxPct })), taxable: t.taxable, tax: t.tax, total: t.total, reason: st.reason, by: (R.me() || {}).id || "" });
  await addPayment(o, t.total, "Credit note", `${no} · ${st.reason}`); sync.soon(); toast(`${no} saved · ${rs(t.total)} credited`); H.openOrder ? H.openOrder(o.id) : closeSheet();
}

/* ---------- celebrations and broadcasts ---------- */
const md = d => (d || "").slice(5);   // MM-DD
// Birthdays and anniversaries in the next `days` days, soonest first (across the year end).
export function celebrations(days = 7) {
  const t = today(); const ahead = Array.from({ length: days }, (_, i) => addDays(t, i)); const out = [];
  ev.all("custs").forEach(c => [["birthday", "🎂 Birthday"], ["anniversary", "💐 Anniversary"]].forEach(([k, l]) => { if (!c[k]) return; const i = ahead.findIndex(d => md(d) === md(c[k])); if (i >= 0) out.push({ c, kind: l, date: ahead[i], in: i }); }));
  return out.sort((a, b) => a.in - b.in);
}
const fill = (tpl, c) => tpl.replace(/\{name\}/g, (c.customer || "").split(" ")[0]).replace(/\{business\}/g, M.config().business || "").replace(/\{upi\}/g, M.config().upi || "");
function celebSheet() {
  const list = celebrations(14); const c = M.config(); const tpl = c.greetText || "Happy {occasion}, {name}! 🎉 Wishing you a lovely day from all of us at {business}. Celebrate with 10% off any cake this week 🍰";
  openSheet({ kind: "celeb", redraw: celebSheet }, `<div class="sh-head"><h2 class="h">Birthdays & anniversaries</h2><button class="x" data-close aria-label="Close">×</button></div>
  <p class="hint" style="margin-top:-4px">The next two weeks. Add dates on a customer’s page (Details).</p>
  <div class="kv">${list.map(x => { const msg = fill(tpl, x.c).replace(/\{occasion\}/g, x.kind.includes("Birthday") ? "birthday" : "anniversary");
    return `<div style="align-items:center"><span>${esc(x.kind)} · <b>${esc(x.c.customer)}</b>${x.c.flat ? ` <small class="mut">${esc(x.c.flat)}</small>` : ""}<small class="mut" style="display:block">${esc(dLabel(x.date))}</small></span>${x.c.phone ? `<a class="btn btn-wa" style="margin:0;height:40px" href="${esc(waHref(x.c.phone, msg))}" target="_blank" rel="noopener">${ICON.wa}Wish</a>` : `<small class="mut">no phone</small>`}</div>`; }).join("") || `<div class="mut">Nothing in the next two weeks.</div>`}</div>
  ${R.isAdmin() ? `<label class="f" for="greetTpl">Greeting <small class="mut">({name}, {occasion}, {business})</small></label><textarea class="in" id="greetTpl" rows="3">${esc(tpl)}</textarea><button class="btn btn-ghost" data-greetsave>Save greeting</button>` : ""}`);
}
const SEGMENTS = [["all", "Everyone with a phone"], ["recent", "Ordered in the last 30 days"], ["lapsed", "No order for 60+ days"], ["month", "Birthday this month"], ["owing", "Owes money"]];
function segment(k, group) {
  const t = today(); return M.customers().filter(c => c.phone).filter(c => { const m = master(c.key) || {};
    if (group && m.group !== group) return false;
    if (k === "recent") return c.last && c.last >= addDays(t, -30); if (k === "lapsed") return !c.last || c.last < addDays(t, -60);
    if (k === "month") return m.birthday && m.birthday.slice(5, 7) === t.slice(5, 7); if (k === "owing") return c.balance > 0; return true; }); }
function broadcastSheet() {
  const st = ui.sheet && ui.sheet.kind === "bcast" ? ui.sheet : { kind: "bcast", seg: "recent", group: "", text: M.config().bcastText || "Hi {name}! 🧁 Fresh this weekend at {business}: …\nOrder on this number. Thank you!", sent: {} };
  st.redraw = broadcastSheet; const list = segment(st.seg, st.group);
  openSheet(st, `<div class="sh-head"><h2 class="h">WhatsApp broadcast</h2><button class="x" data-close aria-label="Close">×</button></div>
  <label class="f">Send to</label><div class="chips">${SEGMENTS.map(([k, l]) => `<button class="chip" data-bseg="${k}" aria-pressed="${st.seg === k}">${l}</button>`).join("")}</div>
  ${priceLists().length ? `<select class="in" id="bGroup" style="margin-top:8px"><option value="">Any price list</option>${priceLists().map(p => `<option value="${esc(p.id)}" ${st.group === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select>` : ""}
  <label class="f" for="bText">Message <small class="mut">({name}, {business}, {upi})</small></label><textarea class="in" id="bText" rows="4">${esc(st.text)}</textarea>
  <p class="hint">${list.length} customer${list.length === 1 ? "" : "s"}. WhatsApp doesn’t allow sending to many people at once from the web, so tap each Send (it opens WhatsApp with the message ready), or copy the numbers into a WhatsApp Broadcast list.</p>
  <div class="btnrow"><button class="btn btn-ghost" data-bcopy>Copy ${list.length} numbers</button></div>
  <div class="kv">${list.map(c => `<div style="align-items:center"><span><b>${esc(c.customer)}</b> <small class="mut">${esc(c.flat || "")} · ${esc(c.phone)}</small></span><a class="btn ${st.sent[c.key] ? "btn-ghost" : "btn-wa"}" data-bsend="${esc(c.key)}" style="margin:0;height:38px" href="${esc(waHref(c.phone, fill(st.text, c)))}" target="_blank" rel="noopener">${st.sent[c.key] ? "Sent ✓" : "Send"}</a></div>`).join("") || `<div class="mut">Nobody in this group has a phone saved.</div>`}</div>`);
}
H.celebCount = () => celebrations(7).length;

/* ---------- actions ---------- */
H.click.push(async T => {
  if (T.closest("[data-qnew]")) { compose(null, { quote: true }); return true; }
  const qd = T.closest("[data-quote]"); if (qd) { quoteDetail(qd.dataset.quote); return true; }
  const qp = T.closest("[data-qprint]"); if (qp) { const q = ev.get("quotes", qp.dataset.qprint); if (q && H.printHtml) H.printHtml(`Quotation ${q.no}`, quoteHtml(q), true); return true; }
  const qe = T.closest("[data-qedit]"); if (qe) { const q = ev.get("quotes", qe.dataset.qedit); if (q) compose({ ...clean(q) }, { quote: true, isNew: false }); return true; }
  const qc = T.closest("[data-qconvert]"); if (qc) { const q = ev.get("quotes", qc.dataset.qconvert); if (!q) return true; const { id, no, valid, status, by, ...rest } = clean(q);
    closeSheet(); compose(null, { customer: q.customer, flat: q.flat, phone: q.phone, channel: q.channel, date: q.date && q.date >= today() ? q.date : today(), items: q.items.map(i => ({ ...i })), notes: q.notes, fromQuote: q.id });
    const st = ui.sheet; if (st && st.kind === "compose") { Object.assign(st.o, { discountPct: q.discountPct || 0, discountAmt: q.discountAmt || 0, coupon: q.coupon || "", charges: (q.charges || []).map(c => ({ ...c })), slot: q.slot || "", cakeMsg: q.cakeMsg || "", weight: q.weight || "", flavour: q.flavour || "", advance: q.advance || 0 }); st.redraw(); } return true; }
  const qx = T.closest("[data-qextend]"); if (qx) { const q = ev.get("quotes", qx.dataset.qextend); await ev.put("quotes", { ...clean(q), status: "open", valid: addDays(q.valid > today() ? q.valid : today(), 7) }); sync.soon(); quoteDetail(q.id); return true; }
  const qn = T.closest("[data-qdecline]"); if (qn) { const q = ev.get("quotes", qn.dataset.qdecline); if (await yesNo(`<p class="cq">Mark ${esc(q.no)} declined?</p>`, "Declined")) { await ev.put("quotes", { ...clean(q), status: "declined" }); sync.soon(); quoteDetail(q.id); } return true; }
  if (T.closest("[data-sonew]")) { compose(null, { standing: true }); return true; }
  const sd = T.closest("[data-so]"); if (sd) { soDetail(sd.dataset.so); return true; }
  const se = T.closest("[data-soedit]"); if (se) { const s = ev.get("standing", se.dataset.soedit); if (s) compose({ ...clean(s), date: s.from, status: "received" }, { standing: true, isNew: false }); return true; }
  const sp = T.closest("[data-sopause]"); if (sp) { const s = ev.get("standing", sp.dataset.sopause); await ev.put("standing", { ...clean(s), active: s.active === false }); sync.soon(); if (s.active === false) await runStanding(); soDetail(s.id); return true; }
  const sk = T.closest("[data-soskip]"); if (sk) { const s = ev.get("standing", ui.sheet.id); const d = sk.dataset.soskip; const skip = new Set(s.skip || []); skip.has(d) ? skip.delete(d) : skip.add(d);
    await ev.put("standing", { ...clean(s), skip: [...skip] }); const made = ev.get("orders", `so-${s.id}-${d}`);
    if (made && skip.has(d) && made.status === "received" && !M.received(made)) { await saveOrder({ ...made, status: "cancelled", cancelReason: "Skipped on the standing order" }); toast(`Order for ${dLabel(d)} cancelled`); }
    sync.soon(); soDetail(s.id); return true; }
  const sx = T.closest("[data-sodel]"); if (sx) { const s = ev.get("standing", sx.dataset.sodel); if (await yesNo(`<p class="cq">Remove ${esc(s.no)}?</p><div class="cdetail">No more orders are made from it. Orders already made stay.</div>`, "Remove", "btn-danger-solid")) { await ev.del("standing", s.id); sync.soon(); closeSheet(); H.render(); } return true; }
  const dw = T.closest("[data-sodow]"); if (dw && ui.sheet && ui.sheet.kind === "compose") { const o = ui.sheet.o; const i = +dw.dataset.sodow; o.days = o.days.includes(i) ? o.days.filter(x => x !== i) : [...o.days, i];
    const f = document.getElementById("soFrom"), u = document.getElementById("soUntil"); if (f) o.from = f.value; if (u) o.until = u.value; ui.sheet.redraw(); return true; }
  const cn = T.closest("[data-cnnew]"); if (cn) { cnSheet(cn.dataset.cnnew); return true; }
  const st = ui.sheet;
  if (st && st.kind === "cnNew") { const s2 = T.closest("[data-cnstep]"); if (s2) { st.reason = (document.getElementById("cnReason") || {}).value || st.reason; const [ix, d] = s2.dataset.cnstep.split(":").map(Number); const l = st.lines[ix]; l.qty = Math.max(0, Math.min(l.max, l.qty + d)); drawCn(st); return true; }
    if (T.closest("[data-cnsave]")) { await saveCn(st); return true; } }
  const cd = T.closest("[data-custdetails]"); if (cd) { custDetails(cd.dataset.custdetails); return true; }
  const cs = T.closest("[data-cesave]"); if (cs) { await saveCust(cs.dataset.cesave); return true; }
  if (st && st.kind === "priceLists") {
    if (T.closest("[data-pladd]")) { syncPl(st); st.lists.push({ id: uid("pl"), name: st.lists.length ? "New list" : "Wholesale", pct: 10, items: {} }); drawPl(st); return true; }
    const po = T.closest("[data-plopen]"); if (po) { syncPl(st); st.open = S.plOpen = st.open === po.dataset.plopen ? "" : po.dataset.plopen; drawPl(st); return true; }
    const pr = T.closest("[data-plrm]"); if (pr) { syncPl(st); const p = st.lists[+pr.dataset.plrm]; if (ev.all("custs").some(c => c.group === p.id) && !await yesNo(`<p class="cq">Remove ${esc(p.name)}?</p><div class="cdetail">Its customers go back to menu prices.</div>`, "Remove", "btn-danger-solid")) return true; st.lists.splice(+pr.dataset.plrm, 1); drawPl(st); return true; }
    if (T.closest("[data-plsave]")) { syncPl(st); if (st.lists.some(p => !p.name)) { toast("Give each price list a name"); return true; } const { _at, _by, ...c } = ev.get("config", "app") || { id: "app" }; await ev.put("config", { ...c, id: "app", priceLists: st.lists }); sync.soon(); toast("Price lists saved"); closeSheet(); return true; } }
  if (T.closest("[data-greetsave]")) { const { _at, _by, ...c } = ev.get("config", "app") || { id: "app" }; await ev.put("config", { ...c, id: "app", greetText: document.getElementById("greetTpl").value.trim() }); sync.soon(); toast("Greeting saved"); return true; }
  if (st && st.kind === "bcast") { st.text = (document.getElementById("bText") || {}).value || st.text; const g = document.getElementById("bGroup"); if (g) st.group = g.value;
    const bs = T.closest("[data-bseg]"); if (bs) { st.seg = bs.dataset.bseg; broadcastSheet(); return true; }
    if (T.closest("[data-bcopy]")) { const ok = await copyText(segment(st.seg, st.group).map(c => c.phone).join(", ")); toast(ok ? "Numbers copied" : "Couldn’t copy here"); return true; }
    const sn = T.closest("[data-bsend]"); if (sn) { st.sent[sn.dataset.bsend] = true; setTimeout(() => { if (ui.sheet === st) broadcastSheet(); }, 300); return false; } }
  return false;
});
H.change.push(T => { const st = ui.sheet; if (st && st.kind === "compose" && (T.id === "soFrom" || T.id === "soUntil")) { st.o[T.id === "soFrom" ? "from" : "until"] = T.value; return true; }
  if (st && st.kind === "bcast" && T.id === "bGroup") { st.text = document.getElementById("bText").value; st.group = T.value; broadcastSheet(); return true; } return false; });
A.priceLists = priceListsSheet; A.celebrations = celebSheet; A.broadcast = () => { if (ui.sheet && ui.sheet.kind === "bcast") ui.sheet = null; broadcastSheet(); };
