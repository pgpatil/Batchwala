// Orders: Today, the Orders list, order detail with lifecycle and history, and the order composer.
import * as ev from "./events.js";
import * as M from "./model.js";
import * as R from "./roles.js";
import { asLines, layoutSwitch } from "./table.js";
import { S, A, V, H, render, guard, saveOrder, payOrders, reversePayments, addPayment, addCredit, logoHtml, toran, chipBar, searchBox, matchQ, band, payTag, chanTag, noLabel } from "./core.js";
import { $, esc, rs, rs2, num, uid, today, addDays, dObj, dLabel, dLong, plate, cmpFlat, ICON, copyText, waHref } from "./util.js";
import { ui, toast, openSheet, closeSheet, ask, yesNo } from "./ui.js";
import * as L from "./lock.js";
import { checkCustomer } from "./match.js";
import { extrasHtml, extrasClick, recheckCoupon } from "./extras.js";

/* ---------- WhatsApp text ---------- */
export function orderText(o) {
  const c = M.config(); const first = (o.customer || "").split(" ")[0];
  let t = `Hi ${first}! 🧁 Your ${c.business} order for ${dLong(o.date)}${o.slot ? ", " + o.slot : ""}:\n`;
  o.items.forEach(i => t += `• ${i.item} × ${i.qty} — ${rs(i.qty * i.rate)}\n`);
  if (M.disc(o)) t += `${M.offerText(o)} — −${rs(M.disc(o))}\n`; (o.charges || []).forEach(c => t += `${c.name} — ${rs(c.amount)}\n`);
  t += taxBlock(o, " — ").map(x => x + "\n").join("");
  if (o.cakeMsg || o.weight || o.flavour) t += [o.weight && `Size: ${o.weight}`, o.flavour && `Flavour: ${o.flavour}`, o.cakeMsg && `Message: “${o.cakeMsg}”`].filter(Boolean).join("\n") + "\n";
  t += `*Total ${rs(M.total(o))}*`; if (advanceDue(o)) t += `\nAdvance to confirm: ${rs(advanceDue(o))}`; if (M.bal(o) > 0 && c.upi) t += `\n\nPay by UPI: ${c.upi}`;
  return t + `\n\nThank you! 💛`;
}
export function reminderText(cu) {
  const c = M.config(); const first = (cu.customer || "").split(" ")[0];
  let t = `Hi ${first}! 😊 A gentle reminder from ${c.business}.\n`;
  cu.orders.filter(o => M.bal(o) > 0).forEach(o => t += `• ${dLabel(o.date)}: ${o.items.map(i => i.item + " × " + i.qty).join(", ")} — ${rs(M.bal(o))}\n`);
  t += `*Balance ${rs(cu.balance)}*`; if (c.upi) t += `\n\nUPI: ${c.upi}`; return t + `\n\nThank you! 💛`;
}

/* ---------- bill summary ---------- */
// Lines are shown at the menu price; a lower charged rate counts as discount, together with any offer %.
function billLines(o) { return o.items.map(i => ({ ...i, list: i.list != null && i.list > i.rate ? i.list : i.rate })); }
// Tax lines for messages and bills: exclusive tax is added ("CGST 2.5%: ₹3"); inclusive is shown as included. Round-off when the total was rounded.
export function taxBlock(o, sep = ": ") {
  const tl = M.taxLines(o); if (!tl.length) return [];
  const out = o.taxIncl ? tl.map(([n, v]) => `Includes ${n}${sep}${rs2(v)}`) : [`Taxable value${sep}${rs2(M.sub(o) - M.disc(o) + M.charges(o))}`, ...tl.map(([n, v]) => `${n}${sep}${rs2(v)}`)];
  const ro = Math.round((M.total(o) - (M.sub(o) - M.disc(o) + M.charges(o) + (o.taxIncl ? 0 : M.taxOf(o).tax))) * 100) / 100;
  if (Math.abs(ro) >= 0.01) out.push(`Round off${sep}${ro > 0 ? "+" : "−"}${rs2(Math.abs(ro))}`);
  return out;
}
const taxId = o => { const t = M.taxCfg(); return t.gstin && M.taxLines(o).length ? `${t.name}IN: ${t.gstin}\n` : ""; };
export function billText(o) {
  const L = billLines(o); const gross = L.reduce((s, l) => s + l.list * l.qty, 0); const payable = M.total(o); const discount = Math.max(0, gross - (M.sub(o) - M.disc(o)));
  let t = `${M.config().business} – Bill summary\n${taxId(o)}${o.customer}${o.flat ? " · " + o.flat : ""}\n${dLong(o.date)}\n\n`;
  L.forEach(l => t += `${l.item} × ${l.qty} @ ${rs(l.list)} = ${rs(l.list * l.qty)}\n`);
  return t + `\nTotal: ${rs(gross)}\nDiscount: ${discount > 0 ? "−" + rs(discount) : rs(0)}${o.coupon ? ` (coupon ${o.coupon})` : ""}\n${(o.charges || []).map(c => `${c.name}: ${rs(c.amount)}\n`).join("")}${taxBlock(o).map(x => x + "\n").join("")}Total payable: ${rs(payable)}`;
}
const billChanged = o => o.billSentAt && o.billTotal != null && +o.billTotal !== M.total(o);
const billWhen = o => new Date(o.billSentAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
export function billTag(o) { if (!o.billSentAt || !R.can("money")) return ""; return billChanged(o) ? `<span class="tag t-part">Bill sent · order changed</span>` : `<span class="tag t-paid">${ICON.check}Bill sent</span>`; }
function billSheet(id, failed) {
  const o = getOrder(id); if (!o) { closeSheet(); return; }
  const text = billText(o);
  openSheet({ kind: "bill", id, redraw: () => billSheet(id, failed) }, `<div class="sh-head">${plate(o.flat)}<h2 class="h">Bill summary</h2><button class="x" data-close aria-label="Close">×</button></div>
  <div class="subl" style="margin:-4px 0 10px">${esc(o.customer)} · Order ${noLabel(o)} · ${o.billSentAt ? (billChanged(o) ? `<span class="tag t-part">Sent ${esc(billWhen(o))}, order changed since</span>` : `<span class="tag t-paid">${ICON.check}Bill summary sent ${esc(billWhen(o))}</span>`) : `<span class="tag t-due">Not sent yet</span>`}</div>
  ${failed ? `<textarea class="in billbox" id="billText" readonly>${esc(text)}</textarea><p class="hint">This phone blocked automatic copying. Select the text, copy it, then tap the button below.</p>
  <button class="btn btn-ok" data-act="markBillSent">I’ve copied it – mark as sent</button>` : `<pre class="billbox">${esc(text)}</pre>
  <button class="btn btn-primary" data-act="copyBill">${o.billSentAt ? "Copy again" : "Copy message"}</button>`}
  <button class="btn btn-ghost" data-act="billBack">Back to order</button>`);
  if (failed) { const t = document.getElementById("billText"); if (t) { t.focus(); t.select(); } }
}
async function markBillSent(o) { await saveOrder({ ...o, billSentAt: new Date().toISOString(), billTotal: M.total(o) }); }
A.billSummary = () => { const o = sheetOrder(); if (o && guard("money")) billSheet(o.id); };
A.copyBill = async () => { const o = getOrder(ui.sheet.id); if (await copyText(billText(o))) { await markBillSent(o); billSheet(o.id); toast("Copied · marked as bill summary sent"); } else billSheet(o.id, true); };
A.markBillSent = async () => { const o = getOrder(ui.sheet.id); await markBillSent(o); billSheet(o.id); toast("Marked as bill summary sent"); };
A.billBack = () => openOrder(ui.sheet.id);

/* ---------- Today ---------- */
V.today = () => {
  S.filter.today = S.filter.today || "todo";
  const c = M.config(); const money = R.can("money");
  const day = M.sortFlat(M.orders(false).filter(o => o.date === S.date));
  const done = day.filter(M.isDelivered).length;
  const value = day.reduce((s, o) => s + M.total(o), 0), coll = day.reduce((s, o) => s + Math.min(M.received(o), M.total(o)), 0);
  const pieces = day.reduce((s, o) => s + M.pcs(o), 0);
  const t = today(); const set = new Set([addDays(t, -1), t, addDays(t, 1), addDays(t, 2), S.date]);
  const counts = {}; M.orders(false).forEach(o => { counts[o.date] = (counts[o.date] || 0) + 1; if (o.date >= addDays(t, -14)) set.add(o.date); });
  const toBake = M.board(S.date).reduce((s, r) => s + r.toBake, 0);
  let h = `<header class="band"><div class="top">${logoHtml(c)}<div class="biz"><div class="name">${esc(c.business)}</div><div class="sub">${esc(c.activeTag ? c.activeTag + " running" : c.tagline || "")}</div></div>${H.lowBadge ? H.lowBadge() : ""}</div>
  <div class="stats"><div class="st"><b>${done}/${day.length}</b><span>delivered</span><div class="bar"><i style="width:${day.length ? done / day.length * 100 : 0}%"></i></div></div>
  <div class="st"><b>${pieces}</b><span>pieces${toBake ? ` · ${toBake} to bake` : ""}</span></div>${money ? `<div class="st"><b>${rs(value)}</b><span>${rs(coll)} collected</span></div>` : ""}</div></header>
  <div class="strip"><div class="days" id="days">${[...set].sort().map(d => { const x = dObj(d); return `<button class="day" data-day="${d}" aria-pressed="${d === S.date}"><small>${d === t ? "Today" : x.toLocaleDateString("en-IN", { weekday: "short" })}</small><b>${x.getDate()}</b><i>${counts[d] ? counts[d] + " ord" : x.toLocaleDateString("en-IN", { month: "short" })}</i></button>`; }).join("")}
  <label class="day pick">Pick date<input type="date" data-pickday value="${S.date}" aria-label="Pick a date"></label></div>${toran()}</div>
  ${H.backupBanner && H.backupBanner() ? `<div class="boardfoot" style="padding-bottom:0">${H.backupBanner()}</div>` : ""}<div class="quick"><button class="qbtn" data-go="bake">${ICON.oven}<span>Bake board<small>${toBake ? toBake + " pcs to bake" : "Up to date"}</small></span></button><button class="qbtn" data-go="run">${ICON.run}<span>Delivery run<small>${day.filter(o => M.PREORDER.includes(o.channel) && !M.isDelivered(o)).length} to deliver</small></span></button></div>`;
  const rows = day.filter(o => matchQ("today", o)).filter(o => S.filter.today === "all" || (S.filter.today === "done" ? M.isDelivered(o) : !M.isDelivered(o)));
  h += `<div class="tools">${searchBox("today", "Search name, flat or phone")}${layoutSwitch("today")}${chipBar("today", [["todo", "To deliver", day.length - done], ["done", "Delivered", done], ["all", "All", day.length]])}</div>`;
  if (!day.length) h += `<div class="empty"><strong>No orders for ${esc(dLong(S.date))}</strong>Tap New order to take one for this day.</div>`;
  else if (!rows.length) h += `<div class="empty"><strong>${S.filter.today === "todo" && !S.query.today ? "All delivered" : "Nothing matches"}</strong>${S.filter.today === "todo" && !S.query.today ? "Every order for this day is done." : "Try another name or filter."}</div>`;
  else if (asLines("today")) { const money = R.can("money");
    h += `<div class="card tablecard"><table class="reg"><thead><tr><th>Flat</th><th>Customer</th><th>Items</th><th class="r">Pcs</th>${money ? `<th class="r">Total</th><th>Payment</th>` : ""}<th>Status</th><th>Delivered</th></tr></thead><tbody>${rows.map(o => { const d = M.isDelivered(o);
      return `<tr${d ? ' class="done"' : ""}><td>${esc(o.flat || "")}</td><td><button class="linkbtn" data-open="${esc(o.id)}"><b>${esc(o.customer || M.CHANNELS[o.channel])}</b></button> ${chanTag(o)}</td><td class="items">${o.items.map(i => esc(i.item) + " ×" + i.qty).join(", ")}</td><td class="r">${M.pcs(o)}</td>${money ? `<td class="r">${rs(M.total(o))}</td><td>${payTag(o)} ${billTag(o)}</td>` : ""}<td>${statusTag(o)}</td><td><button class="tick sm" data-deliver="${esc(o.id)}" aria-pressed="${d}" aria-label="${d ? "Delivered" : "Mark delivered"}: ${esc(o.customer)}">${ICON.check}</button></td></tr>`; }).join("")}</tbody></table></div>`; }
  else h += `<ul class="list">${rows.map(o => orderRow(o, true)).join("")}</ul>`;
  return h;
};
export function orderRow(o, withTick) {
  const d = M.isDelivered(o); const money = R.can("money");
  return `<li class="row${d ? " done" : ""}">${plate(o.flat)}
    <button class="who" data-open="${esc(o.id)}"><div class="nm">${esc(o.customer || M.CHANNELS[o.channel])}</div><div class="pills">${o.items.map(i => `<span class="pill">${esc(i.item)}<b>×${i.qty}</b></span>`).join("")}</div>
    <div class="subl">${money ? rs(M.total(o)) + " " + payTag(o) : ""} ${billTag(o)} ${chanTag(o)} ${preTags(o)} ${!d && o.status !== "received" ? `<span class="tag t-camp">${esc(M.STATUS_LABEL[o.status])}</span>` : ""}</div></button>
    ${withTick ? `<button class="tick" data-deliver="${esc(o.id)}" aria-pressed="${d}" aria-label="${d ? "Delivered" : "Mark delivered"}: ${esc(o.customer)}">${ICON.check}</button>` : (money ? `<div class="amt">${rs(M.total(o))}</div>` : "")}</li>`;
}

/* ---------- Orders list ---------- */
V.orders = () => {
  S.filter.orders = S.filter.orders || "upcoming";
  const t = today(); const all = M.orders(); const tags = [...new Set(all.map(o => o.tag).filter(Boolean))];
  const g = { upcoming: o => o.date >= t && o.status !== "cancelled", past: o => o.date < t && o.status !== "cancelled", cancelled: o => o.status === "cancelled", all: () => true };
  const tagF = S.filter.ordersTag || "", chanF = S.filter.ordersChan || "";
  const group = all.filter(g[S.filter.orders]); const ck = Object.keys(M.CHANNELS);
  const chans = [...new Set(all.map(o => o.channel))].sort((a, b) => ck.indexOf(a) - ck.indexOf(b));
  const list = group.filter(o => !tagF || o.tag === tagF).filter(o => !chanF || o.channel === chanF).filter(o => matchQ("orders", o))
    .sort((a, b) => S.filter.orders === "past" ? (a.date < b.date ? 1 : a.date > b.date ? -1 : cmpFlat(a, b)) : (a.date < b.date ? -1 : a.date > b.date ? 1 : cmpFlat(a, b)));
  let h = band("Orders", `${R.can("orders.edit") ? `<button class="pillbtn" data-go="quotes">Quotations${H.quoteCount && H.quoteCount() ? ` <em class="pillnum">${H.quoteCount()}</em>` : ""}</button><button class="pillbtn" data-go="standing">Standing orders</button>` : ""}${R.can("export") ? `<button class="pillbtn" data-act="export">${ICON.dl}Excel</button>` : ""}`);
  h += `<div class="tools">${searchBox("orders", "Search name, flat, phone or #")}${layoutSwitch("orders")}${chipBar("orders", [["upcoming", "Upcoming", all.filter(g.upcoming).length], ["past", "Past", all.filter(g.past).length], ["cancelled", "Cancelled", all.filter(g.cancelled).length], ["all", "All", all.length]])}</div>`;
  if (chans.length > 1) h += `<div class="tools" style="padding-top:2px"><div class="chips scroll"><button class="chip" data-chanf="" aria-pressed="${!chanF}">All channels</button>${chans.map(k => `<button class="chip" data-chanf="${esc(k)}" aria-pressed="${chanF === k}">${esc(M.CHANNELS[k] || k)}<span class="n">${group.filter(o => o.channel === k).length}</span></button>`).join("")}</div></div>`;
  if (tags.length) h += `<div class="tools" style="padding-top:2px"><div class="chips"><button class="chip" data-tagf="" aria-pressed="${!tagF}">All occasions</button>${tags.map(x => `<button class="chip" data-tagf="${esc(x)}" aria-pressed="${tagF === x}">${esc(x)}</button>`).join("")}</div></div>`;
  if (!list.length) return h + `<div class="empty"><strong>No orders here</strong>${all.length ? "Try another filter or search." : "Tap New order to take your first one."}</div>`;
  if (asLines("orders")) return h + ordersTable(list);
  let cur = ""; h += "<div>";
  list.forEach(o => {
    if (o.date !== cur) { if (cur) h += "</ul>"; cur = o.date; const d = list.filter(x => x.date === cur); h += `<div class="sect">${esc(dLong(cur))}${cur === t ? " · Today" : ""}<span>${d.length} orders${R.can("money") ? " · " + rs(d.reduce((s, x) => s + M.total(x), 0)) : ""}</span></div><ul class="list" style="padding-top:0">`; }
    h += orderRow(o, false);
  });
  return h + "</ul></div>";
};

// Desktop register: one row per order, every channel, with totals for what is shown.
const statusTag = o => o.status === "cancelled" ? `<span class="tag t-due">Cancelled</span>` : o.status === "delivered" ? `<span class="tag t-paid">${ICON.check}Delivered</span>` : `<span class="tag t-camp">${esc(M.STATUS_LABEL[o.status] || o.status)}</span>`;
function ordersTable(list) {
  const money = R.can("money"); const live = list.filter(o => o.status !== "cancelled");
  return `<div class="card tablecard"><table class="reg"><thead><tr><th>#</th><th>Date</th><th>Customer</th><th>Channel</th><th>Items</th><th class="r">Pcs</th>${money ? `<th class="r">Total</th><th class="r">Due</th><th>Payment</th>` : ""}<th>Status</th></tr></thead>
  <tbody>${list.map(o => `<tr data-open="${esc(o.id)}" tabindex="0"><td>${noLabel(o)}</td><td data-v="${esc(o.date)}">${esc(dLong(o.date))}</td><td><b>${esc(o.customer || M.CHANNELS[o.channel])}</b>${o.flat ? ` <small class="mut">${esc(o.flat)}</small>` : ""}${o.tag ? ` <span class="tag t-camp">${esc(o.tag)}</span>` : ""}</td><td>${esc(M.chanLabel(o))}</td>
    <td class="items">${o.items.map(i => esc(i.item) + " ×" + i.qty).join(", ")}</td><td class="r">${M.pcs(o)}</td>${money ? `<td class="r">${rs(M.total(o))}</td><td class="r">${M.bal(o) ? `<span class="due">${rs(M.bal(o))}</span>` : "–"}</td><td>${o.status === "cancelled" ? "" : payTag(o)} ${billTag(o)}</td>` : ""}<td>${statusTag(o)}</td></tr>`).join("")}</tbody>
  <tfoot><tr><td colspan="5">${list.length} order${list.length === 1 ? "" : "s"}${live.length < list.length ? ` · ${list.length - live.length} cancelled` : ""}</td><td class="r">${live.reduce((s, o) => s + M.pcs(o), 0)}</td>${money ? `<td class="r">${rs(live.reduce((s, o) => s + M.total(o), 0))}</td><td class="r">${rs(live.reduce((s, o) => s + M.bal(o), 0))}</td><td></td>` : ""}<td></td></tr></tfoot></table></div>`;
}

/* ---------- delivery confirm (shared with the run) ---------- */
export async function confirmDeliver(o, withCollect = false) {
  const v = !M.isDelivered(o); const b = M.bal(o);
  const head = `${plate(o.flat)}<p class="cq">${v ? "Mark as delivered?" : "Undo delivery?"}</p><div class="cname">${esc(o.customer)}</div><div class="cdetail">${o.items.map(i => esc(i.item) + " × " + i.qty).join(", ")}<br>${esc(dLong(o.date))}${R.can("money") ? " · " + rs(M.total(o)) + (b > 0 ? ` · <b>${rs(b)} due</b>` : " · paid") : ""}</div>`;
  let choice;
  if (!v) choice = await ask(head, [{ label: "Keep delivered", cls: "btn-ghost", value: false }, { label: "Undo", cls: "btn-danger-solid", value: "undo" }], true);
  else if (withCollect && b > 0 && R.can("collect")) choice = await ask(head, [{ label: "Delivered, not paid yet", cls: "btn-primary", value: "nopay" }, { label: "Delivered + paid by UPI", cls: "btn-ok", value: "UPI" }, { label: "Delivered + paid in cash", cls: "btn-ok", value: "Cash" }, { label: "Cancel", cls: "btn-danger", value: null }]);
  else choice = await ask(head, [{ label: "Cancel", cls: "btn-ghost", value: false }, { label: "Yes, delivered", cls: "btn-ok", value: "yes" }], true);
  if (!choice) return false;
  await saveOrder({ ...o, status: v ? "delivered" : "ready", deliveredAt: v ? new Date().toISOString() : "" });
  if (choice === "UPI" || choice === "Cash") await payOrders([o], choice);
  toast(v ? `${o.customer || "Order"} delivered${choice === "UPI" || choice === "Cash" ? " and paid" : ""}` : "Delivery undone"); return true;
}

/* ---------- order detail ---------- */
const getOrder = id => { const o = ev.get("orders", id); return o ? M.normOrder(o) : null; };
H.openOrder = id => openOrder(id);
export function openOrder(id) {
  const o = getOrder(id); if (!o) { closeSheet(); return; }
  const s = M.payState(o); const money = R.can("money"); const edit = R.can("orders.edit"); const cancelled = o.status === "cancelled";
  const steps = M.STATUSES.map(st => `<button class="step${o.status === st ? " on" : ""}${M.STATUSES.indexOf(st) < M.STATUSES.indexOf(o.status) ? " past" : ""}" data-status="${st}" ${edit && !cancelled ? "" : "disabled"}>${esc(M.STATUS_LABEL[st])}</button>`).join("");
  openSheet({ kind: "order", id, redraw: () => openOrder(id) }, `<div class="sh-head">${plate(o.flat)}<h2 class="h">${esc(o.customer || M.CHANNELS[o.channel])}</h2><button class="x" data-close aria-label="Close">×</button></div>${L.banner("orders", id)}
  <div class="subl" style="margin:-4px 0 10px">Order ${noLabel(o)} · ${esc(dLong(o.date))} · ${esc(M.chanLabel(o))}${o.phone && R.can("phone") ? " · " + esc(o.phone) : ""}${o.tag ? ` · <span class="tag t-camp">${esc(o.tag)}</span>` : ""}</div>
  ${cancelled ? `<div class="banner bad">Cancelled${o.cancelReason ? ": " + esc(o.cancelReason) : ""}</div>` : `<div class="steps" role="group" aria-label="Order status">${steps}</div>`}
  <div class="kv">${o.items.map(i => `<div><span>${esc(i.item)} × ${i.qty}${money ? ` <small class="mut">@ ${rs(i.rate)}</small>` : ""}</span>${money ? `<span>${rs(i.qty * i.rate)}</span>` : ""}</div>`).join("")}
  ${money && M.disc(o) ? `<div><span>${esc(M.offerText(o))}</span><span>−${rs(M.disc(o))}</span></div>` : ""}${money ? (o.charges || []).map(c => `<div><span>${esc(c.name)}</span><span>${rs(c.amount)}</span></div>`).join("") : ""}${money ? taxBlock(o, "|").map(x => { const [a, b] = x.split("|"); return `<div><span class="mut">${esc(a)}</span><span class="mut">${esc(b)}</span></div>`; }).join("") : ""}${money ? `<div class="tot"><span>Total</span><span>${rs(M.total(o))}</span></div>` : ""}</div>
  ${o.slot || o.cakeMsg || o.weight || o.flavour || o.advance ? `<div class="kv" style="margin-top:8px">${o.slot ? `<div><span>Delivery time</span><b>${esc(o.slot)}</b></div>` : ""}${o.cakeMsg ? `<div><span>Message on the cake</span><b>“${esc(o.cakeMsg)}”</b></div>` : ""}${o.weight ? `<div><span>Weight / size</span><b>${esc(o.weight)}</b></div>` : ""}${o.flavour ? `<div><span>Flavour / theme</span><b>${esc(o.flavour)}</b></div>` : ""}${o.advance ? `<div><span>Advance</span><b>${rs(o.advance)}${advanceDue(o) ? ` · <span class="due">${rs(advanceDue(o))} still due</span>` : " · received"}</b></div>` : ""}</div>` : ""}
  ${o.notes ? `<p class="hint">Note: ${esc(o.notes)}</p>` : ""}
  ${cancelled ? "" : `<div class="statusrow"><button class="sbox ${M.isDelivered(o) ? "on" : "off"}" data-act="toggleDeliver" ${R.can("deliver") ? "" : "disabled"}><small>Delivery</small><b>${M.isDelivered(o) ? "Delivered ✓" : "Not delivered"}</b><em>${R.can("deliver") ? "Tap to " + (M.isDelivered(o) ? "undo" : "mark delivered") : ""}</em></button>
  ${money ? `<button class="sbox ${s === "paid" ? "on" : "off"}" data-act="${s === "paid" ? "unpay" : "payOrder"}" ${R.can("pay.record") || R.can("collect") ? "" : "disabled"}><small>Payment</small><b>${s === "paid" ? "Paid ✓" : s === "part" ? rs(M.bal(o)) + " due" : "Unpaid"}</b><em>${s === "paid" ? (M.lastPayMode(o) ? M.lastPayMode(o) + " · " : "") + "tap to undo" : "Tap to record payment"}</em></button>` : ""}</div>`}
  ${money ? `<div class="btnrow"><button class="btn btn-ghost" data-invoice="${esc(o.id)}">${ICON.print}${o.invoiceNo ? "Invoice " + esc(o.invoiceNo) : M.taxCfg().on && M.taxCfg().gstin ? "Tax invoice" : "Invoice"}</button><button class="btn btn-ghost" data-receipt="${esc(o.id)}">${ICON.print}Receipt</button></div>` : ""}
  ${H.orderExtras ? H.orderExtras(o) : ""}
  ${money && !cancelled ? `<button class="btn btn-primary" data-act="billSummary">Bill summary${o.billSentAt ? " · " + (billChanged(o) ? "order changed since sent" : "sent " + esc(billWhen(o))) : ""}</button>` : ""}
  ${money && cancelled && M.received(o) > 0.005 ? `<div class="banner warn">${rs(M.received(o))} was paid on this cancelled order. ${R.can("pay.reverse") ? `<button class="linkbtn" data-act="refundOrder">Refund / reverse it</button>` : "Ask an admin to refund it."}</div>` : ""}
  ${money && !cancelled && M.received(o) - M.total(o) > 0.5 ? `<div class="banner warn">${rs(M.received(o) - M.total(o))} paid above the total. ${R.can("pay.reverse") ? `<button class="linkbtn" data-act="refundExtra">Refund the extra</button>` : ""}${R.can("pay.record") && o.channel !== "walkin" ? ` · <button class="linkbtn" data-act="extraToCredit">Keep as credit</button>` : ""}</div>` : ""}
  ${R.can("phone") && !cancelled ? `<div class="btnrow"><a class="btn btn-wa" data-wa href="${esc(waHref(o.phone, orderText(o)))}" target="_blank" rel="noopener">${ICON.wa}Send order</a><button class="btn btn-ghost" data-act="copyOrder">Copy message</button></div>` : ""}
  ${edit ? `<div class="btnrow"><button class="btn btn-ghost" data-act="editOrder" ${cancelled ? "disabled" : ""}>Edit</button><button class="btn btn-ghost" data-act="repeatOrder">Repeat order</button></div>` : ""}
  ${R.can("history") ? `<button class="btn btn-ghost" data-act="orderHistory">History of changes</button>` : ""}
  ${R.can("orders.cancel") && !cancelled ? `<button class="btn btn-danger" data-act="cancelOrder">Cancel order</button>` : ""}
  ${R.can("orders.cancel") && cancelled ? `<button class="btn btn-ghost" data-act="restoreOrder">Restore order</button>` : ""}
  ${R.isAdmin() ? `<button class="btn btn-danger" data-act="deleteOrder">Delete permanently</button>` : ""}`);
}
const sheetOrder = () => getOrder(ui.sheet && ui.sheet.id);
A.toggleDeliver = async () => { const o = sheetOrder(); if (o && guard("deliver") && await confirmDeliver(o, true)) openOrder(o.id); };
A.payOrder = () => { const o = sheetOrder(); if (o && H.confirmPay) H.confirmPay(M.customers().find(c => c.key === M.ckey(o)) || { key: M.ckey(o), customer: o.customer, flat: o.flat, orders: [o], balance: M.bal(o) }, o); };
A.unpay = async () => { const o = sheetOrder(); if (!o || !guard("pay.reverse")) return;
  if (await yesNo(`${plate(o.flat)}<p class="cq">Mark as not paid?</p><div class="cname">${esc(o.customer)}</div><div class="cdetail">This adds a reversal for the ${rs(M.received(o))} recorded. The original entry stays in the history.</div>`, "Reverse payment", "btn-danger-solid", "Keep as paid")) { await reversePayments(o); openOrder(o.id); toast("Payment reversed"); } };
A.copyOrder = async () => { const o = sheetOrder(); toast(await copyText(orderText(o)) ? "Message copied. Paste it in WhatsApp." : "Couldn’t copy here"); };
A.editOrder = () => guard("orders.edit") && compose(sheetOrder());
A.repeatOrder = () => guard("orders.edit") && compose(sheetOrder(), { repeat: true });
A.cancelOrder = async () => { const o = sheetOrder(); if (!guard("orders.cancel")) return;
  const v = await ask(`${plate(o.flat)}<p class="cq">Cancel this order?</p><div class="cname">${esc(o.customer)} · ${esc(dLong(o.date))}</div><input class="in" id="cxReason" placeholder="Reason (optional)" style="margin-top:12px">${M.received(o) > 0 ? (R.can("pay.reverse") ? `<label class="chkline"><input type="checkbox" id="cxRefund" checked> Refund the ${rs(M.received(o))} paid</label>` : `<div class="cdetail">${rs(M.received(o))} was paid; ask an admin to refund it.</div>`) : ""}`, [{ label: "Keep order", cls: "btn-ghost", value: false }, { label: "Cancel order", cls: "btn-danger-solid", value: true }], true);
  if (v) { const refund = ($("#cxRefund") || {}).checked; if (refund && H.approve && !await H.approve("refund", M.received(o), `Refund on order ${o.no}`)) return; await saveOrder({ ...o, status: "cancelled", cancelReason: ($("#cxReason") || {}).value || "" }); if (refund && R.can("pay.reverse")) await reversePayments(o); openOrder(o.id); toast(refund ? "Order cancelled and payment refunded" : "Order cancelled"); } };
A.restoreOrder = async () => { const o = sheetOrder(); if (guard("orders.cancel")) { await saveOrder({ ...o, status: "received", cancelReason: "" }); openOrder(o.id); toast("Order restored"); } };
A.refundOrder = async () => { const o = sheetOrder(); if (!o || !guard("pay.reverse")) return; if (H.approve && !await H.approve("refund", M.received(o), `Refund on order ${o.no}`)) return;
  if (await yesNo(`<p class="cq">Refund ${rs(M.received(o))}?</p><div class="cdetail">Reversal entries are added for the payments on this order (same mode). Hand the money back to ${esc(o.customer || "the customer")}.</div>`, "Refund", "btn-danger-solid")) { await reversePayments(o); openOrder(o.id); toast("Refund recorded"); } };
A.refundExtra = async () => { const o = sheetOrder(); if (!o || !guard("pay.reverse")) return; const extra = Math.round((M.received(o) - M.total(o)) * 100) / 100; if (H.approve && !await H.approve("refund", extra, `Refund on order ${o.no}`)) return;
  if (extra > 0 && await yesNo(`<p class="cq">Refund ${rs(extra)}?</p><div class="cdetail">The order total is ${rs(M.total(o))}; ${rs(M.received(o))} was received.</div>`, "Refund", "btn-danger-solid")) { await addPayment(o, -extra, M.lastPayMode(o), "Refund of extra"); openOrder(o.id); toast("Refund recorded"); } };
A.extraToCredit = async () => { const o = sheetOrder(); if (!o || !guard("pay.record")) return; const extra = Math.round((M.received(o) - M.total(o)) * 100) / 100; if (!(extra > 0)) return;
  await addPayment(o, -extra, "Credit", "Moved to customer credit"); await addCredit({ key: M.ckey(o), customer: o.customer, flat: o.flat }, extra, "Credit", `Extra paid on #${o.no}`); openOrder(o.id); toast(`${rs(extra)} kept as credit for ${o.customer}`); };
A.deleteOrder = async () => { const o = sheetOrder(); if (!R.isAdmin()) return;
  if (M.received(o) > 0.005) { toast(`${rs(M.received(o))} was received on this order. Refund it first, or cancel the order instead.`); return; }
  if (await yesNo(`<p class="cq">Delete permanently?</p><div class="cname">${esc(o.customer)} · ${esc(dLong(o.date))}</div><div class="cdetail">Use Cancel for normal cases. Deleting removes it from every list and report; only its history remains.</div>`, "Delete", "btn-danger-solid", "Keep")) { await ev.del("orders", o.id); closeSheet(); toast("Order deleted"); } };
A.orderHistory = () => { const o = sheetOrder(); historySheet("orders", o.id, `${o.customer} · ${noLabel(o)}`, () => openOrder(o.id)); };

export function historySheet(kind, id, title, back) {
  const evs = ev.history(kind, id); const pays = kind === "orders" ? M.paymentsFor(id) : [];
  const who = by => { const m = ev.get("members", by); return m ? m.name : (by || "Unknown"); };
  const rows = [];
  let prev = null;
  evs.forEach(e => {
    let what = "";
    if (e.op === "del") what = "Deleted";
    else if (!prev) what = "Created";
    else if (kind === "bakes") { const ch = []; const d = e.data, p = prev.data || {};
      if (JSON.stringify(d.lines) !== JSON.stringify(p.lines)) ch.push("pieces or spoiled changed");
      if ((d.notes || "") !== (p.notes || "")) ch.push(`note → ${d.notes || "blank"}`);
      if (d.void && !p.void) ch.push("batch undone");
      what = ch.join("; ") || "Saved with no visible change"; }
    else { const ch = []; const d = e.data, p = prev.data || {};
      if (d.status !== p.status) ch.push(`status → ${M.STATUS_LABEL[d.status] || d.status}`);
      if (JSON.stringify(d.items) !== JSON.stringify(p.items)) ch.push("items or prices changed");
      if (d.billSentAt && d.billSentAt !== p.billSentAt) ch.push("bill summary sent");
      ["customer", "flat", "phone", "date", "discountPct", "notes", "tag", "channel"].forEach(k => { if ((d[k] ?? "") !== (p[k] ?? "")) ch.push(`${k === "discountPct" ? "offer" : k} → ${d[k] || "blank"}`); });
      what = ch.join("; ") || "Saved with no visible change"; }
    rows.push({ at: e.at, by: who(e.by), what }); prev = e;
  });
  pays.forEach(p => rows.push({ at: p._at, by: who(p._by), what: p.amount < 0 ? `Payment reversed ${rs(-p.amount)}` : `Payment ${rs(p.amount)}${p.mode ? " by " + p.mode : ""}` }));
  rows.sort((a, b) => a.at < b.at ? 1 : -1);
  openSheet({ kind: "history" }, `<div class="sh-head"><h2 class="h">History</h2><button class="x" data-close aria-label="Close">×</button></div><p class="hint" style="margin-top:-6px">${esc(title)}</p>
  <div class="kv">${rows.map(r => `<div><span><b>${esc(r.what)}</b><small class="mut" style="display:block">${esc(r.by)}</small></span><small class="mut">${new Date(r.at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</small></div>`).join("") || "<div>No history</div>"}</div>
  ${back ? `<button class="btn btn-ghost" data-act="histBack">Back</button>` : ""}`);
  ui.sheet.back = back;
}
A.histBack = () => ui.sheet && ui.sheet.back && ui.sheet.back();

H.click.push(async (T) => {
  const st = T.closest("[data-status]"); if (st && ui.sheet && ui.sheet.kind === "order") { const o = sheetOrder(); if (!guard("orders.edit")) return true;
    if (st.dataset.status === "delivered") { if (await confirmDeliver(o, true)) openOrder(o.id); return true; }
    await saveOrder({ ...o, status: st.dataset.status }); openOrder(o.id); toast(M.STATUS_LABEL[st.dataset.status]); return true; }
  return false;
});

/* ---------- composer ---------- */
export async function compose(o, opts = {}) {
  if (!guard("orders.edit")) return;
  let lk = {}; if (o && !opts.repeat && o.id) { lk = await L.open("orders", o.id, `order #${o.no}`); if (!lk) return; }
  const c = M.config(); const me = R.me();
  const base = o ? JSON.parse(JSON.stringify(o)) : { id: uid("o"), no: "", customer: opts.customer || "", flat: opts.flat || "", phone: opts.phone || "", channel: opts.channel || "whatsapp", date: opts.date || (S.view === "today" ? S.date : today()), items: opts.items || [], discountPct: 0, status: "received", notes: opts.notes || "", tag: c.activeTag || "", createdAt: new Date().toISOString() };
  if (o && opts.repeat) { Object.assign(base, { id: uid("o"), no: "", date: today(), status: "received", deliveredAt: "", cancelReason: "", createdAt: new Date().toISOString(), tag: c.activeTag || "" });
    // A repeat is a new order: no bill sent yet, today's tax rates and prices-include-tax setting, this device's location.
    ["billSentAt", "billTotal", "taxIncl", "outletId"].forEach(k => delete base[k]); base.items = base.items.map(({ taxPct, list, ...i }) => i); }
  const st = { ...lk, kind: "compose", o: base, isNew: opts.isNew != null ? opts.isNew : !o || !!opts.repeat, dirty: !!opts.repeat || !!(opts.items && opts.items.length), cat: "", sugg: false, prefix: R.numPrefix(), quote: !!opts.quote, standing: !!opts.standing, fromQuote: opts.fromQuote || "" };
  st.redraw = () => drawCompose(st); drawCompose(st);
}
// Pre-orders carry a delivery window (or exact time), a cake message, weight and flavour, and an advance to collect.
export const SLOTS = ["Morning 8–11", "Afternoon 12–4", "Evening 5–9"];
export const advanceDue = o => o.advance > 0 && o.status !== "cancelled" ? Math.max(0, o.advance - M.received(o)) : 0;
export const preTags = o => `${o.slot ? `<span class="tag t-camp">🕒 ${esc(o.slot)}</span>` : ""}${o.cakeMsg || o.weight || o.flavour ? ` <span class="tag t-part">🎂 ${esc([o.weight, o.flavour].filter(Boolean).join(" · ") || "custom")}</span>` : ""}${advanceDue(o) ? ` <span class="tag t-due">advance ${rs(advanceDue(o))} due</span>` : ""}`;
function drawCompose(st) {
  const o = st.o; const sc = $(".comp-scroll") ? $(".comp-scroll").scrollTop : 0;
  const a = document.activeElement; const fid = a && a.id; const fpos = fid && a.selectionStart;
  const t = today(); const qOf = id => o.items.filter(i => i.menuId === id).reduce((s, i) => s + i.qty, 0);
  const mm = M.menuActive(); const cats = [...new Set(mm.map(m => m.category).filter(Boolean))]; const shown = mm.filter(m => !st.cat || m.category === st.cat);
  const q = o.customer.trim().toLowerCase();
  const sugg = st.sugg && q ? M.customers().filter(c => (c.customer + " " + c.flat + " " + c.phone).toLowerCase().includes(q) && !(c.customer === o.customer && c.flat === o.flat)).slice(0, 5) : [];
  const c = M.config(); const three = [t, addDays(t, 1), addDays(t, 2)]; const prices = R.can("prices") || R.can("orders.edit");
  openSheet(st, `<div class="sh-head"><h2 class="h">${st.quote ? (st.isNew ? "New quotation" : "Edit quotation " + esc(o.no || "")) : st.standing ? (st.isNew ? "New standing order" : "Edit standing order " + esc(o.no || "")) : st.isNew ? "New order" : "Edit order " + noLabel(o)}</h2><button class="x" data-close aria-label="Close">×</button></div>
  <div class="comp-scroll">
    <label class="f" for="cName">Customer</label><input class="in" id="cName" value="${esc(o.customer)}" placeholder="Name" autocomplete="off">
    ${sugg.length ? `<div class="sugg">${sugg.map(c => `<button data-pickcust="${esc(c.key)}"><b>${esc(c.customer)}</b> ${esc(c.flat)}<small>${c.orders.length} past order${c.orders.length > 1 ? "s" : ""}</small></button>`).join("")}</div>` : ""}
    <div class="two"><div><label class="f" for="cFlat">Flat / address</label><input class="in" id="cFlat" value="${esc(o.flat)}" placeholder="e.g. A-1301" autocomplete="off"></div>
    <div><label class="f" for="cPhone">Phone</label><input class="in" id="cPhone" value="${esc(o.phone)}" placeholder="10-digit mobile" inputmode="tel" autocomplete="off"></div></div>
    <label class="f">Channel</label><div class="chips">${M.PREORDER.map(k => `<button class="chip" data-chan="${k}" aria-pressed="${o.channel === k}">${M.CHANNELS[k]}</button>`).join("")}</div>
    ${st.standing && H.standingFields ? H.standingFields(o) : ""}
    <label class="f"${st.standing ? ' hidden' : ""}>${st.quote ? "Delivery date asked for" : "Delivery date"}</label><div class="datechips"${st.standing ? ' hidden' : ""}>
      ${three.map((d, i) => `<button class="chip" data-cdate="${d}" aria-pressed="${o.date === d}">${i === 0 ? "Today" : i === 1 ? "Tomorrow" : esc(dObj(d).toLocaleDateString("en-IN", { weekday: "short", day: "numeric" }))}</button>`).join("")}
      <label class="chip" aria-pressed="${!three.includes(o.date)}">${!three.includes(o.date) ? esc(dLong(o.date)) : "Other date"}<input type="date" id="cDate" value="${o.date}" aria-label="Other date"></label></div>
    <label class="f">Tap items to add</label>
    ${cats.length > 1 ? `<div class="chips" style="margin-bottom:4px"><button class="chip" data-cat="" aria-pressed="${!st.cat}">All</button>${cats.map(x => `<button class="chip" data-cat="${esc(x)}" aria-pressed="${st.cat === x}">${esc(x)}</button>`).join("")}</div>` : ""}
    <div class="grid">${shown.map(m => { const n = qOf(m.id); return `<button class="tile${n ? " sel" : ""}" data-addm="${esc(m.id)}"><span class="tn">${esc(m.name)}</span><span class="tp">${rs(m.price)}</span>${n ? `<span class="q">${n}</span>` : ""}</button>`; }).join("")}
      <button class="tile add" data-act="customItem">+ Other item</button></div>
    ${!mm.length ? `<p class="hint">The menu is empty. Add items in More → Menu, prices & recipes.</p>` : ""}
    ${o.items.length ? `<div class="cart"><label class="f" style="margin-top:14px">In this order${prices ? " · tap price to change" : ""}</label>${o.items.map((i, ix) => `<div class="cl"><div class="cn">${esc(i.item)}<small>${rs(i.qty * i.rate)}</small></div>
      ${prices ? `<input class="rate" data-rate="${ix}" inputmode="numeric" value="${i.rate}" aria-label="Price for ${esc(i.item)}">` : ""}
      <div class="stepper"><button data-step="${ix}:-1" aria-label="One less">−</button><span>${i.qty}</span><button data-step="${ix}:1" aria-label="One more">+</button></div></div>`).join("")}</div>` : ""}
    <details class="predet"${o.slot || o.cakeMsg || o.weight || o.flavour || o.advance ? " open" : ""}><summary>Pre-order details <small class="mut">time, cake message, weight, advance</small></summary>
      <label class="f">Delivery time</label><div class="chips">${SLOTS.map(x => `<button class="chip" data-slot="${esc(x)}" aria-pressed="${o.slot === x}">${esc(x)}</button>`).join("")}<input class="in" id="cSlot" value="${esc(SLOTS.includes(o.slot) ? "" : o.slot || "")}" placeholder="or a time, e.g. 6:30 pm" style="max-width:170px"></div>
      <div class="two"><div><label class="f" for="cMsg">Message on the cake</label><input class="in" id="cMsg" value="${esc(o.cakeMsg || "")}" placeholder="e.g. Happy 5th Birthday Aarav"></div>
      <div><label class="f" for="cWeight">Weight / size</label><input class="in" id="cWeight" value="${esc(o.weight || "")}" placeholder="e.g. 1 kg, 8 inch"></div></div>
      <div class="two"><div><label class="f" for="cFlavour">Flavour / theme</label><input class="in" id="cFlavour" value="${esc(o.flavour || "")}" placeholder="e.g. Belgian chocolate, unicorn"></div>
      <div><label class="f" for="cAdv">Advance to collect ₹</label><input class="in" id="cAdv" inputmode="numeric" value="${o.advance || ""}" placeholder="0"></div></div>
    </details>
    <div class="two"><div><label class="f" for="cTag">Occasion</label><select class="in" id="cTag"><option value="">Regular order</option>${[...new Set([...(c.tags || []), o.tag].filter(Boolean))].map(g => `<option ${g === o.tag ? "selected" : ""}>${esc(g)}</option>`).join("")}</select></div>
    <div><label class="f" for="cNotes">Notes</label><input class="in" id="cNotes" value="${esc(o.notes)}" placeholder="Optional"></div></div>
  </div>
  <div class="comp-foot">${extrasHtml(o, "Offer")}
    <div class="totline"><small>${M.pcs(o)} pcs${M.disc(o) ? ` · saves ${rs(M.disc(o))}` : ""}${M.charges(o) ? ` · charges ${rs(M.charges(o))}` : ""}${M.taxOf(M.withTax(o)).tax ? ` · ${M.withTax(o).taxIncl ? "incl." : "+"} ${esc(M.taxCfg().name)} ${rs2(M.taxOf(M.withTax(o)).tax)}` : ""}</small><b>${rs(M.total(M.withTax(o)))}</b></div>
    <button class="btn btn-primary" data-act="saveCompose" ${o.items.length ? "" : "disabled"}>${st.quote ? "Save quotation" : st.standing ? "Save standing order" : st.isNew ? "Save order" : "Save changes"}</button>
    ${st.isNew && !st.quote && !st.standing && H.saveQuote ? `<button class="linkbtn" data-act="composeAsQuote" style="margin-top:6px">Save as a quotation instead</button>` : ""}</div>`, true);
  const cs = $(".comp-scroll"); if (cs) cs.scrollTop = sc;
  if (fid) { const el = document.getElementById(fid); if (el) { el.focus(); try { el.setSelectionRange(fpos, fpos); } catch (_) {} } }
}
function syncCompose() { const o = ui.sheet.o; const g = id => document.getElementById(id);
  if (g("cSlot") && g("cSlot").value.trim()) o.slot = g("cSlot").value.trim(); if (g("cMsg")) o.cakeMsg = g("cMsg").value.trim(); if (g("cWeight")) o.weight = g("cWeight").value.trim(); if (g("cFlavour")) o.flavour = g("cFlavour").value.trim(); if (g("cAdv")) o.advance = Math.max(0, Math.round(num(g("cAdv").value))); if (g("cName")) o.customer = g("cName").value; if (g("cFlat")) o.flat = g("cFlat").value; if (g("cPhone")) o.phone = g("cPhone").value; if (g("cNotes")) o.notes = g("cNotes").value; if (g("cTag")) o.tag = g("cTag").value; }
A.customItem = async () => { syncCompose(); const st = ui.sheet;
  const v = await ask(`<p class="cq">Other item</p><input class="in" id="ciName" placeholder="Item name" style="margin-top:12px"><input class="in" id="ciPrice" placeholder="Price ₹" inputmode="numeric" style="margin-top:8px">`, [{ label: "Cancel", cls: "btn-ghost", value: false }, { label: "Add", cls: "btn-primary", value: "add" }], true);
  if (v === "add") { const n = ($("#ciName").value || "").trim(); if (n) { st.o.items.push({ item: n, qty: 1, rate: num($("#ciPrice").value) }); st.dirty = true; } }
  drawCompose(st); };
A.saveCompose = async el => { syncCompose(); const st = ui.sheet; const o = st.o;
  o.customer = o.customer.trim(); o.flat = o.flat.trim().toUpperCase().replace(/^([A-Z])\s*-?\s*(\d+)$/, "$1-$2"); o.phone = o.phone.trim(); o.notes = o.notes.trim();
  if (!o.customer) { toast("Add the customer’s name"); $("#cName").focus(); return; }
  if (!o.items.length) { toast("Add at least one item"); return; }
  recheckCoupon(o);
  if (st.quote && H.saveQuote) { await H.saveQuote(o, st); return; }
  if (st.standing && H.saveStanding) { await H.saveStanding(o, st); return; }
  // A customer not seen before is checked against saved ones (same flat or phone, similar name) before the order is saved.
  const prev = st.isNew ? null : M.orders().find(x => x.id === o.id);
  if (!prev || M.ckey(prev) !== M.ckey(o)) { const r = await checkCustomer(o); if (!r) return; if (r !== "new") { Object.assign(o, r); st.dirty = true; } }
  if (!await L.saveOk(st)) return;
  if (H.creditCheck && !await H.creditCheck(o, st)) return;
  { const pct = M.discF(M.withTax(o)) * 100; const prev = !st.isNew && M.orders().find(x => x.id === o.id); if (pct > 0.01 && (!prev || Math.abs(M.discF(prev) * 100 - pct) > 0.01) && H.approve && !await H.approve("discount", pct, `Discount on ${o.customer || "the order"}`)) return; }
  if (!o.no) o.no = M.nextNo(st.prefix);
  el.disabled = true; await saveOrder(o); if (st.fromQuote && H.quoteAccepted) await H.quoteAccepted(st.fromQuote, o.id); const wasNew = st.isNew; if (st.lock) L.release(st.lock); ui.sheet = null; closeSheet();
  if (S.view === "today" && wasNew && o.date !== S.date) { S.date = o.date; S.center = true; render(); }
  toast(wasNew ? `Order #${o.no} saved for ${dLabel(o.date)}` : "Changes saved", o.phone ? `<a href="${esc(waHref(o.phone, orderText(M.normOrder(o))))}" target="_blank" rel="noopener">Send on WhatsApp</a>` : ""); };

H.click.push(async T => {
  const st = ui.sheet; if (!st || st.kind !== "compose") return false; const o = st.o;
  const sl = T.closest("[data-slot]"); if (sl) { syncCompose(); o.slot = o.slot === sl.dataset.slot ? "" : sl.dataset.slot; if ($("#cSlot")) $("#cSlot").value = ""; st.dirty = true; drawCompose(st); return true; }
  const pc = T.closest("[data-pickcust]"); if (pc) { const c = M.customers().find(x => x.key === pc.dataset.pickcust); if (c) { Object.assign(o, { customer: c.customer, flat: c.flat, phone: c.phone || o.phone }); if (H.repriceFor) H.repriceFor(o); } st.sugg = false; drawCompose(st); return true; }
  const cd = T.closest("[data-cdate]"); if (cd) { syncCompose(); o.date = cd.dataset.cdate; st.dirty = true; drawCompose(st); return true; }
  const ch = T.closest("[data-chan]"); if (ch) { syncCompose(); o.channel = ch.dataset.chan; st.dirty = true; drawCompose(st); return true; }
  const ct = T.closest("[data-cat]"); if (ct) { syncCompose(); st.cat = ct.dataset.cat; drawCompose(st); return true; }
  const am = T.closest("[data-addm]"); if (am) { syncCompose(); const m = M.menu().find(x => x.id === am.dataset.addm); if (!m) return true; const ex = o.items.find(i => i.menuId === m.id); if (ex) ex.qty++; else o.items.push({ item: m.name, qty: 1, rate: H.priceFor ? H.priceFor(m, o) : m.price, menuId: m.id }); st.dirty = true; st.sugg = false; drawCompose(st); return true; }
  const sp = T.closest("[data-step]"); if (sp) { syncCompose(); const [ix, d] = sp.dataset.step.split(":").map(Number); o.items[ix].qty += d; if (o.items[ix].qty <= 0) o.items.splice(ix, 1); st.dirty = true; drawCompose(st); return true; }
  if (T.closest("[data-xdisc],[data-xcustom],[data-xcoupon],[data-xcharge],[data-xother]")) { syncCompose(); if (await extrasClick(T, o)) { st.dirty = true; drawCompose(st); } return true; }
  return false;
});
H.input.push(T => {
  const st = ui.sheet; if (!st || st.kind !== "compose") return false;
  if (T.id === "cName") { st.o.customer = T.value; st.sugg = true; st.dirty = true; drawCompose(st); return true; }
  if (["cFlat", "cPhone", "cNotes"].includes(T.id)) { syncCompose(); st.dirty = true; return true; }
  if (T.dataset.rate != null) { const it = st.o.items[+T.dataset.rate]; it.rate = num(T.value); st.dirty = true; const tb = $(".totline b"); if (tb) tb.textContent = rs(M.total(M.withTax(st.o))); const sm = T.closest(".cl").querySelector(".cn small"); if (sm) sm.textContent = rs(it.qty * it.rate); return true; }
  return false;
});
H.change.push(T => {
  const st = ui.sheet; if (!st || st.kind !== "compose") return false;
  if (T.id === "cDate" && T.value) { syncCompose(); st.o.date = T.value; st.dirty = true; drawCompose(st); return true; }
  if (T.id === "cTag") { st.o.tag = T.value; st.dirty = true; return true; }
  return false;
});
