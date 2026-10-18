// Cost and stock reports: food cost, wastage, production variance, stock ageing, buying, tax, and a day-book export for the accountant.
import * as ev from "./events.js";
import * as M from "./model.js";
import * as R from "./roles.js";
import { S, A, V, H, chipBar, band } from "./core.js";
import { download } from "./data.js";
import { esc, rs, rs2, today, addDays, dLong, qty } from "./util.js";
import { toast } from "./ui.js";

const r2 = v => Math.round(v * 100) / 100;
const pct = (a, b) => b ? Math.round(a / b * 1000) / 10 + "%" : "–";
const PERIODS = { month: "This month", last: "Last month", d30: "Last 30 days", all: "All time" };
function range(k) { const t = today(); const m0 = t.slice(0, 8) + "01";
  if (k === "last") { const e = addDays(m0, -1); return [e.slice(0, 8) + "01", e]; }
  return [{ month: m0, d30: addDays(t, -29), all: "0000" }[k] || m0, t]; }
const card = (title, body, note = "") => `<div class="card" style="margin:10px 0"><h3>${title}</h3>${body}${note ? `<p class="hint">${note}</p>` : ""}</div>`;
const table = (head, rows, empty = "Nothing in this period.") => `<div class="tablecard"><table class="reg"><thead><tr>${head.map(h => `<th${h[1] ? ' class="r"' : ""}>${h[0]}</th>`).join("")}</tr></thead><tbody>${rows.join("") || `<tr><td colspan="${head.length}">${empty}</td></tr>`}</tbody></table></div>`;
const td = (v, right, sort) => `<td${right ? ' class="r"' : ""}${sort != null ? ` data-v="${esc(sort)}"` : ""}>${v}</td>`;

V.insights = () => {
  S.filter.ins = S.filter.ins || "cost"; S.filter.insp = S.filter.insp || "month"; const k = S.filter.ins; const [a, b] = range(S.filter.insp);
  let h = band("Cost & stock reports", "", `<p class="bandnote">${esc(dLong(a === "0000" ? (M.orders()[M.orders().length - 1] || {}).date || today() : a))} – ${esc(dLong(b))}</p>`);
  h += `<div class="tools">${chipBar("insp", Object.entries(PERIODS))}</div><div class="tools" style="padding-top:0">${chipBar("ins", [["cost", "Food cost"], ["waste", "Wastage"], ["var", "Variance"], ["age", "Stock ageing"], ["buy", "Buying"], ["tax", "Tax"], ["book", "Day book"]])}</div>`;
  return h + (({ cost, waste, variance, age, buy, tax, book })[k === "var" ? "variance" : k] || cost)(a, b);
};

/* food cost: sales against the standard material cost of what was sold, by item */
function cost(a, b) {
  const list = M.orders(false).filter(o => o.date >= a && o.date <= b); const items = {};
  list.forEach(o => o.items.forEach(i => { const x = items[i.item] = items[i.item] || { q: 0, v: 0 }; x.q += i.qty; x.v += i.qty * i.rate * (1 - (o.discountPct || 0) / 100) / (o.taxIncl && i.taxPct ? 1 + i.taxPct / 100 : 1); }));
  let sales = 0, cogs = 0, costed = 0; const rows = Object.entries(items).sort((x, y) => y[1].v - x[1].v).map(([n, x]) => { const m = M.menuByName(n); const c = m && (m.recipe || []).length ? M.recipeCost(m).cost : null;
    sales += x.v; if (c != null) { cogs += c * x.q; costed += x.v; }
    return `<tr>${td(esc(n))}${td(x.q, 1)}${td(rs(x.v), 1, x.v)}${td(c != null ? rs2(c) : "no BOM", 1, c ?? -1)}${td(c != null ? pct(c * x.q, x.v) : "–", 1, c != null && x.v ? c * x.q / x.v : -1)}</tr>`; });
  const bt = M.batches().filter(x => !x.void && x.date >= a && x.date <= b); const made = bt.reduce((s, x) => s + M.batchPcs(x) - M.batchSpoiled(x), 0), bc = bt.reduce((s, x) => s + M.batchCost(x), 0);
  return `<div class="kpis" style="padding:0"><div class="kpi"><b>${rs(sales)}</b><span>sales before tax</span></div><div class="kpi"><b>${pct(cogs, costed)}</b><span>food cost (standard)</span></div><div class="kpi"><b>${rs(bc)}</b><span>production cost · ${made} good pieces</span></div><div class="kpi"><b>${made ? rs2(bc / made) : "–"}</b><span>actual cost per piece</span></div></div>`
    + card("By item", table([["Item"], ["Sold", 1], ["Sales", 1], ["Cost / piece", 1], ["Food cost", 1]], rows), `Standard cost: today’s BOM at ${M.costing() === "avg" ? "weighted-average" : "last purchase"} material prices. Production cost comes from the batches actually made.`);
}

/* wastage: pieces spoiled or discarded, and materials written off */
function waste(a, b) {
  const bt = M.batches().filter(x => !x.void && x.date >= a && x.date <= b); const by = {};
  bt.forEach(x => x.lines.forEach(l => { const r = by[l.item] = by[l.item] || { made: 0, sp: 0, dis: 0 }; r.made += l.qty; r.sp += l.spoiled; r.dis += l.discarded; }));
  const ings = M.ingMap(); const mv = M.moves().filter(m => m.date >= a && m.date <= b); const wm = {}; let used = 0;
  mv.forEach(m => { const i = ings[m.ingId]; if (!i) return; const c = M.unitCost(i) * Math.abs(+m.qty || 0); if (m.type === "waste") { const x = wm[m.ingId] = wm[m.ingId] || { q: 0, v: 0 }; x.q += Math.abs(m.qty); x.v += c; } if (["bake", "issue"].includes(m.type)) used += m.qty < 0 ? c : -c; });
  const wv = Object.values(wm).reduce((s, x) => s + x.v, 0); const tm = Object.values(by).reduce((s, x) => s + x.made, 0), tl = Object.values(by).reduce((s, x) => s + x.sp + x.dis, 0);
  return `<div class="kpis" style="padding:0"><div class="kpi"><b>${pct(tl, tm)}</b><span>pieces lost · ${tl} of ${tm}</span></div><div class="kpi"><b>${rs(wv)}</b><span>materials written off · ${pct(wv, used + wv)} of use</span></div></div>`
    + card("Finished goods", table([["Item"], ["Made", 1], ["Spoiled", 1], ["Discarded", 1], ["Lost", 1]], Object.entries(by).sort((x, y) => (y[1].sp + y[1].dis) - (x[1].sp + x[1].dis)).map(([n, x]) => `<tr>${td(esc(n))}${td(x.made, 1)}${td(x.sp || "–", 1, x.sp)}${td(x.dis || "–", 1, x.dis)}${td(pct(x.sp + x.dis, x.made), 1, x.made ? (x.sp + x.dis) / x.made : 0)}</tr>`)), "Spoiled: lost while making. Discarded: past shelf life.")
    + card("Materials", table([["Material"], ["Wasted", 1], ["Value", 1]], Object.entries(wm).sort((x, y) => y[1].v - x[1].v).map(([id, x]) => `<tr>${td(esc(ings[id].name))}${td(qty(x.q, ings[id].unit), 1, x.q)}${td(rs2(x.v), 1, x.v)}</tr>`)));
}

/* variance: completed work orders, material by material */
function variance(a, b) {
  const bt = M.batches().filter(x => !x.void && x.wo && Array.isArray(x.variance) && x.date >= a && x.date <= b); const ings = M.ingMap(); const by = {};
  bt.forEach(x => x.variance.forEach(v => { const r = by[v.ingId] = by[v.ingId] || { std: 0, used: 0, cost: 0 }; r.std += v.std; r.used += v.used; r.cost += v.cost; }));
  const tot = Object.values(by).reduce((s, x) => s + x.cost, 0); const stdv = bt.reduce((s, x) => s + x.variance.reduce((t, v) => t + v.std * M.unitCost(ings[v.ingId] || { cost: 0 }), 0), 0);
  return `<div class="kpis" style="padding:0"><div class="kpi"><b class="${tot > 0 ? "due" : ""}">${tot >= 0 ? "+" : "−"}${rs(Math.abs(tot))}</b><span>material variance · ${bt.length} work order${bt.length === 1 ? "" : "s"}</span></div><div class="kpi"><b>${pct(tot, stdv)}</b><span>of standard cost</span></div><div class="kpi"><b>${Object.values(by).filter(x => Math.abs(x.used - x.std) > 1e-6).length}</b><span>materials off the BOM</span></div></div>`
    + card("By material", table([["Material"], ["Standard", 1], ["Used", 1], ["Difference", 1], ["Value", 1]], Object.entries(by).filter(([id]) => ings[id]).sort((x, y) => Math.abs(y[1].cost) - Math.abs(x[1].cost)).map(([id, x]) => { const i = ings[id]; const d = x.used - x.std;
      return `<tr>${td(esc(i.name))}${td(qty(x.std, i.unit), 1, x.std)}${td(qty(x.used, i.unit), 1, x.used)}${td(`${d > 0 ? "+" : d < 0 ? "−" : ""}${qty(Math.abs(d), i.unit)}`, 1, d)}${td(`<span class="${x.cost > 0 ? "due" : ""}">${x.cost >= 0 ? "" : "−"}${rs2(Math.abs(x.cost))}</span>`, 1, x.cost)}</tr>`; }), "No completed work orders in this period."),
      "Standard: the BOM for what was actually made. Used: issued less returned. Positive means more was used than the BOM allows.")
    + card("By work order", table([["Batch"], ["Date"], ["Made"], ["Variance", 1]], bt.map(x => { const v = x.variance.reduce((s, y) => s + y.cost, 0); return `<tr data-batch="${esc(x.id)}" tabindex="0">${td("#" + esc(x.no))}${td(esc(dLong(x.date)), 0, x.date)}${td(esc(M.batchText(x, ings)))}${td(`<span class="${v > 0 ? "due" : ""}">${v >= 0 ? "+" : "−"}${rs2(Math.abs(v))}</span>`, 1, v)}</tr>`; })));
}

/* stock ageing: material lots by age, and unsold finished goods */
function age(a, b) {
  const t = today(); const days = d => Math.round((new Date(t) - new Date(d)) / 864e5); const B = [["0–7 days", 7], ["8–30 days", 30], ["31–90 days", 90], ["Over 90 days", 1e9]]; const ings = M.ingMap();
  const lots = M.materialLots().filter(l => l.left > 0 && ings[l.ingId]); const sum = B.map(() => 0); lots.forEach(l => { const ix = B.findIndex(x => days(l.date) <= x[1]); sum[ix] += l.left * M.unitCost(ings[l.ingId]); });
  const fg = M.batchLots().filter(l => l.left > 0);
  return `<div class="kpis" style="padding:0">${B.map((x, i) => `<div class="kpi"><b>${rs(sum[i])}</b><span>${x[0]}</span></div>`).join("")}</div>`
    + card("Material lots on hand", table([["Material"], ["GRN"], ["Received"], ["Age", 1], ["Best before"], ["Left", 1], ["Value", 1]], lots.sort((x, y) => x.date < y.date ? -1 : 1).map(l => { const i = ings[l.ingId]; const v = l.left * M.unitCost(i);
      return `<tr>${td(esc(i.name))}${td(esc(l.grn.no))}${td(esc(dLong(l.date)), 0, l.date)}${td(days(l.date) + " d", 1, days(l.date))}${td(l.exp ? `${esc(dLong(l.exp))}${l.expired ? ` <span class="tag t-due">expired</span>` : l.soon ? ` <span class="tag t-part">soon</span>` : ""}` : "–", 0, l.exp || "9999")}${td(qty(l.left, i.unit), 1, l.left)}${td(rs2(v), 1, v)}</tr>`; }), "No stock received through GRNs yet."),
      "Stock is used oldest first, so what’s on hand sits in the newest lots. Stock from counts or older purchases without a GRN isn’t shown here.")
    + card("Unsold finished goods", table([["Item"], ["Batch"], ["Made"], ["Age", 1], ["Left", 1], ["Status"]], fg.sort((x, y) => x.date < y.date ? -1 : 1).map(l => `<tr>${td(esc(l.item))}${td("#" + esc(l.b.no))}${td(esc(dLong(l.date)), 0, l.date)}${td(days(l.date) + " d", 1, days(l.date))}${td(l.left, 1)}${td(l.expired ? `<span class="tag t-due">past shelf life</span>` : `good till ${esc(dLong(addDays(l.expires, -1)))}`)}</tr>`), "Nothing unsold."));
}

/* buying: spend by supplier and price movement by material */
function buy(a, b) {
  const g = M.grns().filter(x => !x.void && x.date >= a && x.date <= b); const ings = M.ingMap(); const sup = {};
  g.forEach(x => { const s = sup[x.supplier] = sup[x.supplier] || { n: 0, v: 0, tax: 0 }; s.n++; s.v += +x.total || 0; s.tax += +x.tax || 0; });
  const tot = g.reduce((s, x) => s + (+x.total || 0), 0); const hist = {};
  M.grns().filter(x => !x.void).slice().reverse().forEach(x => x.lines.forEach(l => { if (l.qty > 0 && l.amount > 0) (hist[l.ingId] = hist[l.ingId] || []).push({ d: x.date, r: l.amount / l.qty, s: x.supplier }); }));
  const big = i => i.unit === "pcs" ? [1, "pc"] : [1000, i.unit === "g" ? "kg" : "L"];
  return `<div class="kpis" style="padding:0"><div class="kpi"><b>${rs(tot)}</b><span>bought · ${g.length} GRNs</span></div><div class="kpi"><b>${Object.keys(sup).length}</b><span>suppliers</span></div><div class="kpi"><b>${rs(M.payables().reduce((s, x) => s + Math.max(0, x.balance), 0))}</b><span>owed now</span></div></div>`
    + card("By supplier", table([["Supplier"], ["GRNs", 1], ["Spend", 1], ["Share", 1]], Object.entries(sup).sort((x, y) => y[1].v - x[1].v).map(([n, x]) => `<tr data-sup="${esc(n)}" tabindex="0">${td(esc(n))}${td(x.n, 1)}${td(rs(x.v), 1, x.v)}${td(pct(x.v, tot), 1, x.v / (tot || 1))}</tr>`)))
    + card("Price movement", table([["Material"], ["Last price", 1], ["Before", 1], ["Change", 1], ["From"]], Object.entries(hist).filter(([id]) => ings[id]).map(([id, h]) => { const i = ings[id]; const [f, u] = big(i); const l = h.at(-1), p = h.length > 1 ? h.at(-2) : null; const ch = p ? (l.r - p.r) / p.r * 100 : 0;
      return `<tr>${td(esc(i.name))}${td(`${rs2(l.r * f)}/${u}`, 1, l.r)}${td(p ? `${rs2(p.r * f)}/${u}` : "–", 1, p ? p.r : 0)}${td(p ? `<span class="${ch > 0 ? "due" : ""}">${ch > 0 ? "+" : ""}${Math.round(ch * 10) / 10}%</span>` : "–", 1, ch)}${td(esc(l.s))}</tr>`; }), "No GRNs yet."), "Each material’s last two GRN prices, before tax.");
}

/* tax: collected on sales against paid on purchases that can be claimed back */
function tax(a, b) {
  const months = {}; const m = d => d.slice(0, 7); const row = k => months[k] = months[k] || { out: 0, inp: 0, blocked: 0 }; const ings = M.ingMap();
  M.orders(false).filter(o => o.date >= a && o.date <= b).forEach(o => { row(m(o.date)).out += M.taxOf(o).tax; });
  M.grns().filter(g => !g.void && g.date >= a && g.date <= b).forEach(g => g.lines.forEach(l => { const t = (+l.amount || 0) * (+l.taxPct || 0) / 100; if (ings[l.ingId] && ings[l.ingId].taxInCost) row(m(g.date)).blocked += t; else row(m(g.date)).inp += t; }));
  const ks = Object.keys(months).sort(); const T = M.taxCfg().name || "GST";
  const s = ks.reduce((x, k) => ({ out: x.out + months[k].out, inp: x.inp + months[k].inp }), { out: 0, inp: 0 });
  return `<div class="kpis" style="padding:0"><div class="kpi"><b>${rs2(s.out)}</b><span>${esc(T)} on sales</span></div><div class="kpi"><b>${rs2(s.inp)}</b><span>${esc(T)} on purchases to claim</span></div><div class="kpi"><b>${rs2(s.out - s.inp)}</b><span>net payable</span></div></div>`
    + card("By month", table([["Month"], ["On sales", 1], ["On purchases", 1], ["Not claimable", 1], ["Net", 1]], ks.map(k => { const x = months[k]; return `<tr>${td(esc(new Date(k + "-01T00:00:00").toLocaleDateString("en-IN", { month: "short", year: "numeric" })), 0, k)}${td(rs2(x.out), 1, x.out)}${td(rs2(x.inp), 1, x.inp)}${td(x.blocked ? rs2(x.blocked) : "–", 1, x.blocked)}${td(rs2(x.out - x.inp), 1, x.out - x.inp)}</tr>`; })),
      "A working summary for your accountant, not a return. Purchase tax on materials marked “not recoverable” is in their cost and isn’t claimed.");
}

/* day book: every voucher in the period, for the accountant */
function bookRows(a, b) {
  const rows = [["Date", "Voucher type", "Number", "Party", "Ledger", "Amount before tax", "Tax", "Total", "Mode / reference", "Note"]]; const T = M.taxCfg();
  M.orders(false).filter(o => o.date >= a && o.date <= b).forEach(o => { const t = M.taxOf(o).tax; const tot = M.total(o); rows.push([o.date, "Sales", o.no, o.customer || M.chanLabel(o), "Sales", r2(tot - t), t, tot, M.chanLabel(o), o.notes || ""]); });
  ev.all("payments").filter(p => p.date >= a && p.date <= b).forEach(p => { const o = ev.get("orders", p.orderId) || {}; rows.push([p.date, p.amount < 0 ? "Receipt reversal" : "Receipt", o.no || "", o.customer || "", p.mode === "cash" ? "Cash" : "Bank", "", "", +p.amount || 0, p.mode || "", ""]); });
  M.grns().filter(g => !g.void && g.date >= a && g.date <= b).forEach(g => rows.push([g.date, "Purchase", g.no, g.supplier, "Purchases", +g.amount || 0, +g.tax || 0, +g.total || 0, g.invoiceNo ? "Inv " + g.invoiceNo : "", g.notes || ""]));
  M.spays().filter(p => p.date >= a && p.date <= b).forEach(p => rows.push([p.date, p.amount < 0 ? "Payment reversal" : "Payment", "", p.supplier, p.mode === "Cash" ? "Cash" : "Bank", "", "", +p.amount || 0, [p.mode, p.ref].filter(Boolean).join(" "), ""]));
  return [rows[0], ...rows.slice(1).sort((x, y) => x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0)];
}
function book(a, b) {
  const rows = bookRows(a, b); const body = rows.slice(1); const by = {}; body.forEach(r => { by[r[1]] = (by[r[1]] || 0) + (+r[7] || 0); });
  return card("Vouchers in this period", table([["Type"], ["Count", 1], ["Total", 1]], Object.entries(by).map(([k, v]) => `<tr>${td(esc(k))}${td(body.filter(r => r[1] === k).length, 1)}${td(rs2(v), 1, v)}</tr>`)),
    "Sales, receipts, purchases (GRNs) and supplier payments with party, ledger and tax, one row per voucher. A CSV that opens in Excel; an accountant can map it into Tally or another books package (it isn’t Tally’s own import format).")
    + `<div class="boardfoot">${R.can("export") ? `<button class="btn btn-primary" data-daybook>Download day book (CSV)</button>` : `<p class="hint">Downloading needs the export permission.</p>`}</div>`;
}
H.click.push(T => {
  if (!T.closest("[data-daybook]")) return false; const [a, b] = range(S.filter.insp || "month"); const rows = bookRows(a, b);
  download(`${(M.config().business || "bakery").replace(/[^\w]+/g, "_")}_daybook_${a === "0000" ? "all" : a}_${b}.csv`, rows); toast(`${rows.length - 1} vouchers downloaded`); return true;
});
A.insights = () => { S.view = "insights"; H.render(); window.scrollTo({ top: 0 }); };
