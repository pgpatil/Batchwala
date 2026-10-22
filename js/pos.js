// Counter: punch walk-in orders as takeaway or dine-in (open table tabs settled later), and Swiggy / Zomato sales.
import * as M from "./model.js";
import * as R from "./roles.js";
import { S, A, V, H, guard, saveOrder, payOrders, band, payTag, noLabel } from "./core.js";
import { esc, rs, rs2, uid, today, ICON } from "./util.js";
import { ui, toast, ask, yesNo } from "./ui.js";
import { checkCustomer } from "./match.js";
import { extrasHtml, extrasClick, recheckCoupon } from "./extras.js";
import { openSheet, closeSheet } from "./ui.js";

const SVC = [["takeaway", "Takeaway"], ["dinein", "Dine-in"], ["swiggy", "Swiggy"], ["zomato", "Zomato"]];
const MODES = ["UPI", "Cash", "Card"];
const r2 = v => Math.round(v * 100) / 100;
const fresh = (svc = "takeaway", mode = "UPI") => ({ svc, table: "", customer: "", phone: "", items: [], discountPct: 0, discountAmt: 0, coupon: "", charges: [], note: "", openId: "", mode, cat: "", dirty: false });
const P = () => S.pos || (S.pos = fresh());
const walkin = svc => svc === "takeaway" || svc === "dinein";
const openTabs = () => M.orders(false).filter(o => o.channel === "walkin" && o.service === "dinein" && !M.isDelivered(o));
// The ticket as an order, with current tax rates on new lines, so totals match the bill.
const asOrder = p => M.withTax({ items: p.items, discountPct: p.discountPct, discountAmt: p.discountAmt, coupon: p.coupon, charges: p.charges, ...(p.openId ? { taxIncl: (M.orders().find(o => o.id === p.openId) || {}).taxIncl } : {}) });
const total = p => M.total(asOrder(p));
const pcs = p => p.items.reduce((s, i) => s + i.qty, 0);
const since = o => new Date(o.createdAt || o._at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
function tableList(tabs) { const n = Math.max(1, +M.config().tables || 10); const t = Array.from({ length: n }, (_, i) => String(i + 1)); tabs.forEach(o => { if (o.table && !t.includes(o.table)) t.push(o.table); }); return t; }
function shownMenu(p) { const q = (S.query.pos || "").toLowerCase().trim(); return M.menuActive().filter(m => (!p.cat || m.category === p.cat) && (!q || (m.name + " " + (m.aliases || "")).toLowerCase().includes(q))); }

/* ---------- view ---------- */
V.pos = () => {
  const p = P(); const t = today(); const money = R.can("money"); const tabs = openTabs();
  const mm = M.menuActive(); const cats = [...new Set(mm.map(m => m.category).filter(Boolean))]; const shown = shownMenu(p);
  const done = M.orders(false).filter(o => o.date === t && !M.PREORDER.includes(o.channel) && M.isDelivered(o));
  const qOf = id => p.items.filter(i => i.menuId === id).reduce((s, i) => s + i.qty, 0);
  const tab = p.openId ? tabs.find(o => o.id === p.openId) : null;
  let h = band("Counter", "", `<div class="stats"><div class="st"><b>${done.length}</b><span>sales today</span></div>${money ? `<div class="st"><b>${rs(done.reduce((s, o) => s + M.total(o), 0))}</b><span>sold today</span></div>` : ""}<div class="st"><b>${tabs.length}</b><span>open table${tabs.length === 1 ? "" : "s"}${tabs.length && money ? " · " + rs(tabs.reduce((s, o) => s + M.total(o), 0)) : ""}</span></div></div>`);
  h += `<div class="pos"><section class="pos-menu">
    <div class="seg" role="group" aria-label="Order type">${SVC.map(([k, l]) => `<button data-possvc="${k}" aria-pressed="${p.svc === k}">${l}${k === "dinein" && tabs.length ? ` <em>${tabs.length}</em>` : ""}</button>`).join("")}</div>
    ${p.svc === "dinein" ? `<label class="f">Table</label><div class="tables">${tableList(tabs).map(n => { const o = tabs.find(x => x.table === n);
      return `<button class="tbl${o ? " occ" : ""}" data-postable="${esc(n)}" aria-pressed="${p.table === n}">${esc(n)}<small>${o ? (money ? rs(M.total(o)) : "open") : "free"}</small></button>`; }).join("")}</div>` : ""}
    ${p.svc === "takeaway" ? `<div class="two" style="margin-top:10px"><input class="in" id="posName" value="${esc(p.customer)}" placeholder="Name (optional)" autocomplete="off"><input class="in" id="posPhone" value="${esc(p.phone)}" placeholder="Phone (optional)" inputmode="tel" autocomplete="off"></div>` : ""}
    <div class="tools" style="padding:12px 0 0">${`<input class="search" data-search="pos" type="search" placeholder="Search menu · Enter adds the first match" value="${esc(S.query.pos || "")}" aria-label="Search menu">`}</div>
    ${cats.length > 1 ? `<div class="chips scroll" style="margin-top:8px"><button class="chip" data-poscat="" aria-pressed="${!p.cat}">All</button>${cats.map(c => `<button class="chip" data-poscat="${esc(c)}" aria-pressed="${p.cat === c}">${esc(c)}</button>`).join("")}</div>` : ""}
    <div class="grid" style="margin-top:10px">${shown.map(m => { const n = qOf(m.id); return `<button class="tile${n ? " sel" : ""}" data-posadd="${esc(m.id)}"><span class="tn">${esc(m.name)}</span><span class="tp">${rs(m.price)}</span>${n ? `<span class="q">${n}</span>` : ""}</button>`; }).join("")}</div>
    ${!mm.length ? `<p class="hint">The menu is empty. Add items in Menu & recipes.</p>` : !shown.length ? `<p class="hint">Nothing on the menu matches.</p>` : ""}
  </section>
  <aside class="pos-ticket" id="ticket" aria-label="Ticket">
    <div class="tk-head"><b>${p.svc === "dinein" ? (p.table ? `Table ${esc(p.table)}` : "Dine-in · pick a table") : esc(SVC.find(x => x[0] === p.svc)[1])}</b>${tab ? `<span class="tag t-part">open since ${esc(since(tab))} · ${noLabel(tab)}</span>` : ""}${p.items.length ? `<button class="linkbtn" data-posclear>Clear</button>` : ""}</div>
    ${p.items.length ? `<div class="cart">${p.items.map((i, ix) => `<div class="cl"><div class="cn">${esc(i.item)}<small>${rs(i.rate)} × ${i.qty} = ${rs(i.qty * i.rate)}</small></div><div class="stepper"><button data-posstep="${ix}:-1" aria-label="One less">−</button><span>${i.qty}</span><button data-posstep="${ix}:1" aria-label="One more">+</button></div></div>`).join("")}</div>`
      : `<p class="hint">Tap items to add them.${p.svc === "dinein" && tabs.length ? " Tap a busy table to see or add to its bill." : ""}</p>`}
    <input class="in" id="posNote" value="${esc(p.note)}" placeholder="Note (less sugar, birthday candle…)" style="margin-top:10px">
    <div style="margin-top:10px">${extrasHtml(p)}</div>
    ${M.taxLines(asOrder(p)).map(([n, v]) => `<div class="taxline"><span>${asOrder(p).taxIncl ? "incl. " : ""}${esc(n)}</span><span>${rs2(v)}</span></div>`).join("")}
    <div class="totline"><small>${pcs(p)} pcs${M.disc(asOrder(p)) ? ` · saves ${rs(M.disc(asOrder(p)))}` : ""}${M.charges(asOrder(p)) ? ` · charges ${rs(M.charges(asOrder(p)))}` : ""}</small><b>${rs(total(p))}</b></div>
    ${p.svc === "takeaway" ? `<div class="seg seg3" style="margin-top:8px" role="group" aria-label="Paid by">${[...MODES, "Split"].map(m => `<button data-posmode="${m}" aria-pressed="${p.mode === m}">${m}</button>`).join("")}</div>
      <button class="btn btn-primary" data-act="posCharge" ${p.items.length ? "" : "disabled"}>Charge ${rs(total(p))} · ${esc(p.mode)}</button>` : ""}
    ${p.svc === "dinein" ? `<div class="btnrow"><button class="btn btn-ghost" data-act="posSaveTab" ${p.items.length && p.table && p.dirty ? "" : "disabled"}>${tab ? "Update table" : "Open table"}</button><button class="btn btn-primary" data-act="posSettle" ${p.items.length && p.table ? "" : "disabled"}>Settle ${rs(total(p))}</button></div>${tab && p.items.length > 0 && pcs(p) > 1 ? `<button class="btn btn-ghost" data-act="posSplitBill">Split the bill by items</button>` : ""}` : ""}
    ${!walkin(p.svc) ? `<button class="btn btn-primary" data-act="posAggregator" ${p.items.length ? "" : "disabled"}>Save ${esc(M.CHANNELS[p.svc])} order · ${rs(total(p))}</button><p class="hint">${esc(M.CHANNELS[p.svc])} settles later; it shows under Payments until then.</p>` : ""}
  </aside></div>
  ${p.items.length && !S.wide ? `<button class="posbar" data-posticket><span>${pcs(p)} pcs · <b>${rs(total(p))}</b></span><span>View ticket ${ICON.chev}</span></button><div style="height:64px"></div>` : ""}`;
  const recent = M.orders(false).filter(o => o.date === t && !M.PREORDER.includes(o.channel)).sort((a, b) => a._at < b._at ? 1 : -1).slice(0, 12);
  if (recent.length) h += `<div class="sect">Today at the counter</div><ul class="list" style="padding-top:0">${recent.map(o => `<li class="row"><button class="who" data-open="${esc(o.id)}"><div class="nm">${esc(M.chanLabel(o))} ${noLabel(o)}${o.customer && !/^(Table \d+|Walk-in|Swiggy|Zomato)$/.test(o.customer) ? " · " + esc(o.customer) : ""}</div><div class="subl">${o.items.map(i => esc(i.item) + " ×" + i.qty).join(", ")} · ${M.isDelivered(o) ? payTag(o) : `<span class="tag t-part">Open</span>`}</div></button>${money ? `<div class="amt">${rs(M.total(o))}</div>` : ""}</li>`).join("")}</ul>`;
  return h;
};

/* ---------- saving ---------- */
async function savePos(status) {
  const p = P(); const me = R.me(); const now = new Date().toISOString();
  const ex = p.openId ? M.orders().find(o => o.id === p.openId) : null; const w = walkin(p.svc);
  const o = { ...(ex || { id: uid("o"), no: M.nextNo(R.numPrefix()), date: today(), createdAt: now, tag: M.config().activeTag || "", flat: "" }),
    customer: p.customer.trim() || (p.svc === "dinein" ? `Table ${p.table}` : w ? "Walk-in" : M.CHANNELS[p.svc]), phone: p.phone.trim(),
    channel: w ? "walkin" : p.svc, service: w ? p.svc : "", table: p.svc === "dinein" ? p.table : "",
    items: p.items.map(i => ({ ...i })), discountPct: p.discountPct, discountAmt: p.discountAmt, coupon: p.coupon, charges: (p.charges || []).map(c => ({ ...c })), notes: p.note.trim(), status, deliveredAt: status === "delivered" ? now : "" };
  await saveOrder(o); return M.orders().find(x => x.id === o.id);   // as stored, with tax stamped
}
const reset = () => { const p = P(); S.pos = fresh(p.svc, p.mode); S.query.pos = ""; H.render(); };
// A discount above the approval limit needs an admin or management PIN before the sale is saved.
const discOk = async p => { const pct = M.discF(asOrder(p)) * 100; return !(pct > 0.01) || !H.approve || await H.approve("discount", pct, "Discount at the counter"); };
A.posCharge = async el => { if (!guard("sale")) return; const p = P(); if (!p.items.length) return; if (!await discOk(p)) return;
  if (p.customer.trim()) { const r = await checkCustomer({ customer: p.customer.trim(), flat: "", phone: p.phone }); if (!r) return; if (r !== "new") { p.customer = r.customer; p.phone = r.phone || p.phone; } }
  recheckCoupon(p); const parts = p.mode === "Split" ? await splitPrompt(total(p)) : [[p.mode, null]]; if (!parts) return;
  el.disabled = true;
  const o = await savePos("delivered"); await payParts(o, parts); reset();
  toast(`${rs(M.total(o))} by ${parts.map(x => x[0]).join(" + ")} · order ${o.no}`, `<button data-receipt="${esc(o.id)}">Receipt</button><button data-undosale="${esc(o.id)}">Undo</button>`);
  if (M.config().autoReceipt && H.printReceipt) H.printReceipt(o.id); };
A.posAggregator = async el => { if (!guard("sale")) return; if (!await discOk(P())) return; el.disabled = true; const o = await savePos("delivered"); reset();
  toast(`${M.CHANNELS[o.channel]} order ${o.no} saved`, `<button data-undosale="${esc(o.id)}">Undo</button>`); };
// One save at a time: a double tap would otherwise open two tabs on one table with the same number.
let saving = false;
A.posSaveTab = async el => { if (!guard("sale") || saving) return; const p = P(); if (!p.table) { toast("Pick a table"); return; }
  saving = true; if (el) el.disabled = true; let o; try { o = await savePos("received"); } finally { saving = false; } toast(`Table ${p.table} · ${rs(M.total(o))} on the bill`); reset(); };
A.posSettle = async () => { if (!guard("sale")) return; const p = P(); if (!p.table) { toast("Pick a table"); return; } if (!await discOk(p)) return; recheckCoupon(p);
  const parts = await payPrompt(`Settle table ${esc(p.table)}`, total(p), `${pcs(p)} pcs${M.disc(asOrder(p)) ? ` · ${esc(M.offerText(asOrder(p)))}` : ""}`);
  if (!parts) return; const o = await savePos("delivered"); await payParts(o, parts); toast(`Table ${p.table} settled · ${rs(M.total(o))} by ${parts.map(x => x[0]).join(" + ")}`); reset(); };

/* ---------- split payment and split bill ---------- */
// Pays an order in parts: [[mode, amount]]; a null amount pays what is left.
async function payParts(o, parts) { for (const [mode, amt] of parts) { const cur = M.orders().find(x => x.id === o.id) || o; await payOrders([cur], mode, amt == null ? undefined : amt); } }
async function payPrompt(title, amount, detail = "") {
  const mode = await ask(`<p class="cq">${title}</p><div class="cbig">${rs(amount)}</div>${detail ? `<div class="cdetail">${detail}</div>` : ""}`,
    [...MODES.map(m => ({ label: `Paid by ${m}`, cls: "btn-ok", value: m })), { label: "Split between modes…", cls: "btn-ghost", value: "split" }, { label: "Cancel", cls: "btn-danger", value: null }]);
  if (!mode) return null; return mode === "split" ? splitPrompt(amount) : [[mode, null]];
}
// Amounts per mode; they must add up to the bill. "Equal shares" fills one mode's box with the bill divided by the people paying.
async function splitPrompt(amount) {
  const ok = await ask(`<p class="cq">Split ${rs(amount)}</p><div class="kv" style="margin-top:10px">${MODES.map(m => `<div style="align-items:center"><span>${m}</span><input class="in" data-splitm="${m}" inputmode="decimal" placeholder="0" style="max-width:140px"></div>`).join("")}</div>
    <div class="cdetail" id="splitLeft">Enter the amount paid by each mode.</div>`, [{ label: "Cancel", cls: "btn-ghost", value: false }, { label: "Record payments", cls: "btn-ok", value: true }], true);
  if (!ok) return null; const parts = MODES.map(m => [m, r2(+((document.querySelector(`[data-splitm="${m}"]`) || {}).value || 0) || 0)]).filter(x => x[1] > 0);
  const sum = r2(parts.reduce((s, x) => s + x[1], 0)); if (Math.abs(sum - amount) > 0.5) { toast(`The parts add up to ${rs(sum)}, not ${rs(amount)}`); return null; }
  if (parts.length) parts[parts.length - 1][1] = null;   // the last part takes what is left, so rounding never leaves a paisa due
  return parts;
}
document.addEventListener("input", e => { const el = e.target; if (!el.matches || !el.matches("[data-splitm]")) return; const box = document.getElementById("splitLeft"); const big = document.querySelector("#cbox .cq");
  const amount = big ? +(big.textContent.replace(/[^\d.]/g, "")) : 0; const sum = [...document.querySelectorAll("[data-splitm]")].reduce((s, x) => s + (+x.value || 0), 0);
  if (box) box.textContent = Math.abs(amount - sum) < 0.5 ? "Adds up ✓" : amount > sum ? `${rs(amount - sum)} still to split` : `${rs(sum - amount)} too much`; });
// Split by items: the guest pays for what they had now; the rest stays on the table.
A.posSplitBill = () => { const p = P(); if (!p.openId || p.dirty) { toast("Update the table first, then split"); return; } const st = { kind: "posSplit", pick: p.items.map(() => 0) }; st.redraw = () => drawSplit(st); drawSplit(st); };
function splitPart(p, pick) {
  const whole = asOrder(p); const pct = r2(M.discF(whole) * 100);   // a flat discount is shared out as the same % on both bills
  const take = p.items.map((i, ix) => ({ ...i, qty: pick[ix] })).filter(i => i.qty > 0); const keep = p.items.map((i, ix) => ({ ...i, qty: i.qty - pick[ix] })).filter(i => i.qty > 0);
  return { take, keep, pct };
}
function drawSplit(st) {
  const p = P(); const { take, pct } = splitPart(p, st.pick); const part = M.withTax({ items: take, discountPct: pct });
  openSheet(st, `<div class="sh-head"><h2 class="h">Split table ${esc(p.table)}</h2><button class="x" data-close aria-label="Close">×</button></div>
  <p class="hint" style="margin-top:-4px">Pick what this guest is paying for. The rest stays on the table${(p.charges || []).length ? " with its charges" : ""}.</p>
  <div class="kv">${p.items.map((i, ix) => `<div style="align-items:center"><span>${esc(i.item)} <small class="mut">${i.qty} on the bill · ${rs(i.rate)}</small></span><div class="stepper"><button data-splitstep="${ix}:-1" aria-label="One less">−</button><span>${st.pick[ix]}</span><button data-splitstep="${ix}:1" aria-label="One more">+</button></div></div>`).join("")}</div>
  <div class="totline" style="margin-top:12px"><small>${take.reduce((s, i) => s + i.qty, 0)} pcs${pct ? ` · ${pct}% off` : ""}</small><b>${rs(M.total(part))}</b></div>
  <button class="btn btn-primary" data-splitpay ${take.length ? "" : "disabled"}>Take payment for these · ${rs(M.total(part))}</button>`);
}
async function paySplit(st) {
  const p = P(); const { take, keep, pct } = splitPart(p, st.pick); if (!take.length) return; if (!keep.length) { closeSheet(); A.posSettle(); return; }
  const tab = M.orders().find(o => o.id === p.openId); if (!tab || M.isDelivered(tab)) { toast("This table was settled meanwhile"); closeSheet(); reset(); return; }
  const part = M.withTax({ items: take, discountPct: pct }); const parts = await payPrompt(`Pay for part of table ${esc(p.table)}`, M.total(part)); if (!parts) return;
  const now = new Date().toISOString();
  const o = { id: uid("o"), no: M.nextNo(R.numPrefix()), date: today(), createdAt: now, tag: tab.tag || "", flat: "", customer: tab.customer, phone: "", channel: "walkin", service: "dinein", table: p.table,
    items: take, discountPct: pct, ...(p.coupon ? { coupon: p.coupon } : {}), notes: `Split from ${tab.no}`, status: "delivered", deliveredAt: now };
  await saveOrder(o); await payParts(M.orders().find(x => x.id === o.id), parts);
  await saveOrder({ ...tab, items: keep, discountPct: +p.discountAmt > 0 ? pct : tab.discountPct, discountAmt: 0 });
  closeSheet(); toast(`${rs(M.total(M.orders().find(x => x.id === o.id)))} paid · the rest stays on table ${p.table}`); loadTable(p.table); H.render();
}
H.click.push(async T => { const st = ui.sheet; if (!st || st.kind !== "posSplit") return false; const p = P();
  const sp = T.closest("[data-splitstep]"); if (sp) { const [ix, d] = sp.dataset.splitstep.split(":").map(Number); st.pick[ix] = Math.max(0, Math.min(p.items[ix].qty, st.pick[ix] + d)); drawSplit(st); return true; }
  if (T.closest("[data-splitpay]")) { await paySplit(st); return true; } return false; });

/* ---------- interactions ---------- */
async function okToLeave() { const p = P(); return !p.dirty || !p.items.length || await yesNo(`<p class="cq">Discard this ticket?</p><div class="cdetail">The items you added haven’t been saved.</div>`, "Discard", "btn-danger-solid", "Keep it"); }
function addItem(m) { const p = P(); const ex = p.items.find(i => i.menuId === m.id); if (ex) ex.qty++; else p.items.push({ item: m.name, qty: 1, rate: m.price, menuId: m.id }); p.dirty = true; }
function loadTable(n) {
  const p = P(); const o = openTabs().find(x => x.table === n);
  if (!o) { if (p.openId) { S.pos = { ...fresh("dinein", p.mode), table: n }; } else p.table = n; return; }
  const extra = p.openId ? [] : p.items; const items = o.items.map(i => ({ ...i }));
  extra.forEach(i => { const ex = items.find(x => x.menuId && x.menuId === i.menuId); if (ex) ex.qty += i.qty; else items.push({ ...i }); });
  S.pos = { ...fresh("dinein", p.mode), table: n, openId: o.id, items, discountPct: o.discountPct || 0, discountAmt: o.discountAmt || 0, coupon: o.coupon || "", charges: (o.charges || []).map(c => ({ ...c })), note: o.notes || "", dirty: extra.length > 0 };
  if (extra.length) toast(`Added to table ${n}'s bill. Tap Update table to save.`);
}
H.click.push(async T => {
  if (S.view !== "pos") return false; const p = P();
  const sv = T.closest("[data-possvc]"); if (sv) { const k = sv.dataset.possvc; if (k === p.svc) return true;
    if (p.openId) { if (!await okToLeave()) return true; S.pos = fresh(k, p.mode); } else { p.svc = k; if (k !== "dinein") p.table = ""; }
    H.render(); return true; }
  const tb = T.closest("[data-postable]"); if (tb) { const n = tb.dataset.postable; if (n === p.table) return true;
    if (p.openId && !await okToLeave()) return true; loadTable(n); H.render(); return true; }
  const ad = T.closest("[data-posadd]"); if (ad) { const m = M.menu().find(x => x.id === ad.dataset.posadd); if (m) { addItem(m); H.render(); } return true; }
  const sp = T.closest("[data-posstep]"); if (sp) { const [ix, d] = sp.dataset.posstep.split(":").map(Number); p.items[ix].qty += d; if (p.items[ix].qty <= 0) p.items.splice(ix, 1); p.dirty = true; H.render(); return true; }
  if (!T.closest("#sheet") && T.closest("[data-xdisc],[data-xcustom],[data-xcoupon],[data-xcharge],[data-xother]")) { if (await extrasClick(T, p)) { p.dirty = true; H.render(); } return true; }
  const md = T.closest("[data-posmode]"); if (md) { p.mode = md.dataset.posmode; H.render(); return true; }
  const ct = T.closest("[data-poscat]"); if (ct) { p.cat = ct.dataset.poscat; H.render(); return true; }
  if (T.closest("[data-posclear]")) { if (await okToLeave()) { S.pos = fresh(p.svc, p.mode); H.render(); } return true; }
  if (T.closest("[data-posticket]")) { document.getElementById("ticket").scrollIntoView({ behavior: "smooth", block: "start" }); return true; }
  return false;
});
H.input.push(T => {
  if (S.view !== "pos" || ui.sheet) return false; const p = P();
  if (T.id === "posName") { p.customer = T.value; return true; }
  if (T.id === "posPhone") { p.phone = T.value; return true; }
  if (T.id === "posNote") { p.note = T.value; p.dirty = true; return true; }
  return false;
});
// Enter in the menu search adds the first match, so a keyboard-only counter works.
document.addEventListener("keydown", e => {
  if (e.key !== "Enter" || S.view !== "pos" || !e.target.matches || !e.target.matches('[data-search="pos"]')) return;
  const m = shownMenu(P())[0]; if (!m) return; e.preventDefault(); addItem(m); S.query.pos = ""; H.render();
  const sb = document.querySelector('[data-search="pos"]'); if (sb) sb.focus();
});
