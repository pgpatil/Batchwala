// Money: the Payments tab, payment confirmations, customers and the sales and profit reports.
import * as M from "./model.js";
import * as R from "./roles.js";
import { S, A, V, H, guard, saveOrder, payOrders, chipBar, searchBox, matchQ, band, payTag } from "./core.js";
import { orderText, reminderText, compose, openOrder } from "./orders.js";
import { $, esc, rs, num, today, addDays, dObj, dLabel, dLong, plate, cmpFlat, ICON, copyText, waHref } from "./util.js";
import { ui, toast, openSheet, closeSheet, ask, yesNo } from "./ui.js";

/* ---------- Payments tab ---------- */
V.pay = () => {
  S.filter.pay = S.filter.pay || "open";
  const cs = M.customers().sort(cmpFlat); const open = cs.filter(c => c.balance > 0);
  const tDue = cs.reduce((s, c) => s + c.balance, 0), tRec = cs.reduce((s, c) => s + c.received, 0), tAll = cs.reduce((s, c) => s + c.spend, 0);
  const old = cs.reduce((s, c) => s + c.orders.filter(o => M.bal(o) > 0 && o.date < addDays(today(), -7)).reduce((a, o) => a + M.bal(o), 0), 0);
  let h = band("Payments", "", `<div class="stats"><div class="st"><b>${rs(tDue)}</b><span>to collect</span><div class="bar"><i style="width:${tAll ? tRec / tAll * 100 : 0}%"></i></div></div><div class="st"><b>${rs(old)}</b><span>over 7 days old</span></div><div class="st"><b>${rs(tRec)}</b><span>collected</span></div></div>`);
  const rows = cs.filter(c => matchQ("pay", c)).filter(c => S.filter.pay === "all" || (S.filter.pay === "paid" ? c.balance <= 0 : c.balance > 0));
  h += `<div class="tools">${searchBox("pay", "Search name, flat or phone")}${chipBar("pay", [["open", "To collect", open.length], ["paid", "Paid up", cs.length - open.length], ["all", "All", cs.length]])}</div>`;
  if (!cs.length) return h + `<div class="empty"><strong>No customers yet</strong>Payments appear here once you take orders.</div>`;
  if (!rows.length) return h + `<div class="empty"><strong>${S.filter.pay === "open" && !S.query.pay ? "All payments collected" : "Nothing matches"}</strong>${S.filter.pay === "open" && !S.query.pay ? "Nobody owes anything right now." : "Try another name or filter."}</div>`;
  return h + `<ul class="list">${rows.map(c => { const due = c.orders.filter(o => M.bal(o) > 0); const paid = c.balance <= 0; const oldest = due.map(o => o.date).sort()[0];
    return `<li class="row${paid ? " done" : ""}">${plate(c.flat)}<button class="who" data-cust="${esc(c.key)}"><div class="nm">${esc(c.customer)}</div><div class="subl">${paid ? `${rs(c.spend)} paid · ${c.orders.length} order${c.orders.length > 1 ? "s" : ""}` : `${due.length} unpaid · since ${esc(dLabel(oldest))}${c.received ? ` · ${rs(c.received)} received` : ""}`}</div></button>
    <div class="side"><div class="amt">${rs(paid ? c.spend : c.balance)}</div>${paid ? `<span class="tag t-paid">${ICON.check}Paid up</span>` : (R.can("pay.record") ? `<button class="paybtn" data-quickpay="${esc(c.key)}">Mark paid</button>` : "")}</div></li>`; }).join("")}</ul>`;
};

export async function confirmPay(c, single) {
  if (!R.can("pay.record") && !R.can("collect")) { toast("Your role can’t record payments."); return; }
  const due = single ? [single] : c.orders.filter(o => M.bal(o) > 0); const amount = due.reduce((s, o) => s + M.bal(o), 0);
  if (!amount) { toast("Nothing due"); return; }
  const mode = await ask(`${plate(c.flat)}<p class="cq">Payment received?</p><div class="cname">${esc(c.customer)}</div><div class="cbig">${rs(amount)}</div><div class="cdetail">${due.map(o => esc(dLabel(o.date)) + " · " + rs(M.bal(o))).join("<br>")}</div>`,
    [{ label: "Paid by UPI", cls: "btn-ok", value: "UPI" }, { label: "Paid in cash", cls: "btn-ok", value: "Cash" }, { label: "Different amount", cls: "btn-ghost", value: "other" }, { label: "Cancel", cls: "btn-danger", value: null }]);
  if (!mode) return;
  if (mode === "other") { partSheet(c, due); return; }
  await payOrders(due, mode); toast(rs(amount) + " from " + c.customer + " recorded");
  if (ui.sheet && ui.sheet.redraw) ui.sheet.redraw();
}
H.confirmPay = confirmPay;
function partSheet(c, due) {
  const owe = due.reduce((s, o) => s + M.bal(o), 0);
  openSheet({ kind: "part", key: c.key, ids: due.map(o => o.id), mode: "" }, `<div class="sh-head"><h2 class="h">Part payment</h2><button class="x" data-close aria-label="Close">×</button></div>
  <div class="kv"><div><span>${esc(c.customer)} owes</span><b>${rs(owe)}</b></div></div>
  <label class="f" for="pAmt">Amount received now ₹</label><input class="in" id="pAmt" inputmode="numeric" placeholder="0">
  <label class="f">Paid by</label><div class="chips">${["UPI", "Cash", "Bank transfer"].map(m => `<button class="chip" data-pmode="${m}" aria-pressed="false">${m}</button>`).join("")}</div>
  <p class="hint">Applied to the oldest unpaid order first.</p><button class="btn btn-ok" data-act="savePart">Save payment</button>`);
}
A.savePart = async () => {
  const st = ui.sheet; const amt = num($("#pAmt").value); if (!amt) { toast("Enter the amount received"); return; }
  const due = M.orders(false).filter(o => st.ids.includes(o.id)); const owe = due.reduce((s, o) => s + M.bal(o), 0); const c = due[0];
  if (!await yesNo(`${plate(c.flat)}<p class="cq">Record ${rs(amt)}?</p><div class="cname">${esc(c.customer)}</div><div class="cdetail">${st.mode ? "Paid by " + esc(st.mode) + ". " : ""}Balance after this: ${rs(Math.max(0, owe - amt))}</div>`, "Yes, record", "btn-ok")) return;
  await payOrders(due, st.mode, amt); closeSheet(); toast(rs(amt) + " from " + c.customer + " recorded");
};
H.click.push(T => {
  const st = ui.sheet;
  if (st && st.kind === "part") { const pm = T.closest("[data-pmode]"); if (pm) { st.mode = st.mode === pm.dataset.pmode ? "" : pm.dataset.pmode; document.querySelectorAll("[data-pmode]").forEach(b => b.setAttribute("aria-pressed", b.dataset.pmode === st.mode)); return true; } }
  const qp = T.closest("[data-quickpay]"); if (qp) { const c = M.customers().find(x => x.key === qp.dataset.quickpay); if (c) confirmPay(c); return true; }
  const cu = T.closest("[data-cust]"); if (cu) { custSheet(cu.dataset.cust); return true; }
  const rp = T.closest("[data-rep]"); if (rp) { S.filter.rep = rp.dataset.rep; reportsSheet(); return true; }
  return false;
});

/* ---------- customers ---------- */
function customersSheet() {
  if (!guard("customers")) return;
  const q = (S.query.cust || "").toLowerCase();
  const cs = M.customers().filter(c => !q || (c.customer + " " + c.flat + " " + c.phone).toLowerCase().includes(q)).sort((a, b) => b.spend - a.spend);
  openSheet({ kind: "customers", redraw: customersSheet }, `<div class="sh-head"><h2 class="h">Customers</h2><button class="x" data-close aria-label="Close">×</button></div>
  <input class="search" data-search="cust" type="search" placeholder="Search customers" value="${esc(S.query.cust || "")}" style="width:100%">
  <ul class="list" style="padding:10px 0 0">${cs.map(c => `<li class="row">${plate(c.flat)}<button class="who" data-cust="${esc(c.key)}"><div class="nm">${esc(c.customer)}</div><div class="subl">${c.orders.length} order${c.orders.length > 1 ? "s" : ""} · last ${esc(dLabel(c.last))}${c.balance > 0 ? ` <span class="tag t-due">${rs(c.balance)} due</span>` : ""}</div></button><div class="amt">${rs(c.spend)}</div></li>`).join("") || `<div class="empty"><strong>No customers found</strong></div>`}</ul>`);
}
function custSheet(key) {
  const c = M.customers().find(x => x.key === key); if (!c) { closeSheet(); return; }
  const phone = R.can("phone");
  openSheet({ kind: "cust", key, redraw: () => custSheet(key) }, `<div class="sh-head">${plate(c.flat)}<h2 class="h">${esc(c.customer)}</h2><button class="x" data-close aria-label="Close">×</button></div>
  <div class="kpis" style="padding:0;margin-bottom:10px"><div class="kpi"><b>${rs(c.spend)}</b><span>${c.orders.length} orders</span></div><div class="kpi"><b style="color:${c.balance > 0 ? "var(--due)" : "var(--ok)"}">${rs(c.balance)}</b><span>balance</span></div></div>
  ${phone ? `<label class="f" for="cuPhone">Phone</label><div class="two"><input class="in" id="cuPhone" value="${esc(c.phone)}" placeholder="10-digit mobile" inputmode="tel"><button class="btn btn-ghost" style="margin:0;height:48px" data-act="savePhone">Save phone</button></div>` : ""}
  ${c.balance > 0 && R.can("pay.record") ? `<button class="btn btn-ok" data-quickpay="${esc(c.key)}">Mark paid · ${rs(c.balance)}</button>` : ""}
  ${c.balance > 0 && phone ? `<div class="btnrow"><a class="btn btn-wa" href="${esc(waHref(c.phone, reminderText(c)))}" target="_blank" rel="noopener">${ICON.wa}Send reminder</a><button class="btn btn-ghost" data-act="copyReminder">Copy reminder</button></div>` : ""}
  ${R.can("orders.edit") ? `<button class="btn btn-primary" data-act="orderForCust">${ICON.plus}New order for ${esc(c.customer.split(" ")[0])}</button>` : ""}
  <label class="f" style="margin-top:16px">Order history</label>
  <div class="kv">${c.orders.slice().reverse().map(o => `<div><button class="who" data-open="${esc(o.id)}"><div class="nm" style="font-size:15px">${esc(dLong(o.date))}</div><div class="subl">${o.items.map(i => esc(i.item) + " ×" + i.qty).join(", ")}</div></button><div class="side"><span class="amt">${rs(M.total(o))}</span>${payTag(o)}</div></div>`).join("")}</div>`);
}
const sheetCust = () => M.customers().find(x => x.key === (ui.sheet && ui.sheet.key));
A.customers = customersSheet;
A.orderForCust = () => { const c = sheetCust(); compose(null, { customer: c.customer, flat: c.flat, phone: c.phone, date: today() }); };
A.copyReminder = async () => toast(await copyText(reminderText(sheetCust())) ? "Reminder copied. Paste it in WhatsApp." : "Couldn’t copy here");
A.savePhone = async () => { const c = sheetCust(); const p = $("#cuPhone").value.trim(); for (const o of c.orders) if (o.phone !== p) await saveOrder({ ...o, phone: p }); toast("Phone saved"); custSheet(c.key); };

/* ---------- reports ---------- */
function reportsSheet() {
  if (!guard("reports")) return;
  const period = S.filter.rep || "month"; const t = today(); const cost = R.can("prices");
  const wk = addDays(t, -((dObj(t).getDay() + 6) % 7)); const mEnd = (() => { const d = dObj(t.slice(0, 8) + "01"); d.setMonth(d.getMonth() + 1); d.setDate(0); return t.slice(0, 8) + String(d.getDate()).padStart(2, "0"); })();
  const [start, end] = { week: [wk, addDays(wk, 6)], month: [t.slice(0, 8) + "01", mEnd], d30: [addDays(t, -29), t], all: ["0000", "9999"] }[period];
  const list = M.orders(false).filter(o => o.date >= start && o.date <= end);
  const sales = list.reduce((s, o) => s + M.total(o), 0), coll = list.reduce((s, o) => s + Math.min(M.received(o), M.total(o)), 0);
  const byDay = {}; list.forEach(o => byDay[o.date] = (byDay[o.date] || 0) + M.total(o)); const days = Object.keys(byDay).sort().slice(-31); const mx = Math.max(1, ...days.map(d => byDay[d]));
  const byChan = {}; list.forEach(o => byChan[o.channel] = (byChan[o.channel] || 0) + M.total(o));
  const items = {}; list.forEach(o => o.items.forEach(i => { const k = i.item; items[k] = items[k] || { q: 0, v: 0 }; items[k].q += i.qty; items[k].v += i.qty * i.rate * (1 - (o.discountPct || 0) / 100); }));
  let cogs = 0, costed = 0;
  Object.entries(items).forEach(([n, x]) => { const m = M.menuByName(n); if (m && (m.recipe || []).length) { x.cost = M.recipeCost(m).cost * x.q; cogs += x.cost; costed += x.v; } });
  const mv = M.moves().filter(m => m.date >= start && m.date <= end);
  const purchases = mv.filter(m => m.type === "purchase").reduce((s, m) => s + (+m.amount || 0), 0);
  const ings = Object.fromEntries(M.ingredients().map(i => [i.id, i]));
  const waste = mv.filter(m => m.type === "waste").reduce((s, m) => s + Math.abs(m.qty) * (ings[m.ingId] ? M.unitCost(ings[m.ingId]) : 0), 0);
  const cs = {}; list.filter(o => o.channel !== "walkin").forEach(o => { const k = M.ckey(o); cs[k] = cs[k] || { n: o.customer, f: o.flat, v: 0, c: 0 }; cs[k].v += M.total(o); cs[k].c++; });
  const repeat = Object.values(cs).filter(x => x.c > 1).length;
  const bt = M.batches().filter(b => b.date >= start && b.date <= end); const bPcs = bt.reduce((s, b) => s + M.batchPcs(b), 0), bSp = bt.reduce((s, b) => s + M.batchSpoiled(b), 0);
  openSheet({ kind: "reports", redraw: reportsSheet }, `<div class="sh-head"><h2 class="h">Sales & profit</h2><button class="x" data-close aria-label="Close">×</button></div>
  <div class="chips" style="margin-bottom:12px">${[["week", "This week"], ["month", "This month"], ["d30", "Last 30 days"], ["all", "All time"]].map(([k, l]) => `<button class="chip" data-rep="${k}" aria-pressed="${period === k}">${l}</button>`).join("")}</div>
  <div class="kpis" style="padding:0"><div class="kpi"><b>${rs(sales)}</b><span>sales · ${list.length} orders</span></div><div class="kpi"><b>${rs(sales - coll)}</b><span>still to collect</span></div>
  ${cost ? `<div class="kpi"><b>${rs(purchases)}</b><span>spent on stock</span></div><div class="kpi"><b>${costed ? Math.round((1 - cogs / costed) * 100) + "%" : "–"}</b><span>gross margin${costed && costed < sales ? " (costed items)" : ""}</span></div>
  <div class="kpi"><b>${rs(waste)}</b><span>wastage value</span></div>` : ""}<div class="kpi"><b>${repeat}</b><span>repeat customers</span></div><div class="kpi"><b>${bPcs - bSp}</b><span>good pieces baked · ${bt.length} batches${bSp ? ` · ${bSp} spoiled` : ""}</span></div></div>
  ${days.length ? `<div class="card" style="margin:10px 0"><h3>Sales by day</h3><div class="bars">${days.map(d => `<div class="b" title="${esc(dLong(d))}: ${rs(byDay[d])}"><small>${byDay[d] >= 1000 ? (byDay[d] / 1000).toFixed(1) + "k" : Math.round(byDay[d])}</small><i style="height:${byDay[d] / mx * 100}%"></i><small>${dObj(d).getDate()}/${dObj(d).getMonth() + 1}</small></div>`).join("")}</div></div>` : ""}
  <div class="card" style="margin:10px 0"><h3>Sales by channel</h3><table><tbody>${Object.entries(byChan).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<tr><td>${esc(M.CHANNELS[k] || k)}</td><td>${rs(v)}</td><td>${sales ? Math.round(v / sales * 100) : 0}%</td></tr>`).join("") || `<tr><td>No sales in this period</td></tr>`}</tbody></table></div>
  <div class="card" style="margin:10px 0"><h3>Best sellers</h3><table><thead><tr><th>Item</th><th>Qty</th><th>Sales</th>${cost ? "<th>Margin</th>" : ""}</tr></thead><tbody>${Object.entries(items).sort((a, b) => b[1].v - a[1].v).map(([n, x]) => `<tr><td>${esc(n)}</td><td>${x.q}</td><td>${rs(x.v)}</td>${cost ? `<td>${x.cost != null && x.v ? Math.round((1 - x.cost / x.v) * 100) + "%" : "–"}</td>` : ""}</tr>`).join("") || `<tr><td colspan="4">No sales in this period</td></tr>`}</tbody></table></div>
  ${cost ? `<p class="hint">Margin appears once an item has a recipe and its ingredients have prices.</p>` : ""}
  <div class="card" style="margin:10px 0"><h3>Top customers</h3><table><thead><tr><th>Customer</th><th>Orders</th><th>Spend</th></tr></thead><tbody>${Object.values(cs).sort((a, b) => b.v - a.v).slice(0, 10).map(x => `<tr><td>${esc(x.n)} <small class="mut">${esc(x.f)}</small></td><td>${x.c}</td><td>${rs(x.v)}</td></tr>`).join("") || `<tr><td colspan="3">No customers in this period</td></tr>`}</tbody></table></div>`);
}
A.reports = reportsSheet;
