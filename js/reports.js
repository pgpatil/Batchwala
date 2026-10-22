// Cost and stock reports: food cost, wastage, production variance, stock ageing, buying, tax, and a day-book export for the accountant.
import * as ev from "./events.js";
import * as M from "./model.js";
import * as R from "./roles.js";
import { asLines, layoutSwitch } from "./table.js";
import { S, A, V, H, chipBar, band } from "./core.js";
import { download } from "./data.js";
import { esc, rs, rs2, today, addDays, dLong, qty } from "./util.js";
import { toast } from "./ui.js";
import { periodBar, periodRange, periodLabel } from "./period.js";

const r2 = v => Math.round(v * 100) / 100;
const pct = (a, b) => b ? Math.round(a / b * 1000) / 10 + "%" : "–";
const card = (title, body, note = "") => `<div class="card" style="margin:10px 0"><h3>${title}</h3>${body}${note ? `<p class="hint">${note}</p>` : ""}</div>`;
const table = (head, rows, empty = "Nothing in this period.") => `<div class="tablecard"><table class="reg"><thead><tr>${head.map(h => `<th${h[1] ? ' class="r"' : ""}>${h[0]}</th>`).join("")}</tr></thead><tbody>${rows.join("") || `<tr><td colspan="${head.length}">${empty}</td></tr>`}</tbody></table></div>`;
const td = (v, right, sort) => `<td${right ? ' class="r"' : ""}${sort != null ? ` data-v="${esc(sort)}"` : ""}>${v}</td>`;

V.insights = () => {
  S.filter.ins = S.filter.ins || "cost"; const k = S.filter.ins; const [a, b] = periodRange("ins");
  let h = band("Cost & stock reports", "", `<p class="bandnote">${esc(periodLabel("ins"))}</p>`);
  h += `<div class="tools">${periodBar("ins")}</div><div class="tools" style="padding-top:0">${layoutSwitch("insights")}${chipBar("ins", [["cost", "Food cost"], ["pl", "Profit & loss"], ["value", "Stock value"], ["waste", "Wastage"], ["var", "Variance"], ["age", "Stock ageing"], ["buy", "Buying"], ["reorder", "Reorder"], ["tax", "Tax"], ["book", "Day book"]])}</div>`;
  return h + (({ cost, pl, value: valuation, waste, variance, age, buy, reorder, tax, book })[k === "var" ? "variance" : k] || cost)(a, b);
};

/* food cost: sales against the standard material cost of what was sold, by item */
function cost(a, b) {
  const list = M.orders(false).filter(o => o.date >= a && o.date <= b); const items = {}; const std = {};   // standard cost per item and recipe version
  // Each sale is costed with the recipe in force on its order date (recipe versions), at today's material costs.
  list.forEach(o => o.items.forEach(i => { const x = items[i.item] = items[i.item] || { q: 0, v: 0, c: 0, has: false }; x.q += i.qty; x.v += i.qty * i.rate * (1 - M.discF(o)) / (o.taxIncl && i.taxPct ? 1 + i.taxPct / 100 : 1);
    const m = M.menuByName(i.item); if (!m) return; const vk = m.id + "|" + ((m.versions || []).filter(v => v.until > o.date).map(v => v.until).sort()[0] || "now");
    if (!(vk in std)) { const rec = M.recipeAt(m, o.date); std[vk] = rec && (rec.recipe || []).length ? M.recipeCost(rec).cost : null; }
    if (std[vk] != null) { x.c += std[vk] * i.qty; x.has = true; } }));
  let sales = 0, cogs = 0, costed = 0; const rows = Object.entries(items).sort((x, y) => y[1].v - x[1].v).map(([n, x]) => { const c = x.has && x.q ? x.c / x.q : null;
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
    + (() => { const pr = M.priceRises(); return pr.length ? card(`Price rises in the last 30 days · ${pr.length}`, table([["Material"], ["GRN"], ["Supplier"], ["Now", 1], ["Before", 1], ["Rise", 1]], pr.map(x => { const i = ings[x.ingId]; if (!i) return ""; const [f, u] = big(i);
      return `<tr>${td(esc(i.name))}${td(esc(x.grn))}${td(esc(x.supplier))}${td(`${rs2(x.rate * f)}/${u}`, 1, x.rate)}${td(`${rs2(x.prev * f)}/${u}${x.prevSup !== x.supplier ? ` <small class="mut">${esc(x.prevSup)}</small>` : ""}`, 1, x.prev)}${td(`<b class="due">+${Math.round(x.ch * 10) / 10}%</b>`, 1, x.ch)}</tr>`; })), `Each GRN line that cost ${+(M.config().priceAlertPct ?? 5)}% or more above the material’s previous purchase. The threshold is in Reorder → Settings.`) : ""; })()
    + card("By supplier", table([["Supplier"], ["GRNs", 1], ["Spend", 1], ["Share", 1]], Object.entries(sup).sort((x, y) => y[1].v - x[1].v).map(([n, x]) => `<tr data-sup="${esc(n)}" tabindex="0">${td(esc(n))}${td(x.n, 1)}${td(rs(x.v), 1, x.v)}${td(pct(x.v, tot), 1, x.v / (tot || 1))}</tr>`)))
    + card("Price movement", table([["Material"], ["Last price", 1], ["Before", 1], ["Change", 1], ["From"]], Object.entries(hist).filter(([id]) => ings[id]).map(([id, h]) => { const i = ings[id]; const [f, u] = big(i); const l = h.at(-1), p = h.length > 1 ? h.at(-2) : null; const ch = p ? (l.r - p.r) / p.r * 100 : 0;
      return `<tr>${td(esc(i.name))}${td(`${rs2(l.r * f)}/${u}`, 1, l.r)}${td(p ? `${rs2(p.r * f)}/${u}` : "–", 1, p ? p.r : 0)}${td(p ? `<span class="${ch > 0 ? "due" : ""}">${ch > 0 ? "+" : ""}${Math.round(ch * 10) / 10}%</span>` : "–", 1, ch)}${td(esc(l.s))}</tr>`; }), "No GRNs yet."), "Each material’s last two GRN prices, before tax.");
}

/* tax: collected on sales against paid on purchases that can be claimed back */
function tax(a, b) {
  const months = {}; const m = d => d.slice(0, 7); const row = k => months[k] = months[k] || { out: 0, inp: 0, blocked: 0 }; const ings = M.ingMap();
  M.orders(false).filter(o => o.date >= a && o.date <= b).forEach(o => { row(m(o.date)).out += M.taxOf(o).tax; });
  M.grns().filter(g => !g.void && g.date >= a && g.date <= b).forEach(g => g.lines.forEach(l => { const t = (+l.amount || 0) * (+l.taxPct || 0) / 100; if (ings[l.ingId] && ings[l.ingId].taxInCost) row(m(g.date)).blocked += t; else row(m(g.date)).inp += t; }));
  M.preturns().filter(d => !d.void && d.date >= a && d.date <= b).forEach(d => d.lines.forEach(l => { const t = (+l.amount || 0) * (+l.taxPct || 0) / 100; if (ings[l.ingId] && ings[l.ingId].taxInCost) row(m(d.date)).blocked -= t; else row(m(d.date)).inp -= t; }));
  const ks = Object.keys(months).sort(); const T = M.taxCfg().name || "GST";
  const s = ks.reduce((x, k) => ({ out: x.out + months[k].out, inp: x.inp + months[k].inp }), { out: 0, inp: 0 });
  return `<div class="kpis" style="padding:0"><div class="kpi"><b>${rs2(s.out)}</b><span>${esc(T)} on sales</span></div><div class="kpi"><b>${rs2(s.inp)}</b><span>${esc(T)} on purchases to claim</span></div><div class="kpi"><b>${rs2(s.out - s.inp)}</b><span>net payable</span></div></div>`
    + card("By month", table([["Month"], ["On sales", 1], ["On purchases", 1], ["Not claimable", 1], ["Net", 1]], ks.map(k => { const x = months[k]; return `<tr>${td(esc(new Date(k + "-01T00:00:00").toLocaleDateString("en-IN", { month: "short", year: "numeric" })), 0, k)}${td(rs2(x.out), 1, x.out)}${td(rs2(x.inp), 1, x.inp)}${td(x.blocked ? rs2(x.blocked) : "–", 1, x.blocked)}${td(rs2(x.out - x.inp), 1, x.out - x.inp)}</tr>`; })),
      "A working summary for your accountant, not a return. Purchase tax on materials marked “not recoverable” is in their cost and isn’t claimed.")
    + hsnCard(a, b);
}

/* HSN-wise summary of sales (for GSTR-1's HSN table): quantity, taxable value and tax per HSN and rate */
function hsnRows(a, b) {
  const by = {}; const menu = M.menu(); const c = M.config(); const t = M.taxCfg();
  const add = (hsn, desc, uqc, q, r, taxable) => { const k = `${hsn}|${r}`; const x = by[k] = by[k] || { hsn, desc, uqc, q: 0, r, taxable: 0 }; x.q += q; x.taxable += taxable; };
  M.orders(false).filter(o => o.date >= a && o.date <= b).forEach(o => { const f = 1 - M.discF(o);
    o.items.forEach(i => { const m = (i.menuId && menu.find(x => x.id === i.menuId)) || M.menuByName(i.item) || {}; const r = +i.taxPct || 0; const g = i.qty * i.rate * f; add(m.hsn || c.hsn || "—", m.hsn ? (m.category || i.item) : "Goods", "NOS", i.qty, r, o.taxIncl ? g / (1 + r / 100) : g); });
    (o.charges || []).forEach(ch => { const r = +ch.taxPct || 0; add(c.sac || "—", "Charges (" + ch.name + ")", "OTH", 1, r, o.taxIncl ? ch.amount / (1 + r / 100) : ch.amount); }); });
  return Object.values(by).sort((x, y) => String(x.hsn).localeCompare(String(y.hsn)) || x.r - y.r).map(x => ({ ...x, tax: x.taxable * x.r / 100, split: t.split }));
}
function hsnCard(a, b) {
  const rows = hsnRows(a, b); const t = M.taxCfg(); if (!t.on) return "";
  return card("HSN-wise summary of sales", table([["HSN / SAC"], ["Description"], ["UQC"], ["Qty", 1], ["Rate", 1], ["Taxable value", 1], ...(t.split ? [["CGST", 1], ["SGST", 1]] : [[esc(t.name), 1]]), ["Total", 1]],
    rows.map(x => `<tr>${td(esc(x.hsn))}${td(esc(x.desc))}${td(x.uqc)}${td(x.q, 1, x.q)}${td(x.r + "%", 1, x.r)}${td(rs2(x.taxable), 1, x.taxable)}${t.split ? td(rs2(x.tax / 2), 1) + td(rs2(x.tax / 2), 1) : td(rs2(x.tax), 1)}${td(rs2(x.taxable + x.tax), 1)}</tr>`)),
    `HSN from each menu item (or the default in Business settings); delivery and packing charges under the SAC set there. ${rows.some(x => x.hsn === "—") ? `<b class="due">Some sales have no HSN; set it per item or a default.</b>` : ""} <button class="linkbtn" data-hsncsv>Download as Excel (CSV)</button>`);
}

/* reorder: levels from actual use and supplier lead times */
function reorder() {
  const c = M.config(); const plan = M.reorderPlan().filter(x => x.daily > 0 || x.now > 0).sort((x, y) => y.daily - x.daily); const sm = M.stockMap(); const admin = R.isAdmin(); const can = R.can("stock.buy");
  const big = i => i.unit === "pcs" ? [1, "pcs"] : [1000, i.unit === "g" ? "kg" : "L"]; const fmt = (i, v) => { const [f, u] = big(i); return `${Math.round(v / f * 100) / 100} ${u}`; };
  const off = plan.filter(x => x.daily > 0 && Math.abs(x.level - x.now) > Math.max(x.level, x.now) * 0.2);
  return `<div class="kpis" style="padding:0"><div class="kpi"><b>${plan.filter(x => x.daily > 0).length}</b><span>materials used in the last ${+c.useDays || 30} days</span></div><div class="kpi"><b class="${off.length ? "due" : ""}">${off.length}</b><span>reorder levels 20%+ off their use</span></div><div class="kpi"><b>${M.ingredients().filter(i => i.type !== "sf" && i.reorder && (sm[i.id] || 0) <= i.reorder).length}</b><span>below their level now</span></div></div>`
    + card("Suggested reorder levels", table([["", 0], ["Material"], ["Used / day", 1], ["Lead days", 1], ["Suggested level", 1], ["Level now", 1], ["Order size", 1], ["In stock", 1]],
      plan.map(x => `<tr${off.includes(x) ? ' class="shortrow"' : ""}>${td(can && x.daily > 0 ? `<input type="checkbox" data-rolv="${esc(x.i.id)}" ${off.includes(x) ? "checked" : ""} aria-label="Use suggested level for ${esc(x.i.name)}">` : "")}${td(esc(x.i.name))}${td(x.daily ? fmt(x.i, x.daily) : "–", 1, x.daily)}${td(x.lead, 1, x.lead)}${td(x.daily ? fmt(x.i, x.level) : "–", 1, x.level)}${td(x.now ? fmt(x.i, x.now) : "–", 1, x.now)}${td(x.daily ? fmt(x.i, x.order) : "–", 1, x.order)}${td(fmt(x.i, Math.max(0, sm[x.i.id] || 0)), 1, sm[x.i.id] || 0)}</tr>`), "No material has been used yet."),
      `Level = use per day × (the usual supplier’s lead time + ${+(c.safetyDays ?? 2)} safety days). Order size = ${+(c.coverDays ?? 7)} days of use. Set each supplier’s lead time on their page in Suppliers & payables.${can ? ` <button class="btn btn-primary" data-roapply style="margin-top:8px">Set the ticked reorder levels</button>` : ""}`)
    + (admin ? card("Settings", `<div class="two">${[["useDays", "Average use over (days)", 30], ["leadDays", "Lead time when the supplier has none", 2], ["safetyDays", "Safety days", 2], ["coverDays", "Days of use per order", 7], ["priceAlertPct", "Flag a price rise of (%)", 5]].map(([k, l, d]) => `<div><label class="f" for="ro_${k}">${l}</label><input class="in" id="ro_${k}" data-roset="${k}" inputmode="numeric" value="${esc(c[k] ?? d)}"></div>`).join("")}</div><button class="btn btn-ghost" data-rosave>Save settings</button>`) : "");
}

/* stock value at the end of the period, by location */
function valuation(a, b) {
  const locs = M.locations(); const T = ["rm", "pm", "sf"]; const by = locs.map(l => ({ l, rows: M.stockValueAt(b, l.id) }));
  const total = by.reduce((s, x) => s + x.rows.reduce((t, r) => t + r.value, 0), 0); const typeTot = k => by.reduce((s, x) => s + x.rows.filter(r => r.ing.type === k).reduce((t, r) => t + r.value, 0), 0);
  const fg = b === today() ? Object.entries(M.fgStock()).reduce((s, [, items]) => s + Object.entries(items).reduce((t, [n, q]) => { const m = M.menuByName(n); return t + (m && q > 0 ? q * M.recipeCost(m).cost : 0); }, 0), 0) : null;
  return `<div class="kpis" style="padding:0"><div class="kpi"><b>${rs(total)}</b><span>materials on ${esc(dLong(b))}</span></div>${T.map(k => `<div class="kpi"><b>${rs(typeTot(k))}</b><span>${esc(M.ING_TYPES[k].toLowerCase())}</span></div>`).join("")}${fg != null ? `<div class="kpi"><b>${rs(fg)}</b><span>finished goods at BOM cost</span></div>` : ""}</div>`
    + by.map(({ l, rows }) => card(`${esc(l.name)} · ${rs(rows.reduce((t, r) => t + r.value, 0))}`, table([["Material"], ["Type"], ["Qty", 1], ["Cost", 1], ["Value", 1]],
      rows.sort((x, y) => y.value - x.value).map(r => { const i = r.ing; const f = i.unit === "pcs" ? 1 : 1000; const u = i.unit === "pcs" ? "pc" : i.unit === "g" ? "kg" : "L";
        return `<tr>${td(esc(i.name))}${td(esc(M.ING_TYPES[i.type]))}${td(qty(r.qty, i.unit), 1, r.qty)}${td(`${rs2(r.cost * f)}/${u}`, 1, r.cost)}${td(r.qty < 0 ? `<span class="due">below zero</span>` : rs2(r.value), 1, r.value)}</tr>`; }), "No stock here."))).join("")
    + `<p class="hint">Quantities as they stood at the end of ${esc(dLong(b))}, valued at the ${M.costing() === "last" ? "last purchase price" : "weighted average cost"} on that day. Stock below zero counts as nothing. ${fg == null ? "Finished goods are valued only for today." : ""} <button class="linkbtn" data-valcsv>Download as Excel (CSV)</button></p>`;
}

/* profit and loss for the period: sales, materials used (opening + purchases − closing), gross profit, overheads, net */
const monthsIn = (a, b) => { const out = []; let m = (a <= "0001" ? (M.orders().map(o => o.date).sort()[0] || today()) : a).slice(0, 7); const e = b.slice(0, 7); while (m <= e && out.length < 120) { out.push(m); const [y, mo] = m.split("-").map(Number); m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`; } return out; };
function pl(a, b) {
  const start = a <= "0001" ? "0000-01-01" : a; let sales = 0, charges = 0;
  M.orders(false).filter(o => o.date >= start && o.date <= b).forEach(o => { const x = M.taxOf(o); const net = M.sub(o) - M.disc(o) + M.charges(o) - (o.taxIncl ? x.tax : 0); sales += net;
    charges += (o.charges || []).reduce((s, ch) => s + (o.taxIncl ? ch.amount / (1 + (+ch.taxPct || 0) / 100) : ch.amount), 0); });
  const returns = ev.all("creturns").filter(cn => !cn.void && cn.date >= start && cn.date <= b).reduce((s, cn) => s + (+cn.taxable || 0), 0); sales -= returns;
  const sum = rows => rows.reduce((s, r) => s + r.value, 0); const open = a <= "0001" ? 0 : sum(M.stockValueAt(addDays(a, -1))); const close = sum(M.stockValueAt(b));
  const buys = ev.all("moves").filter(m => m.type === "purchase" && m.date >= start && m.date <= b).reduce((s, m) => s + (+m.amount || 0), 0);
  const used = open + buys - close; const gross = sales - used; const months = monthsIn(a, b);
  const oh = months.map(m => ({ m, rec: ev.get("overheads", m) })); const ohTot = oh.reduce((s, x) => s + ((x.rec || {}).lines || []).reduce((t, l) => t + (+l.amount || 0), 0), 0); const net = gross - ohTot;
  const line = (l, v, cls = "") => `<div class="${cls}"><span>${l}</span><b>${v < 0 ? "−" : ""}${rs(Math.abs(v))}</b></div>`;
  const cur = months.at(-1); const rec = ev.get("overheads", cur) || { lines: [] };
  return `<div class="kpis" style="padding:0"><div class="kpi"><b>${rs(sales)}</b><span>sales before tax</span></div><div class="kpi"><b>${pct(gross, sales)}</b><span>gross margin</span></div><div class="kpi"><b class="${net < 0 ? "due" : ""}">${net < 0 ? "−" : ""}${rs(Math.abs(net))}</b><span>net profit</span></div></div>`
    + card("Profit and loss", `<div class="kv">${line("Sales (after discounts, before tax)", sales - charges + returns)}${returns ? line("Less sales returns (credit notes)", -returns) : ""}${charges ? line("Delivery and packing charges", charges) : ""}${line("<b>Income</b>", sales, "tot")}
      ${a <= "0001" ? "" : line("Opening stock of materials", open)}${line("Purchases (after returns)", buys)}${line("Less closing stock of materials", -close)}${line("<b>Materials used</b>", used, "tot")}
      ${line("<b>Gross profit</b>", gross, "tot")}${oh.flatMap(x => ((x.rec || {}).lines || []).map(l => line(`${esc(l.name)} <small class="mut">${esc(x.m)}</small>`, -l.amount))).join("")}${line("<b>Net profit</b>", net, "tot")}</div>`,
      "Materials used includes wastage, spoilage and stock-count differences. Finished goods on the shelf aren’t counted as stock (they keep only a few days). Overheads are what you enter below for each month; the app doesn’t track them otherwise.")
    + (R.isAdmin() || R.role() === "management" ? card(`Overheads for ${esc(new Date(cur + "-01T00:00:00").toLocaleDateString("en-IN", { month: "long", year: "numeric" }))}`,
      `<div class="kv">${(rec.lines || []).map((l, ix) => `<div style="align-items:center;gap:8px"><input class="in" data-ohname="${ix}" value="${esc(l.name)}" style="flex:1"><input class="in" data-ohamt="${ix}" inputmode="decimal" value="${l.amount || ""}" style="max-width:120px"></div>`).join("")}
       <div style="align-items:center;gap:8px"><input class="in" data-ohname="new" placeholder="Rent, salaries, power, gas…" style="flex:1"><input class="in" data-ohamt="new" inputmode="decimal" placeholder="₹" style="max-width:120px"></div></div>
       <button class="btn btn-ghost" data-ohsave="${esc(cur)}">Save overheads</button>`, "Blank an amount to remove that line.") : "");
}
const valRows = b => [["Location", "Material", "Type", "Qty", "Unit", "Cost per unit", "Value"], ...M.locations().flatMap(l => M.stockValueAt(b, l.id).map(r => [l.name, r.ing.name, M.ING_TYPES[r.ing.type], Math.round(r.qty * 1000) / 1000, r.ing.unit, Math.round(r.cost * 10000) / 10000, Math.round(r.value * 100) / 100]))];

/* day book in Tally's shape: vouchers with ledger entries, a Day Book listing, and Tally XML for masters and vouchers */
// Ledger names are set once to match the company in Tally; parties become Sundry Debtors / Sundry Creditors.
export const TALLY = { company: "", sales: "Sales", purchase: "Purchase", outTax: "Output GST", inTax: "Input GST", cash: "Cash", bank: "Bank", roundOff: "Round Off", walkin: "Counter Sales", charges: "Delivery & Packing Charges" };
const tcfg = () => ({ ...TALLY, ...(M.config().tally || {}) });
// A party named like one of the account ledgers ("Cash", "Sales") gets a suffix so it can't post into that ledger.
const partyName = (n, tag) => { const c = tcfg(); const x = String(n || "").trim(); return Object.entries(c).some(([k, v]) => k !== "company" && String(v).toLowerCase() === x.toLowerCase()) ? `${x} (${tag})` : x; };
const custLedger = o => o.channel === "walkin" || !o.customer ? tcfg().walkin : partyName(`${o.customer.trim()}${o.flat ? ` (${o.flat.trim()})` : ""}`, "customer");
// Tax ledgers per rate, split into central and state halves when bills split them: "Output CGST 2.5%".
function taxEntries(by, base, sign) { const t = M.taxCfg(); const out = [];
  Object.keys(by).sort((x, y) => x - y).forEach(r => { const v = r2(by[r]); if (!v) return; const nm = base.replace(/GST$/, "");
    if (t.split) { const h = r2(v / 2); out.push({ ledger: `${nm}CGST ${+r / 2}%`, amt: sign * h, tax: 1 }, { ledger: `${nm}SGST ${+r / 2}%`, amt: sign * r2(v - h), tax: 1 }); } else out.push({ ledger: `${base} ${+r}%`, amt: sign * v, tax: 1 }); });
  return out; }
// Each voucher: { date, type, no, party, narration, entries: [{ ledger, amt }] } with amt > 0 a debit and amt < 0 a credit; entries balance to zero.
export function vouchers(a, b) {
  const c = tcfg(); const out = []; const bankOf = mode => /cash/i.test(mode || "") ? c.cash : c.bank;
  M.orders(false).filter(o => o.date >= a && o.date <= b).forEach(o => { const x = M.taxOf(o); const total = M.total(o); const gross = M.sub(o) - M.disc(o) + M.charges(o); const taxable = r2(o.taxIncl ? gross - x.tax : gross);
    // Delivery and packing charges go to their own income ledger, before tax.
    const chT = r2((o.charges || []).reduce((s, ch) => s + (o.taxIncl ? ch.amount / (1 + (+ch.taxPct || 0) / 100) : ch.amount), 0));
    const party = custLedger(o); const ent = [{ ledger: party, amt: total }, { ledger: c.sales, amt: -r2(taxable - chT) }, ...(chT ? [{ ledger: c.charges, amt: -chT }] : []), ...taxEntries(x.by, c.outTax, -1)];
    const diff = r2(ent.reduce((s, e) => s + e.amt, 0)); if (diff) ent.push({ ledger: c.roundOff, amt: -diff });
    out.push({ date: o.date, type: "Sales", no: o.no, party, narration: `${M.chanLabel(o)} · ${o.items.map(i => i.item + " × " + i.qty).join(", ")}`, entries: ent }); });
  // A payment whose order was deleted still belongs to its customer (kept on the payment); otherwise it goes to an unallocated ledger to sort out.
  const custs = Object.fromEntries(M.customers(M.orders()).map(x => [x.key, x]));
  // Credit moved onto an order and off the customer's credit is within the same party, so it isn't a voucher.
  ev.all("payments").filter(p => p.date >= a && p.date <= b && +p.amount && p.mode !== "Credit" && p.mode !== "Credit note").forEach(p => { const raw = ev.get("orders", p.orderId); const o = M.normOrder(raw || {}); const cu = !raw && custs[p.customerKey];
    const party = raw ? custLedger(o) : cu ? custLedger({ customer: cu.customer, flat: cu.flat, channel: "whatsapp" }) : "Unallocated receipts"; const v = +p.amount;
    out.push({ date: p.date, type: "Receipt", no: "", party, narration: `Order #${o.no || "?"}${p.mode ? " · " + p.mode : ""}${v < 0 ? " · reversal" : ""}`, entries: [{ ledger: bankOf(p.mode), amt: v }, { ledger: party, amt: -v }] }); });
  const ings = M.ingMap();
  M.grns().filter(g => !g.void && g.date >= a && g.date <= b).forEach(g => { const rec = {}; let blocked = 0;
    g.lines.forEach(l => { const t = (+l.amount || 0) * (+l.taxPct || 0) / 100; if (!t) return; if (ings[l.ingId] && ings[l.ingId].taxInCost) blocked += t; else rec[l.taxPct] = (rec[l.taxPct] || 0) + t; });
    const ent = [{ ledger: c.purchase, amt: r2((+g.amount || 0) + blocked) }, ...taxEntries(rec, c.inTax, 1), { ledger: partyName(g.supplier, "supplier"), amt: -(+g.total || 0) }];
    const diff = r2(ent.reduce((s, e) => s + e.amt, 0)); if (diff) ent.push({ ledger: c.roundOff, amt: -diff });
    out.push({ date: g.date, type: "Purchase", no: g.invoiceNo || g.no, party: partyName(g.supplier, "supplier"), narration: `${g.no}${g.invoiceNo ? " · supplier invoice " + g.invoiceNo : ""}`, entries: ent }); });
  // Sales returns: a credit note reverses the sale for the lines returned (sales and output tax debited, the customer credited).
  ev.all("creturns").filter(cn => !cn.void && cn.date >= a && cn.date <= b).forEach(cn => { const by = {}; cn.lines.forEach(l => { if (!l.taxPct) return; const g = l.qty * l.rate; const o = ev.get("orders", cn.orderId) || {}; const t = o.taxIncl ? g - g / (1 + l.taxPct / 100) : g * l.taxPct / 100; by[l.taxPct] = (by[l.taxPct] || 0) + t; });
    const o = M.normOrder(ev.get("orders", cn.orderId) || { customer: cn.customer, flat: cn.flat, channel: "whatsapp" }); const party = custLedger(o);
    const ent = [{ ledger: c.sales, amt: r2(cn.taxable) }, ...taxEntries(by, c.outTax, 1), { ledger: party, amt: -cn.total }]; const diff = r2(ent.reduce((s, e) => s + e.amt, 0)); if (diff) ent.push({ ledger: c.roundOff, amt: -diff });
    out.push({ date: cn.date, type: "Credit Note", no: cn.no, party, narration: `${cn.no} · order #${cn.orderNo} · ${cn.reason || ""}`, entries: ent }); });
  // Goods returned: the supplier is debited, purchases and the input tax claimed on them are credited back.
  M.preturns().filter(d => !d.void && d.date >= a && d.date <= b).forEach(d => { const rec = {}; let blocked = 0;
    d.lines.forEach(l => { const t = (+l.amount || 0) * (+l.taxPct || 0) / 100; if (!t) return; if (ings[l.ingId] && ings[l.ingId].taxInCost) blocked += t; else rec[l.taxPct] = (rec[l.taxPct] || 0) + t; });
    const ent = [{ ledger: partyName(d.supplier, "supplier"), amt: +d.total || 0 }, { ledger: c.purchase, amt: -r2((+d.amount || 0) + blocked) }, ...taxEntries(rec, c.inTax, -1)];
    const diff = r2(ent.reduce((s, e) => s + e.amt, 0)); if (diff) ent.push({ ledger: c.roundOff, amt: -diff });
    out.push({ date: d.date, type: "Debit Note", no: d.no, party: partyName(d.supplier, "supplier"), narration: `${d.no}${d.grnNo ? " · against " + d.grnNo : ""}${d.reason ? " · " + d.reason : ""}`, entries: ent }); });
  M.spays().filter(p => p.date >= a && p.date <= b && +p.amount).forEach(p => { const v = +p.amount;
    out.push({ date: p.date, type: "Payment", no: "", party: partyName(p.supplier, "supplier"), narration: [p.mode, p.ref].filter(Boolean).join(" ") + (v < 0 ? " · reversal" : ""), entries: [{ ledger: partyName(p.supplier, "supplier"), amt: v }, { ledger: bankOf(p.mode), amt: -v }] }); });
  return out.sort((x, y) => x.date < y.date ? -1 : x.date > y.date ? 1 : 0);
}
// Day Book columns as Tally shows them: the party under Particulars, its amount as debit or credit.
const partyAmt = v => { const e = v.entries.find(x => x.ledger === v.party) || v.entries[0]; return e.amt; };
const tdate = d => new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" }).replace(/ /g, "-");
function bookRows(a, b) {
  return [["Date", "Particulars", "Vch Type", "Vch No.", "Debit Amount", "Credit Amount", "Narration"], ...vouchers(a, b).map(v => { const x = partyAmt(v); return [tdate(v.date), v.party, v.type, v.no, x > 0 ? r2(x) : "", x < 0 ? r2(-x) : "", v.narration]; })];
}
const xe = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const envelope = (report, body) => `<ENVELOPE>\n <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>\n <BODY><IMPORTDATA>\n  <REQUESTDESC><REPORTNAME>${report}</REPORTNAME>${tcfg().company ? `<STATICVARIABLES><SVCURRENTCOMPANY>${xe(tcfg().company)}</SVCURRENTCOMPANY></STATICVARIABLES>` : ""}</REQUESTDESC>\n  <REQUESTDATA>\n${body}  </REQUESTDATA>\n </IMPORTDATA></BODY>\n</ENVELOPE>\n`;
function vouchersXml(a, b) {
  return envelope("Vouchers", vouchers(a, b).map(v => `   <TALLYMESSAGE xmlns:UDF="TallyUDF">\n    <VOUCHER VCHTYPE="${v.type}" ACTION="Create" OBJVIEW="Accounting Voucher View">\n     <DATE>${v.date.replace(/-/g, "")}</DATE>\n     <VOUCHERTYPENAME>${v.type}</VOUCHERTYPENAME>\n${v.no ? `     <VOUCHERNUMBER>${xe(v.no)}</VOUCHERNUMBER>\n` : ""}     <PARTYLEDGERNAME>${xe(v.party)}</PARTYLEDGERNAME>\n     <NARRATION>${xe(v.narration)}</NARRATION>\n     <PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>\n`
    + v.entries.map(e => `     <ALLLEDGERENTRIES.LIST>\n      <LEDGERNAME>${xe(e.ledger)}</LEDGERNAME>\n      <ISDEEMEDPOSITIVE>${e.amt > 0 ? "Yes" : "No"}</ISDEEMEDPOSITIVE>\n      <AMOUNT>${(-e.amt).toFixed(2)}</AMOUNT>\n     </ALLLEDGERENTRIES.LIST>\n`).join("") + `    </VOUCHER>\n   </TALLYMESSAGE>\n`).join(""));
}
function mastersXml(a, b) {
  const c = tcfg(); const vs = vouchers(a, b); const groups = new Map(); const set = (n, g, extra = "") => { if (n && !groups.has(n)) groups.set(n, [g, extra]); };
  set(c.sales, "Sales Accounts"); set(c.purchase, "Purchase Accounts"); set(c.cash, "Cash-in-Hand"); set(c.bank, "Bank Accounts"); set(c.roundOff, "Indirect Expenses"); set(c.charges, "Indirect Incomes");
  vs.filter(v => ["Purchase", "Payment", "Debit Note"].includes(v.type)).forEach(v => { const s = M.supplierByName(v.party.replace(/ \(supplier\)$/, "")) || {}; set(v.party, "Sundry Creditors", s.gstin ? `<PARTYGSTIN>${xe(s.gstin)}</PARTYGSTIN>` : ""); });
  vs.filter(v => ["Sales", "Receipt"].includes(v.type)).forEach(v => set(v.party, v.party === "Unallocated receipts" ? "Suspense A/c" : "Sundry Debtors"));
  vs.forEach(v => v.entries.forEach(e => { if (e.tax) set(e.ledger, "Duties & Taxes"); }));
  return envelope("All Masters", [...groups].map(([n, [g, extra]]) => `   <TALLYMESSAGE xmlns:UDF="TallyUDF">\n    <LEDGER NAME="${xe(n)}" ACTION="Create">\n     <NAME.LIST><NAME>${xe(n)}</NAME></NAME.LIST>\n     <PARENT>${xe(g)}</PARENT>${["Sundry Debtors", "Sundry Creditors"].includes(g) ? "<ISBILLWISEON>No</ISBILLWISEON>" : ""}${extra}\n    </LEDGER>\n   </TALLYMESSAGE>\n`).join(""));
}
function saveText(name, text, type) { const blob = new Blob([text], { type }); const el = document.createElement("a"); el.href = URL.createObjectURL(blob); el.download = name; document.body.appendChild(el); el.click(); el.remove(); setTimeout(() => URL.revokeObjectURL(el.href), 2000); }
function book(a, b) {
  const vs = vouchers(a, b); const c = tcfg(); const by = {}; vs.forEach(v => { by[v.type] = (by[v.type] || 0) + 1; });
  const unbalanced = vs.filter(v => Math.abs(v.entries.reduce((s, e) => s + e.amt, 0)) > 0.005).length;
  return `<div class="kpis" style="padding:0">${["Sales", "Receipt", "Credit Note", "Purchase", "Payment", "Debit Note"].map(k => `<div class="kpi"><b>${by[k] || 0}</b><span>${k} vouchers</span></div>`).join("")}</div>`
    + card("Day Book", table([["Date"], ["Particulars"], ["Vch Type"], ["Vch No."], ["Debit", 1], ["Credit", 1]], vs.map(v => { const x = partyAmt(v);
      return `<tr>${td(esc(tdate(v.date)), 0, v.date)}${td(`<b>${esc(v.party)}</b><small class="mut" style="display:block">${v.entries.map(e => `${esc(e.ledger)} ${e.amt > 0 ? "Dr" : "Cr"} ${rs2(Math.abs(e.amt))}`).join(" · ")}</small>`)}${td(esc(v.type))}${td(esc(v.no))}${td(x > 0 ? rs2(x) : "", 1, x > 0 ? x : 0)}${td(x < 0 ? rs2(-x) : "", 1, x < 0 ? -x : 0)}</tr>`; })),
      `Laid out like Tally’s Day Book, with each voucher’s ledger entries under the party.${unbalanced ? ` <b class="due">${unbalanced} voucher(s) don’t balance.</b>` : " Every voucher balances (debits = credits)."}`)
    + card("Ledger names in Tally", `<div style="padding:0 14px 12px"><p class="hint" style="margin-top:0">Match these to the ledgers in your Tally company. Customers and suppliers are used by name (customers with their flat).</p>
      <div class="two">${[["company", "Company name (as in Tally)"], ["sales", "Sales ledger"], ["purchase", "Purchase ledger"], ["outTax", "Output tax prefix"], ["inTax", "Input tax prefix"], ["cash", "Cash ledger"], ["bank", "Bank ledger"], ["roundOff", "Round off ledger"], ["charges", "Delivery & packing charges ledger"], ["walkin", "Walk-in / counter party"]].map(([k, l]) => `<div><label class="f" for="tl_${k}">${l}</label><input class="in" id="tl_${k}" data-tally="${k}" value="${esc(c[k])}" ${R.isAdmin() ? "" : "disabled"}></div>`).join("")}</div>
      ${R.isAdmin() ? `<button class="btn btn-ghost" data-tallysave>Save ledger names</button>` : ""}</div>`)
    + `<div class="boardfoot">${R.can("export") ? `<div class="btnrow3"><button class="btn btn-primary" data-tallyxml="masters">Tally XML · ledgers</button><button class="btn btn-primary" data-tallyxml="vouchers">Tally XML · vouchers</button><button class="btn btn-ghost" data-daybook>Day Book (Excel)</button></div>` : `<p class="hint">Downloading needs the export permission.</p>`}
      <p class="hint">In Tally: import the ledgers first, then the vouchers (Gateway of Tally → Import → Masters, then Transactions; choose the XML file). Ledgers that already exist are left as they are. Sales and purchases come in as accounting vouchers with tax on their own ledgers, not item invoices.</p></div>`;
}
H.click.push(async T => {
  const [a, b] = periodRange("ins"); const tag = `${(M.config().business || "bakery").replace(/[^\w]+/g, "_")}_${a <= "0001" ? "all" : a}_${b}`;
  if (T.closest("[data-daybook],[data-tallyxml]") && !R.can("export")) { toast("Your role can’t export. Ask an admin."); return true; }
  if (T.closest("[data-daybook]")) { const rows = bookRows(a, b); download(`${tag}_daybook.csv`, rows); toast(`${rows.length - 1} vouchers downloaded`); return true; }
  const x = T.closest("[data-tallyxml]"); if (x) { const m = x.dataset.tallyxml === "masters"; saveText(`${tag}_tally_${m ? "ledgers" : "vouchers"}.xml`, m ? mastersXml(a, b) : vouchersXml(a, b), "application/xml"); toast(m ? "Ledgers XML downloaded" : `${vouchers(a, b).length} vouchers in XML`); return true; }
  if (T.closest("[data-hsncsv]")) { if (!R.can("export")) { toast("Your role can’t export"); return true; } download(`${tag}_hsn.csv`, [["HSN/SAC", "Description", "UQC", "Qty", "Rate %", "Taxable value", "Tax", "Total"], ...hsnRows(a <= "0001" ? "0000-01-01" : a, b).map(x => [x.hsn, x.desc, x.uqc, x.q, x.r, r2(x.taxable), r2(x.tax), r2(x.taxable + x.tax)])]); toast("HSN summary downloaded"); return true; }
  if (T.closest("[data-valcsv]")) { if (!R.can("export")) { toast("Your role can’t export"); return true; } const rows = valRows(b); download(`${tag}_stock_value.csv`, rows); toast(`${rows.length - 1} lines downloaded`); return true; }
  if (T.closest("[data-roapply]")) { if (!R.can("stock.buy")) return true; const plan = M.reorderPlan(); const ids = [...document.querySelectorAll("[data-rolv]:checked")].map(x => x.dataset.rolv); let n = 0;
    for (const id of ids) { const x = plan.find(y => y.i.id === id); if (!x || !x.daily) continue; const step = x.i.unit === "pcs" ? 1 : 100; const lvl = Math.ceil(x.level / step) * step; const { _at, _by, ...rec } = ev.get("ingredients", id); await ev.put("ingredients", { ...rec, reorder: lvl }); n++; }
    toast(n ? `${n} reorder level${n > 1 ? "s" : ""} set` : "Tick the materials to update"); H.render(); return true; }
  if (T.closest("[data-rosave]")) { if (!R.isAdmin()) return true; const c = { ...(ev.get("config", "app") || { id: "app" }) }; delete c._at; delete c._by;
    document.querySelectorAll("[data-roset]").forEach(el => { const v = Number(el.value); if (el.value.trim() !== "" && isFinite(v) && v >= 0) c[el.dataset.roset] = v; }); await ev.put("config", { ...c, id: "app" }); toast("Saved"); H.render(); return true; }
  const oh = T.closest("[data-ohsave]"); if (oh) { if (!(R.isAdmin() || R.role() === "management")) return true; const lines = [];
    document.querySelectorAll("[data-ohname]").forEach(el => { const k = el.dataset.ohname; const amt = Number((document.querySelector(`[data-ohamt="${k}"]`) || {}).value); if (el.value.trim() && amt > 0) lines.push({ name: el.value.trim(), amount: Math.round(amt * 100) / 100 }); });
    await ev.put("overheads", { id: oh.dataset.ohsave, lines }); toast("Overheads saved"); H.render(); return true; }
  if (T.closest("[data-tallysave]")) { if (!R.isAdmin()) return true; const t = { ...tcfg() }; document.querySelectorAll("[data-tally]").forEach(el => { t[el.dataset.tally] = el.value.trim() || TALLY[el.dataset.tally]; });
    const { _at, _by, ...cfg } = { ...(ev.get("config", "app") || { id: "app" }) }; await ev.put("config", { ...cfg, id: "app", tally: t }); toast("Ledger names saved"); return true; }
  return false;
});
A.insights = () => { S.view = "insights"; H.render(); window.scrollTo({ top: 0 }); };
