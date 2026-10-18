// Front-line screens: delivery run, WhatsApp order import and the New-order menu.
import * as ev from "./events.js";
import * as M from "./model.js";
import * as R from "./roles.js";
import { parseOrderMessage } from "./waparse.js";
import { asLines, layoutSwitch } from "./table.js";
import { S, A, V, H, guard, saveOrder, payOrders, addPayment, band, toran, payTag, noLabel } from "./core.js";
import { confirmDeliver, compose, openOrder } from "./orders.js";
import { $, esc, rs, uid, today, addDays, dObj, dLabel, dLong, plate, flatKey, ICON } from "./util.js";
import { ui, toast, openSheet, closeSheet, ask, yesNo } from "./ui.js";
import { checkCustomer } from "./match.js";

/* ---------- Delivery run ---------- */
V.run = () => {
  const d = S.runDate || today(); const t = today();
  const all = M.orders(false).filter(o => o.date === d && M.PREORDER.includes(o.channel)).sort(M.runOrder);
  const todo = all.filter(o => !M.isDelivered(o)), done = all.filter(M.isDelivered);
  const due = todo.reduce((s, o) => s + M.bal(o), 0);
  let h = band("Delivery run", "", `<div class="stats"><div class="st"><b>${todo.length}</b><span>to deliver</span></div><div class="st"><b>${done.length}</b><span>delivered</span></div>${R.can("money") ? `<div class="st"><b>${rs(due)}</b><span>to collect</span></div>` : ""}</div>`);
  h += `<div class="tools">${layoutSwitch("run")}<div class="chips">${[addDays(t, -1), t, addDays(t, 1)].map((x, i) => `<button class="chip" data-rundate="${x}" aria-pressed="${d === x}">${["Yesterday", "Today", "Tomorrow"][i]}</button>`).join("")}</div></div>`;
  if (!all.length) return h + `<div class="empty"><strong>No deliveries for ${esc(dLong(d))}</strong>Pre-orders for this day appear here in route order.</div>`;
  if (asLines("run")) return h + `<div class="card tablecard"><table class="reg"><thead><tr><th class="r">Stop</th><th>Flat</th><th>Customer</th><th>Items</th>${R.can("money") ? `<th class="r">To collect</th>` : ""}<th>Phone</th><th>Status</th></tr></thead><tbody>${[...todo, ...done].map((o, ix) => { const b = M.bal(o);
    return `<tr${M.isDelivered(o) ? ' class="done"' : ""}><td class="r">${M.isDelivered(o) ? "–" : ix + 1}</td><td>${esc(o.flat || "")}</td><td><button class="linkbtn" data-open="${esc(o.id)}"><b>${esc(o.customer)}</b></button></td><td class="items">${o.items.map(i => esc(i.item) + " ×" + i.qty).join(", ")}</td>${R.can("money") ? `<td class="r" data-v="${b}">${b > 0 ? `<b class="due">${rs(b)}</b>` : "Paid"}</td>` : ""}<td>${o.phone && R.can("phone") ? `<a class="lnk" href="tel:${esc(o.phone)}">${esc(o.phone)}</a>` : ""}</td><td>${M.isDelivered(o) ? `<span class="tag t-paid">${ICON.check}Done</span>` : (R.can("deliver") ? `<button class="paybtn" data-rundeliver="${esc(o.id)}">Delivered</button>` : "To deliver")}</td></tr>`; }).join("")}</tbody></table></div>`;
  let floor = "";
  const card = o => { const b = M.bal(o); const fk = flatKey(o.flat); const sect = fk[0] ? "Other addresses" : `${fk[1]} wing · floor ${Math.floor(fk[2] / 100)}`;
    let head = ""; if (!M.isDelivered(o) && sect !== floor) { floor = sect; head = `<li class="sectli">${esc(sect)}</li>`; }
    return head + `<li class="row runcard${M.isDelivered(o) ? " done" : ""}">${plate(o.flat)}<div class="who"><button class="who" data-open="${esc(o.id)}"><div class="nm">${esc(o.customer)}</div><div class="pills">${o.items.map(i => `<span class="pill">${esc(i.item)}<b>×${i.qty}</b></span>`).join("")}</div></button>
      <div class="subl">${R.can("money") ? (b > 0 ? `<b class="due">${rs(b)} to collect</b>` : `<span class="tag t-paid">${ICON.check}Paid</span>`) : ""}${o.phone && R.can("phone") ? ` · <a class="lnk" href="tel:${esc(o.phone)}">Call</a>` : ""}</div></div>
      ${M.isDelivered(o) ? `<span class="tag t-paid">${ICON.check}Done</span>` : (R.can("deliver") ? `<button class="paybtn" data-rundeliver="${esc(o.id)}">Delivered</button>` : "")}</li>`; };
  h += `<ul class="list">${todo.map(card).join("")}${done.length ? `<li class="sectli">Delivered</li>` + done.map(card).join("") : ""}</ul>`;
  return h;
};

H.click.push(async T => {
  const rd = T.closest("[data-rundate]"); if (rd) { S.runDate = rd.dataset.rundate; H.render(); return true; }
  const rv = T.closest("[data-rundeliver]"); if (rv) { const o = M.orders().find(x => x.id === rv.dataset.rundeliver); if (o) await confirmDeliver(o, true); return true; }
  const us = T.closest("[data-undosale]"); if (us) { const o = M.orders().find(x => x.id === us.dataset.undosale); if (o) { await saveOrder({ ...o, status: "cancelled", cancelReason: "Undone at counter" }); for (const p of M.paymentsFor(o.id)) if (p.amount > 0) await addPayment(o, -p.amount, p.mode, "Sale undone", p.id); toast("Sale undone"); } return true; }
  return false;
});

/* ---------- New-order menu ---------- */
H.fab = async () => {
  if (S.view === "stock") { H.purchaseSheet && H.purchaseSheet(); return; }
  if (S.view === "grn") { H.grnSheet && H.grnSheet(); return; }
  if (S.view === "xfer") { H.transferSheet && H.transferSheet(); return; }
  if (S.view === "pos") return;
  const opts = [];
  if (R.can("orders.edit")) opts.push({ label: `${ICON.plus}New order`, cls: "btn-primary", value: "new" });
  if (R.can("wa.import")) opts.push({ label: `${ICON.wa}From a WhatsApp message`, cls: "btn-wa", value: "wa" });
  if (R.can("sale")) opts.push({ label: `${ICON.cart}Counter (takeaway, dine-in, Swiggy, Zomato)`, cls: "btn-ghost", value: "sale" });
  if (opts.length === 1) { pick(opts[0].value); return; }
  opts.push({ label: "Cancel", cls: "btn-danger", value: null });
  pick(await ask(`<p class="cq">Add an order</p>`, opts));
};
function pick(v) { if (v === "new") compose(null); if (v === "wa") waSheet(""); if (v === "sale") { S.view = "pos"; H.render(); } }

/* ---------- WhatsApp import ---------- */
export function waSheet(text) {
  if (!guard("wa.import")) return;
  openSheet({ kind: "wa" }, `<div class="sh-head"><h2 class="h">Order from WhatsApp</h2><button class="x" data-close aria-label="Close">×</button></div>
  <p class="hint" style="margin-top:-6px">Copy the customer’s message in WhatsApp (long-press, Copy) and paste it here. On Android you can also share it straight to this app.</p>
  <textarea class="in" id="waText" style="height:160px" placeholder="e.g. Hi didi, A-1301 here. 2 paneer strudel and 1 kitkat donut for tomorrow please">${esc(text || "")}</textarea>
  <button class="btn btn-wa" data-act="waRead">${ICON.wa}Read message</button>`);
  if (text) A.waRead();
}
A.waRead = () => {
  const text = ($("#waText") || {}).value || ""; if (!text.trim()) { toast("Paste the message first"); return; }
  const p = parseOrderMessage(text, { menu: M.menuActive(), customers: M.customers(), todayISO: today() });
  const st = { kind: "waConfirm", text, p, o: { customer: p.customer, flat: p.flat, phone: p.phone, date: p.date || today(), items: p.items.map(i => ({ ...i })), notes: "" }, un: p.unmatched.map(u => ({ ...u, menuId: "", done: false })) };
  st.redraw = () => drawWa(st); drawWa(st);
};
function drawWa(st) {
  const o = st.o, p = st.p; const t = today(); const mm = M.menuActive(); const open = st.un.filter(u => !u.done).length;
  const matched = p.customerKey && M.customers().some(c => c.key === p.customerKey && c.customer === o.customer);
  const tot = o.items.reduce((s, i) => s + i.qty * i.rate, 0);
  openSheet(st, `<div class="sh-head"><h2 class="h">Check this order</h2><button class="x" data-close aria-label="Close">×</button></div>
  <div class="msg"><small class="mut">Their message</small><div>${esc(st.text).replace(/\n/g, "<br>")}</div></div>
  <label class="f" for="wName">Customer ${matched ? `<span class="tag t-paid">${ICON.check}saved customer</span>` : `<span class="tag t-part">new or unmatched</span>`}</label><input class="in" id="wName" value="${esc(o.customer)}" placeholder="Name">
  <div class="two"><div><label class="f" for="wFlat">Flat</label><input class="in" id="wFlat" value="${esc(o.flat)}" placeholder="e.g. A-1301"></div><div><label class="f" for="wPhone">Phone</label><input class="in" id="wPhone" value="${esc(o.phone)}" inputmode="tel"></div></div>
  <label class="f">Delivery date ${p.dateWords ? `<small class="mut">read from “${esc(p.dateWords)}”</small>` : `<span class="tag t-part">not in message, check</span>`}</label>
  <div class="datechips">${[t, addDays(t, 1), addDays(t, 2)].map((d, i) => `<button class="chip" data-wdate="${d}" aria-pressed="${o.date === d}">${i === 0 ? "Today" : i === 1 ? "Tomorrow" : esc(dObj(d).toLocaleDateString("en-IN", { weekday: "short", day: "numeric" }))}</button>`).join("")}<label class="chip" aria-pressed="${![t, addDays(t, 1), addDays(t, 2)].includes(o.date)}">${![t, addDays(t, 1), addDays(t, 2)].includes(o.date) ? esc(dLong(o.date)) : "Other date"}<input type="date" id="wDate" value="${o.date}"></label></div>
  <label class="f">Items</label>
  ${o.items.length ? `<div class="cart">${o.items.map((i, ix) => `<div class="cl"><div class="cn">${esc(i.item)}<small>${rs(i.qty * i.rate)}</small></div><div class="stepper"><button data-wstep="${ix}:-1" aria-label="One less">−</button><span>${i.qty}</span><button data-wstep="${ix}:1" aria-label="One more">+</button></div></div>`).join("")}</div>` : `<p class="hint">No menu items recognised.</p>`}
  ${st.un.length ? `<label class="f">Words I couldn’t match ${open ? `<span class="tag t-due">${open} to check</span>` : `<span class="tag t-paid">${ICON.check}all checked</span>`}</label>
    <div class="kv">${st.un.map((u, ix) => `<div class="unm${u.done ? " ok" : ""}" style="align-items:center;gap:8px;flex-wrap:wrap"><span style="flex:1 1 100%"><mark>${esc(u.text)}</mark>${u.done ? ` <small class="mut">${u.menuId ? "added" : "ignored"}</small>` : ""}</span>
      ${u.done ? "" : `<select class="in" data-wmap="${ix}" style="flex:1"><option value="">Match to a menu item…</option>${mm.map(m => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join("")}</select><button class="btn btn-ghost" style="margin:0;width:auto;padding:0 14px;height:48px" data-wignore="${ix}">Ignore</button>`}</div>`).join("")}</div>` : ""}
  <label class="f" for="wNotes">Notes</label><input class="in" id="wNotes" value="${esc(o.notes)}" placeholder="Optional">
  <div class="totline"><small>${o.items.reduce((s, i) => s + i.qty, 0)} pcs</small><b>${rs(tot)}</b></div>
  <button class="btn btn-primary" data-act="waConfirm" ${o.items.length && !open ? "" : "disabled"}>Confirm order</button>
  ${open ? `<p class="hint">Match or ignore each highlighted part to confirm.</p>` : ""}
  <button class="btn btn-ghost" data-act="waFull">Open in the full order form</button>`);
}
function syncWa() { const o = ui.sheet.o; const g = id => document.getElementById(id); o.customer = g("wName").value; o.flat = g("wFlat").value; o.phone = g("wPhone").value; o.notes = g("wNotes").value; }
A.waConfirm = async el => {
  syncWa(); const st = ui.sheet; const o = st.o; const me = R.me();
  if (!o.customer.trim()) { toast("Add the customer’s name"); return; }
  const chk = await checkCustomer({ customer: o.customer.trim(), flat: o.flat.trim().toUpperCase().replace(/^([A-Z])\s*-?\s*(\d+)$/, "$1-$2"), phone: o.phone.trim() }); if (!chk) return;
  if (chk !== "new") Object.assign(o, chk);
  const order = { id: uid("o"), no: M.nextNo((me && me.prefix) || ""), customer: o.customer.trim(), flat: o.flat.trim().toUpperCase().replace(/^([A-Z])\s*-?\s*(\d+)$/, "$1-$2"), phone: o.phone.trim(), channel: "whatsapp", date: o.date, items: o.items, discountPct: 0, status: "received", notes: o.notes, tag: M.config().activeTag || "", source: "whatsapp-import", createdAt: new Date().toISOString() };
  el.disabled = true; await saveOrder(order); closeSheet(); toast(`Order #${order.no} saved for ${dLabel(order.date)}`); openOrder(order.id);
};
A.waFull = () => { syncWa(); const o = ui.sheet.o; compose(null, { customer: o.customer, flat: o.flat, phone: o.phone, date: o.date, items: o.items, notes: o.notes }); };
H.click.push(T => {
  const st = ui.sheet; if (!st || st.kind !== "waConfirm") return false;
  const wd = T.closest("[data-wdate]"); if (wd) { syncWa(); st.o.date = wd.dataset.wdate; drawWa(st); return true; }
  const ws = T.closest("[data-wstep]"); if (ws) { syncWa(); const [ix, d] = ws.dataset.wstep.split(":").map(Number); st.o.items[ix].qty += d; if (st.o.items[ix].qty <= 0) st.o.items.splice(ix, 1); drawWa(st); return true; }
  const wi = T.closest("[data-wignore]"); if (wi) { syncWa(); st.un[+wi.dataset.wignore].done = true; drawWa(st); return true; }
  return false;
});
H.change.push(T => {
  const st = ui.sheet; if (!st || st.kind !== "waConfirm") return false;
  if (T.dataset.wmap != null && T.value) { syncWa(); const u = st.un[+T.dataset.wmap]; const m = M.menu().find(x => x.id === T.value); const ex = st.o.items.find(i => i.menuId === m.id);
    if (ex) ex.qty += u.qty || 1; else st.o.items.push({ menuId: m.id, item: m.name, rate: m.price, qty: u.qty || 1 }); u.done = true; u.menuId = m.id;
    if (u.text && confirmAlias(m, u.text)) {} drawWa(st); return true; }
  if (T.id === "wDate" && T.value) { syncWa(); st.o.date = T.value; drawWa(st); return true; }
  return false;
});
// Offer to remember an unmatched word as a short name for the item, so it matches next time.
async function confirmAlias(m, text) {
  if (!R.can("menu.edit")) return false;
  const word = text.toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\b\d+\b/g, " ").replace(/\s+/g, " ").trim();
  if (!word || word.length > 30) return false;
  const yes = await yesNo(`<p class="cq">Remember “${esc(word)}”?</p><div class="cdetail">Next time it will be read as ${esc(m.name)} automatically.</div>`, "Remember", "btn-ok", "Not now");
  if (!yes) return false;
  const { _at, _by, ...rec } = m; await ev.put("menu", { ...rec, aliases: [rec.aliases, word].filter(Boolean).join(", ") }); toast("Saved as a short name"); return true;
}
