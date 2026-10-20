// Analytics: dashboards per function (sales, production, buying, stock) with comparison to the previous period, and Explore,
// a slice-and-dice builder over the same data: pick a dataset, rows, optional columns, a measure and filters; save views for the team.
import * as ev from "./events.js";
import * as sync from "./sync.js";
import * as M from "./model.js";
import * as RL from "./roles.js";
import { S, V, H, chipBar, band } from "./core.js";
import { download } from "./data.js";
import { periodBar, periodRange, periodLabel, previous } from "./period.js";
import { esc, rs, uid, today, addDays, dObj } from "./util.js";
import { toast, ask, yesNo } from "./ui.js";

const r2 = v => Math.round(v * 100) / 100;
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const weekOf = d => addDays(d, -((dObj(d).getDay() + 6) % 7));
const monthName = m => new Date(m + "-01T00:00:00").toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
const timeDims = d => ({ day: d, week: weekOf(d), month: d.slice(0, 7), weekday: DOW[(dObj(d).getDay() + 6) % 7] });
const memName = id => (ev.get("members", id) || {}).name || "–";
const inR = (d, [a, b]) => d >= a && d <= b;

/* ---------- datasets: flat rows with dimensions and measures ---------- */
// Rows are built once per dataset, period and data change; every chart on a dashboard reads the same rows.
let rowStamp = "", rowCache = new Map(), stdCache = new Map();
function rowsOf(ds, R) { const st = ev.dataVersion() + "|" + today(); if (st !== rowStamp) { rowStamp = st; rowCache = new Map(); stdCache = new Map(); }
  const k = ds + "|" + R[0] + "|" + R[1]; if (!rowCache.has(k)) rowCache.set(k, DATA[ds].rows(R)); return rowCache.get(k); }
// Standard cost of one piece, for the recipe in force on the date (cached per item and recipe version).
function unitStd(m, date) { const v = (m.versions || []).filter(x => x.until > date).map(x => x.until).sort()[0] || "now"; const k = m.id + "|" + v;
  if (!stdCache.has(k)) { const rec = M.recipeAt(m, date); stdCache.set(k, rec && (rec.recipe || []).length ? M.recipeCost(rec).cost : 0); } return stdCache.get(k); }
// Each: label, dims [key, label], measures [key, label, kind] (kind: money / num / pct-able), rows(range).
const TIME = [["day", "Day"], ["week", "Week"], ["month", "Month"], ["weekday", "Weekday"]];
export const DATA = {
  sales: { label: "Sales lines", dims: [...TIME, ["hour", "Hour of day"], ["item", "Item"], ["category", "Category"], ["channel", "Channel"], ["customer", "Customer"], ["flat", "Flat / area"], ["location", "Location"], ["occasion", "Occasion"], ["coupon", "Coupon"], ["paid", "Payment state"], ["status", "Status"]],
    measures: [["net", "Net sales ₹", "money"], ["qty", "Pieces", "num"], ["gross", "Gross ₹", "money"], ["discount", "Discount ₹", "money"], ["tax", "Tax ₹", "money"], ["cost", "Standard cost ₹", "money"], ["margin", "Margin ₹", "money"], ["orders", "Orders", "count"]],
    rows(R) { const menu = M.menu(); const out = []; const home = M.locations()[0].id;
      M.orders(false).filter(o => inR(o.date, R)).forEach(o => { const f = 1 - M.discF(o); const tx = M.taxOf(o); const sub = M.sub(o) || 1; const hr = o.createdAt ? String(new Date(o.createdAt).getHours()).padStart(2, "0") + ":00" : "–";
        const base = { ...timeDims(o.date), hour: hr, channel: M.CHANNELS[o.channel] || o.channel, customer: o.channel === "walkin" ? "Walk-in" : o.customer, flat: o.flat || "–", location: M.locName(o.outletId || home), occasion: o.tag || "Regular", coupon: o.coupon || "None", paid: { paid: "Paid", part: "Part paid", due: "Due" }[M.payState(o)], status: M.STATUS_LABEL[o.status] || o.status, oid: o.id };
        o.items.forEach(i => { const m = (i.menuId && menu.find(x => x.id === i.menuId)) || M.menuByName(i.item); const g = i.qty * i.rate; const net = g * f; const share = g / sub;
          const cost = m ? unitStd(m, o.date) * i.qty : 0;
          const nx = o.taxIncl ? net - tx.tax * share : net;
          out.push({ ...base, item: i.item, category: (m && m.category) || "Uncategorised", qty: i.qty, gross: g, discount: g - net, net: nx, tax: tx.tax * share, cost, margin: cost ? nx - cost : 0 }); }); });
      return out; } },
  payments: { label: "Payments received", dims: [...TIME, ["mode", "Mode"], ["person", "Taken by"], ["kind", "Kind"]], measures: [["amount", "Amount ₹", "money"], ["count", "Payments", "count"]],
    rows(R) { return ev.all("payments").filter(p => inR(p.date || "", R) && p.mode !== "Credit").map(p => ({ ...timeDims(p.date), mode: p.mode || "–", person: memName(p._by), kind: !p.orderId ? (p.amount < 0 ? "Advance refunded / used" : "Advance") : p.amount < 0 ? "Reversal / refund" : "On an order", amount: +p.amount || 0, count: 1 })); } },
  production: { label: "Production (batches)", dims: [...TIME, ["item", "Item"], ["category", "Category"], ["location", "Location"], ["person", "Made by"]], measures: [["good", "Good pieces", "num"], ["made", "Pieces made", "num"], ["spoiled", "Spoiled", "num"], ["cost", "Cost ₹", "money"], ["batches", "Batches", "count"]],
    rows(R) { const out = []; const home = M.locations()[0].id;
      M.batches().filter(b => !b.void && inR(b.date, R)).forEach(b => { const pcs = M.batchPcs(b) || 1; const c = M.batchCost(b);
        b.lines.forEach(l => { const m = M.menuByName(l.item); out.push({ ...timeDims(b.date), item: l.item, category: (m && m.category) || "Uncategorised", location: M.locName(b.outletId || home), person: memName(b.madeBy || b._by), made: l.qty, spoiled: l.spoiled, good: l.qty - l.spoiled, cost: c * l.qty / pcs, bid: b.id }); }); });
      return out; } },
  purchases: { label: "Purchases (GRN lines)", dims: [...TIME, ["supplier", "Supplier"], ["material", "Material"], ["mcat", "Material category"], ["type", "Material type"], ["location", "Location"]], measures: [["amount", "Amount ₹", "money"], ["tax", "Tax ₹", "money"], ["total", "With tax ₹", "money"], ["qty", "Quantity (base unit)", "num"], ["grns", "GRNs", "count"]],
    rows(R) { const ings = M.ingMap(); const out = [];
      M.grns().filter(g => !g.void && inR(g.date, R)).forEach(g => g.lines.forEach(l => { const i = ings[l.ingId] || { name: "Removed", type: "rm" }; const t = (+l.amount || 0) * (+l.taxPct || 0) / 100;
        out.push({ ...timeDims(g.date), supplier: g.supplier, material: i.name, mcat: i.category || "Uncategorised", type: M.ING_TYPES[i.type] || i.type, location: M.locName(g.loc), amount: +l.amount || 0, tax: t, total: (+l.amount || 0) + t, qty: +l.qty || 0, gid: g.id }); }));
      return out; } },
  moves: { label: "Stock movements", dims: [...TIME, ["material", "Material"], ["mcat", "Material category"], ["type", "Material type"], ["move", "Movement"], ["location", "Location"]], measures: [["value", "Value ₹ (at today’s cost)", "money"], ["qty", "Quantity (base unit)", "num"], ["count", "Entries", "count"]],
    rows(R) { const ings = M.ingMap(); const home = M.locations()[0].id; const NAME = { purchase: "Purchase / return", bake: "Used in batches", issue: "Issued to work orders", return: "Returned from work orders", waste: "Wastage", count: "Count difference", adjust: "Adjustment", transfer: "Transfer", make: "Made (semi-finished)" };
      return ev.all("moves").filter(m => inR(m.date || "", R)).map(m => { const i = ings[m.ingId] || { name: "Removed", type: "rm" }; const c = ings[m.ingId] ? M.unitCost(i) : 0;
        return { ...timeDims(m.date), material: i.name, mcat: i.category || "Uncategorised", type: M.ING_TYPES[i.type] || i.type, move: NAME[m.type] || m.type, location: M.locName(m.outletId || home), qty: +m.qty || 0, value: (+m.qty || 0) * c, count: 1 }; }); } }
};
const DISTINCT = { sales: { orders: "oid" }, production: { batches: "bid" }, purchases: { grns: "gid" } };

/* ---------- pivot ---------- */
// spec: { ds, rows, cols, measure, agg (sum | avg), filters: { dim: [values] }, top, sort (value | label) }
export function pivot(spec, range) {
  const d = DATA[spec.ds]; let rows = rowsOf(spec.ds, range); const fl = spec.filters || {};
  Object.entries(fl).forEach(([k, vs]) => { if (vs && vs.length) rows = rows.filter(r => vs.includes(String(r[k]))); });
  const dk = (DISTINCT[spec.ds] || {})[spec.measure]; const cnt = spec.measure === "count";
  const cell = () => ({ s: 0, n: 0, set: dk ? new Set() : null });
  const add = (c, r) => { c.n++; if (dk) c.set.add(r[dk]); else c.s += cnt ? 1 : (+r[spec.measure] || 0); };
  const val = c => !c ? 0 : dk ? c.set.size : spec.agg === "avg" ? (c.n ? c.s / c.n : 0) : c.s;
  const byRow = new Map(), colKeys = new Set(), tot = cell(), colTot = new Map();
  rows.forEach(r => { const rk = String(r[spec.rows] ?? "–"); const ck = spec.cols ? String(r[spec.cols] ?? "–") : "";
    if (!byRow.has(rk)) byRow.set(rk, { all: cell(), cols: new Map() }); const x = byRow.get(rk); add(x.all, r); add(tot, r);
    if (spec.cols) { colKeys.add(ck); if (!x.cols.has(ck)) x.cols.set(ck, cell()); add(x.cols.get(ck), r); if (!colTot.has(ck)) colTot.set(ck, cell()); add(colTot.get(ck), r); } });
  const timeLike = ["day", "week", "month", "hour"].includes(spec.rows); const wd = spec.rows === "weekday";
  let list = [...byRow.entries()].map(([k, x]) => ({ key: k, v: val(x.all), cols: x.cols }));
  if (timeLike || spec.sort === "label") list.sort((a, b) => a.key < b.key ? -1 : 1); else if (wd) list.sort((a, b) => DOW.indexOf(a.key) - DOW.indexOf(b.key)); else list.sort((a, b) => b.v - a.v);
  let other = null; const top = +spec.top || 0;
  if (top && !timeLike && !wd && list.length > top) { const rest = list.slice(top); list = list.slice(0, top); if (spec.agg !== "avg" && !dk) other = { key: `Others (${rest.length})`, v: rest.reduce((s, x) => s + x.v, 0), cols: new Map() }; }
  // Columns: in time order for time dimensions, otherwise the biggest 12.
  const cks = ["day", "week", "month", "hour"].includes(spec.cols) ? [...colKeys].sort() : spec.cols === "weekday" ? DOW.filter(d => colKeys.has(d)) : [...colKeys].sort((a, b) => val(colTot.get(b)) - val(colTot.get(a))).slice(0, 12);
  return { list: other ? [...list, other] : list, cols: cks, colVal: (row, ck) => val(row.cols.get(ck)), colTot: ck => val(colTot.get(ck)), total: val(tot), n: rows.length, kind: (d.measures.find(m => m[0] === spec.measure) || [])[2] };
}
const fmtV = (v, kind) => kind === "money" ? rs(v) : (Math.round(v * 100) / 100).toLocaleString("en-IN");
const labelOf = (dim, k) => dim === "week" ? `w/c ${new Date(k + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })}` : dim === "month" ? monthName(k) : dim === "day" ? new Date(k + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : k;

/* ---------- charts (inline SVG / CSS, no library) ---------- */
function hbars(items, kind, max = 12) {
  const xs = items.slice(0, max); const mx = Math.max(1e-9, ...xs.map(x => Math.abs(x.v)));
  return xs.length ? `<div class="hbars">${xs.map(x => `<div class="hb"><span class="hl" title="${esc(x.label)}">${esc(x.label)}</span><span class="hbar"><i style="width:${Math.max(1, Math.abs(x.v) / mx * 100)}%${x.v < 0 ? ";background:var(--due)" : ""}"></i></span><b>${fmtV(x.v, kind)}</b></div>`).join("")}</div>` : `<p class="hint">Nothing in this period.</p>`;
}
function line(points, kind, prev = null) {
  if (points.length < 2) return hbars(points, kind);
  const W = 640, Hh = 160, P = 28; const all = [...points.map(p => p.v), ...(prev || []).map(p => p.v)]; const mx = Math.max(1e-9, ...all), mn = Math.min(0, ...all);
  const xy = (arr) => arr.map((p, i) => `${(P + i * (W - P * 2) / Math.max(1, arr.length - 1)).toFixed(1)},${(Hh - P / 2 - (p.v - mn) / (mx - mn) * (Hh - P * 1.5)).toFixed(1)}`).join(" ");
  const ticks = [0, Math.floor((points.length - 1) / 2), points.length - 1];
  return `<svg class="aline" viewBox="0 0 ${W} ${Hh + 14}" role="img" aria-label="Trend"><line x1="${P}" x2="${W - P}" y1="${Hh - P / 2}" y2="${Hh - P / 2}" class="ax"/>
    ${prev && prev.length > 1 ? `<polyline points="${xy(prev)}" class="pv"/>` : ""}<polyline points="${xy(points)}" class="cu"/>
    ${points.map((p, i) => `<circle cx="${(P + i * (W - P * 2) / Math.max(1, points.length - 1)).toFixed(1)}" cy="${(Hh - P / 2 - (p.v - mn) / (mx - mn) * (Hh - P * 1.5)).toFixed(1)}" r="2.6" class="cu"><title>${esc(p.label)}: ${fmtV(p.v, kind)}</title></circle>`).join("")}
    ${ticks.map(i => `<text x="${(P + i * (W - P * 2) / Math.max(1, points.length - 1)).toFixed(1)}" y="${Hh + 10}" text-anchor="middle">${esc(points[i].label)}</text>`).join("")}<text x="${P}" y="12">${fmtV(mx, kind)}</text></svg>
    ${prev ? `<p class="hint lg"><i class="sw cu"></i> this period <i class="sw pv"></i> previous period</p>` : ""}`;
}
const pv = (spec, R) => pivot(spec, R);
const series = (spec, R) => pv(spec, R).list.map(x => ({ label: labelOf(spec.rows, x.key), v: x.v }));
const card = (title, body, wide = false) => `<div class="card acard${wide ? " wide" : ""}"><h3>${title}</h3>${body}</div>`;
// A headline number with its change against the same length of time just before.
function kpi(label, cur, prv, kind = "money", goodUp = true) {
  const d = prv ? (cur - prv) / Math.abs(prv) * 100 : null; const up = d != null && d >= 0;
  return `<div class="kpi"><b>${kind === "pct" ? (Math.round(cur * 10) / 10) + "%" : fmtV(cur, kind)}</b><span>${esc(label)}</span>${d != null && isFinite(d) ? (Math.abs(d) < 0.5 ? `<small class="mut">≈ same as previous</small>` : `<small class="${up === goodUp ? "good" : "bad"}">${up ? "▲" : "▼"} ${Math.abs(Math.round(d))}% vs previous</small>`) : ""}</div>`;
}
const sum = (ds, m, R, f) => { let rows = rowsOf(ds, R); if (f) rows = rows.filter(f); return rows.reduce((s, r) => s + (+r[m] || 0), 0); };
const distinct = (ds, k, R) => new Set(rowsOf(ds, R).map(r => r[k])).size;
const grain = R => { const n = Math.round((dObj(R[1]) - dObj(R[0] <= "0001" ? (M.orders().map(o => o.date).sort()[0] || R[1]) : R[0])) / 864e5); return n > 120 ? "month" : n > 35 ? "week" : "day"; };

/* ---------- dashboards ---------- */
function overview(R, P) {
  const net = sum("sales", "net", R), netP = P && sum("sales", "net", P); const ord = distinct("sales", "oid", R), ordP = P && distinct("sales", "oid", P);
  const cost = sum("sales", "cost", R), costed = sum("sales", "net", R, r => r.cost > 0); const costP = P && sum("sales", "cost", P), costedP = P && sum("sales", "net", P, r => r.cost > 0);
  const good = sum("production", "good", R), made = sum("production", "made", R), madeP = P && sum("production", "made", P), spoilP = P && sum("production", "spoiled", P);
  const buy = sum("purchases", "amount", R), buyP = P && sum("purchases", "amount", P); const waste = -sum("moves", "value", R, r => r.move === "Wastage"), wasteP = P && -sum("moves", "value", P, r => r.move === "Wastage");
  const coll = sum("payments", "amount", R), collP = P && sum("payments", "amount", P);
  const g = grain(R);
  return `<div class="kpis" style="padding:0">${kpi("net sales", net, netP)}${kpi("orders", ord, ordP, "num")}${kpi("average order", ord ? net / ord : 0, ordP ? netP / ordP : 0)}${costed ? kpi("gross margin (costed items)", (1 - cost / costed) * 100, costedP ? (1 - costP / costedP) * 100 : null, "pct") : ""}
    ${kpi("money received", coll, collP)}${kpi("pieces made", made, madeP, "num")}${made ? kpi("spoiled", (made - good) / made * 100, madeP ? spoilP / madeP * 100 : null, "pct", false) : ""}${kpi("bought", buy, buyP, "money", false)}${kpi("wastage", waste, wasteP, "money", false)}</div>
    <div class="agrid">${card(`Sales by ${g}`, line(series({ ds: "sales", rows: g, measure: "net" }, R), "money", P ? series({ ds: "sales", rows: g, measure: "net" }, P) : null), true)}
    ${card("Sales by channel", hbars(series({ ds: "sales", rows: "channel", measure: "net" }, R), "money"))}${card("Best sellers", hbars(series({ ds: "sales", rows: "item", measure: "net", top: 10 }, R), "money"))}
    ${card("Spend by supplier", hbars(series({ ds: "purchases", rows: "supplier", measure: "amount", top: 8 }, R), "money"))}${card("Wastage by material", hbars(series({ ds: "moves", rows: "material", measure: "value", filters: { move: ["Wastage"] }, top: 8 }, R).map(x => ({ ...x, v: -x.v })), "money"))}</div>`;
}
function sales(R, P) {
  const g = grain(R); const rows = rowsOf("sales", R); const cust = {}; rows.forEach(r => { if (r.customer !== "Walk-in") cust[r.customer + "|" + r.flat] = 1; });
  const firstSeen = {}; M.orders(false).forEach(o => { if (o.channel === "walkin") return; const k = o.customer + "|" + (o.flat || "–"); if (!firstSeen[k] || o.date < firstSeen[k]) firstSeen[k] = o.date; });
  const newC = Object.keys(cust).filter(k => firstSeen[k] >= R[0]).length; const disc = rows.reduce((s, r) => s + r.discount, 0);
  return `<div class="kpis" style="padding:0">${kpi("net sales", sum("sales", "net", R), P && sum("sales", "net", P))}${kpi("pieces sold", sum("sales", "qty", R), P && sum("sales", "qty", P), "num")}${kpi("customers who ordered", Object.keys(cust).length, null, "num")}${kpi("new customers", newC, null, "num")}${kpi("discounts given", disc, P && sum("sales", "discount", P), "money", false)}</div>
    <div class="agrid">${card(`Net sales by ${g}`, line(series({ ds: "sales", rows: g, measure: "net" }, R), "money", P ? series({ ds: "sales", rows: g, measure: "net" }, P) : null), true)}
    ${card("By weekday", hbars(series({ ds: "sales", rows: "weekday", measure: "net" }, R), "money"))}${card("By hour of day (counter and orders)", hbars(series({ ds: "sales", rows: "hour", measure: "net" }, R), "money", 24))}
    ${card("By category", hbars(series({ ds: "sales", rows: "category", measure: "net" }, R), "money"))}${card("Margin by item (standard cost)", hbars(series({ ds: "sales", rows: "item", measure: "margin", top: 10 }, R), "money"))}
    ${card("Top customers", hbars(series({ ds: "sales", rows: "customer", measure: "net", top: 10, filters: {} }, R).filter(x => x.label !== "Walk-in"), "money"))}${card("Payments by mode", hbars(series({ ds: "payments", rows: "mode", measure: "amount" }, R), "money"))}
    ${card("Occasions and coupons", hbars([...series({ ds: "sales", rows: "occasion", measure: "net" }, R), ...series({ ds: "sales", rows: "coupon", measure: "discount" }, R).filter(x => x.label !== "None").map(x => ({ ...x, label: "Coupon " + x.label + " (discount)" }))], "money"))}</div>`;
}
function production(R, P) {
  const g = grain(R); const made = sum("production", "made", R), sp = sum("production", "spoiled", R); const cost = sum("production", "cost", R), good = made - sp;
  const items = pv({ ds: "production", rows: "item", measure: "made" }, R).list.map(x => { const s = pv({ ds: "production", rows: "item", measure: "spoiled", filters: { item: [x.key] } }, R).total; return { label: x.key, v: x.v ? s / x.v * 100 : 0 }; }).filter(x => x.v > 0).sort((a, b) => b.v - a.v);
  const cpp = pv({ ds: "production", rows: "item", measure: "cost" }, R).list.map(x => { const gd = pv({ ds: "production", rows: "item", measure: "good", filters: { item: [x.key] } }, R).total; return { label: x.key, v: gd ? x.v / gd : 0 }; }).filter(x => x.v > 0);
  const wos = ev.all("wos").filter(w => w.status === "done" && inR(w.date, R)); const vby = {}; const ings = M.ingMap();
  wos.forEach(w => (w.variance || []).forEach(v => { const n = (ings[v.ingId] || {}).name || "?"; vby[n] = (vby[n] || 0) + (+v.cost || 0); }));
  return `<div class="kpis" style="padding:0">${kpi("pieces made", made, P && sum("production", "made", P), "num")}${kpi("spoiled", made ? sp / made * 100 : 0, null, "pct", false)}${kpi("production cost", cost, P && sum("production", "cost", P), "money", false)}${kpi("cost per good piece", good ? cost / good : 0, null, "money", false)}${kpi("batches", distinct("production", "bid", R), P && distinct("production", "bid", P), "num")}</div>
    <div class="agrid">${card(`Pieces made by ${g}`, line(series({ ds: "production", rows: g, measure: "made" }, R), "num", P ? series({ ds: "production", rows: g, measure: "made" }, P) : null), true)}
    ${card("Made by item", hbars(series({ ds: "production", rows: "item", measure: "good", top: 12 }, R), "num"))}${card("Spoilage % by item", hbars(items.map(x => ({ ...x, v: Math.round(x.v * 10) / 10 })), "num"))}
    ${card("Cost per good piece (₹)", hbars(cpp.sort((a, b) => b.v - a.v).map(x => ({ ...x, v: r2(x.v) })), "money"))}${card("Work-order material variance", hbars(Object.entries(vby).map(([label, v]) => ({ label, v })).sort((a, b) => Math.abs(b.v) - Math.abs(a.v)), "money"))}
    ${card("By who made it", hbars(series({ ds: "production", rows: "person", measure: "made" }, R), "num"))}</div>`;
}
function buying(R, P) {
  const g = grain(R); const grns = M.grns().filter(x => !x.void && inR(x.date, R)); const pos = Object.fromEntries(M.porders().map(p => [p.id, p]));
  const onTime = {}; grns.filter(x => x.poId && pos[x.poId] && pos[x.poId].expected).forEach(x => { const s = onTime[x.supplier] = onTime[x.supplier] || { n: 0, ok: 0, late: 0 }; s.n++; const d = Math.round((dObj(x.date) - dObj(pos[x.poId].expected)) / 864e5); if (d <= 0) s.ok++; else s.late += d; });
  const dn = M.preturns().filter(d => !d.void && inR(d.date, R)); const ret = {}; dn.forEach(d => { ret[d.reason || "Other"] = (ret[d.reason || "Other"] || 0) + d.total; });
  const pr = M.priceRises(Math.max(1, Math.round((dObj(R[1]) - dObj(R[0] <= "0001" ? "2020-01-01" : R[0])) / 864e5) + 1));
  return `<div class="kpis" style="padding:0">${kpi("bought (before tax)", sum("purchases", "amount", R), P && sum("purchases", "amount", P), "money", false)}${kpi("GRNs", distinct("purchases", "gid", R), P && distinct("purchases", "gid", P), "num")}${kpi("suppliers", new Set(grns.map(x => x.supplier)).size, null, "num")}${kpi("returned", dn.reduce((s, d) => s + d.total, 0), null, "money", false)}${kpi("price rises", pr.length, null, "num", false)}</div>
    <div class="agrid">${card(`Spend by ${g}`, line(series({ ds: "purchases", rows: g, measure: "amount" }, R), "money", P ? series({ ds: "purchases", rows: g, measure: "amount" }, P) : null), true)}
    ${card("By supplier", hbars(series({ ds: "purchases", rows: "supplier", measure: "amount", top: 10 }, R), "money"))}${card("By material category", hbars(series({ ds: "purchases", rows: "mcat", measure: "amount" }, R), "money"))}
    ${card("Top materials", hbars(series({ ds: "purchases", rows: "material", measure: "amount", top: 10 }, R), "money"))}
    ${card("On-time delivery against POs", Object.keys(onTime).length ? hbars(Object.entries(onTime).map(([label, s]) => ({ label: `${label} · ${s.n} GRN${s.n > 1 ? "s" : ""}${s.late ? ` · ${s.late} days late in all` : ""}`, v: Math.round(s.ok / s.n * 100) })), "num") + `<p class="hint">% of GRNs on or before the PO’s expected date.</p>` : `<p class="hint">No GRNs against POs with an expected date in this period.</p>`)}
    ${card("Returns by reason", hbars(Object.entries(ret).map(([label, v]) => ({ label, v })), "money"))}${card("Price rises", hbars(pr.slice(0, 10).map(x => ({ label: `${(M.ingMap()[x.ingId] || {}).name || "?"} · ${x.supplier}`, v: Math.round(x.ch * 10) / 10 })), "num") + (pr.length ? `<p class="hint">% above the previous purchase.</p>` : ""))}</div>`;
}
function stock(R) {
  const now = M.stockValueAt(today()); const byType = {}; now.forEach(r => { const k = M.ING_TYPES[r.ing.type]; byType[k] = (byType[k] || 0) + r.value; });
  const byLoc = M.locations().map(l => ({ label: l.name, v: M.stockValueAt(today(), l.id).reduce((s, r) => s + r.value, 0) }));
  const use = M.dailyUse(30); const sm = M.stockMap(); const ings = M.ingredients().filter(i => i.type !== "sf");
  const cover = ings.filter(i => use[i.id] > 0).map(i => ({ label: i.name, v: Math.round(Math.max(0, sm[i.id] || 0) / use[i.id] * 10) / 10 })).sort((a, b) => a.v - b.v);
  const moved = new Set(ev.all("moves").filter(m => inR(m.date || "", R) && ["bake", "issue", "waste"].includes(m.type)).map(m => m.ingId));
  const slow = ings.filter(i => (sm[i.id] || 0) > 0 && !moved.has(i.id)).map(i => ({ label: i.name, v: Math.max(0, sm[i.id] || 0) * M.unitCost(i) })).sort((a, b) => b.v - a.v);
  const takes = ev.all("stocktakes").filter(t => inR(t.date, R)); const byReason = {}; takes.forEach(t => t.lines.forEach(l => { if (Math.abs(l.diff) > 1e-6) byReason[l.reason || "No reason"] = (byReason[l.reason || "No reason"] || 0) + l.value; }));
  return `<div class="kpis" style="padding:0">${kpi("stock value now", now.reduce((s, r) => s + r.value, 0), null)}${kpi("materials below 3 days of cover", cover.filter(x => x.v < 3).length, null, "num", false)}${kpi("slow movers (unused in period)", slow.length, null, "num", false)}${kpi("wastage in period", -sum("moves", "value", R, r => r.move === "Wastage"), null, "money", false)}</div>
    <div class="agrid">${card("Stock value by type", hbars(Object.entries(byType).map(([label, v]) => ({ label, v })), "money"))}${card("Stock value by location", hbars(byLoc, "money"))}
    ${card("Days of cover (stock ÷ daily use, last 30 days)", hbars(cover.slice(0, 15), "num"))}${card("Slow movers: in stock, not used in the period (value)", hbars(slow.slice(0, 12), "money"))}
    ${card("Movements by type (value)", hbars(series({ ds: "moves", rows: "move", measure: "value" }, R), "money"))}${card("Stock-take differences by reason", hbars(Object.entries(byReason).map(([label, v]) => ({ label, v })), "money"))}</div>`;
}

/* ---------- explore: slice and dice ---------- */
const DEF = { ds: "sales", rows: "item", cols: "", measure: "net", agg: "sum", filters: {}, top: 15, chart: "bar" };
const spec = () => (S.ex = S.ex || { ...DEF, filters: {} });
const views = () => ev.all("aviews").sort((a, b) => a.name.localeCompare(b.name));
function explore(R) {
  const x = spec(); const d = DATA[x.ds]; const res = pivot(x, R); const dims = d.dims; const opt = (list, v, blank) => `${blank ? `<option value="">${blank}</option>` : ""}${list.map(([k, l]) => `<option value="${k}" ${v === k ? "selected" : ""}>${esc(l)}</option>`).join("")}`;
  const valuesOf = k => [...new Set(rowsOf(x.ds, R).map(r => String(r[k] ?? "–")))].sort().slice(0, 200);
  const fk = x.fdim || ""; const fl = x.filters || {};
  const timeRows = ["day", "week", "month", "hour"].includes(x.rows);
  const chart = x.chart === "none" ? "" : x.cols ? "" : x.chart === "line" || (timeRows && x.chart !== "bar") ? line(res.list.map(r => ({ label: labelOf(x.rows, r.key), v: r.v })), res.kind) : hbars(res.list.map(r => ({ label: labelOf(x.rows, r.key), v: r.v })), res.kind, 30);
  const pct = v => res.total ? Math.round(v / res.total * 1000) / 10 + "%" : "–";
  const mx = Math.max(1e-9, ...res.list.flatMap(r => res.cols.map(c => Math.abs(res.colVal(r, c)))));
  return `<div class="card acard wide"><div class="exctl">
      <label><span>Data</span><select class="in" data-ex="ds">${opt(Object.entries(DATA).map(([k, v]) => [k, v.label]), x.ds)}</select></label>
      <label><span>Rows</span><select class="in" data-ex="rows">${opt(dims, x.rows)}</select></label>
      <label><span>Columns</span><select class="in" data-ex="cols">${opt(dims.filter(y => y[0] !== x.rows), x.cols, "None")}</select></label>
      <label><span>Measure</span><select class="in" data-ex="measure">${opt(d.measures.map(m => [m[0], m[1]]), x.measure)}</select></label>
      <label><span>As</span><select class="in" data-ex="agg">${opt([["sum", "Total"], ["avg", "Average per line"]], x.agg)}</select></label>
      <label><span>Show</span><select class="in" data-ex="top">${opt([["0", "All rows"], ["5", "Top 5"], ["10", "Top 10"], ["15", "Top 15"], ["25", "Top 25"]], String(x.top))}</select></label>
      <label><span>Chart</span><select class="in" data-ex="chart">${opt([["bar", "Bars"], ["line", "Line"], ["none", "Table only"]], x.chart)}</select></label>
      <label><span>Filter by</span><select class="in" data-ex="fdim">${opt(dims, fk, "Add a filter…")}</select></label></div>
    ${fk ? `<div class="chips exvals">${valuesOf(fk).map(v => `<button class="chip" data-exval="${esc(v)}" aria-pressed="${(fl[fk] || []).includes(v)}">${esc(labelOf(fk, v))}</button>`).join("")}</div>` : ""}
    ${Object.entries(fl).filter(([, vs]) => vs.length).map(([k, vs]) => `<span class="tag t-camp exf">${esc((dims.find(y => y[0] === k) || [k, k])[1])}: ${esc(vs.map(v => labelOf(k, v)).join(", "))} <button class="linkbtn" data-exclear="${esc(k)}" aria-label="Clear filter">×</button></span>`).join(" ")}
    <p class="hint">${res.n} line${res.n === 1 ? "" : "s"} · total ${fmtV(res.total, res.kind)}</p>
    ${chart}
    <div class="tablecard" style="margin-top:10px"><table class="reg"><thead><tr><th>${esc((dims.find(y => y[0] === x.rows) || [])[1] || "")}</th>${x.cols ? res.cols.map(c => `<th class="r">${esc(labelOf(x.cols, c))}</th>`).join("") : ""}<th class="r">${esc((d.measures.find(m => m[0] === x.measure) || [])[1] || "")}</th>${x.agg === "avg" || res.kind === "count" ? "" : `<th class="r">Share</th>`}</tr></thead>
      <tbody>${res.list.map(r => `<tr><td>${esc(labelOf(x.rows, r.key))}</td>${x.cols ? res.cols.map(c => { const v = res.colVal(r, c); return `<td class="r heat" data-v="${v}" style="--h:${Math.abs(v) / mx}">${v ? fmtV(v, res.kind) : "–"}</td>`; }).join("") : ""}<td class="r" data-v="${r.v}"><b>${fmtV(r.v, res.kind)}</b></td>${x.agg === "avg" || res.kind === "count" ? "" : `<td class="r">${pct(r.v)}</td>`}</tr>`).join("") || `<tr><td colspan="9">Nothing in this period.</td></tr>`}</tbody>
      <tfoot><tr><td><b>Total</b></td>${x.cols ? res.cols.map(c => `<td class="r">${fmtV(res.colTot(c), res.kind)}</td>`).join("") : ""}<td class="r"><b>${fmtV(res.total, res.kind)}</b></td>${x.agg === "avg" || res.kind === "count" ? "" : "<td></td>"}</tr></tfoot></table></div>
    <div class="btnrow" style="margin-top:10px"><button class="btn btn-ghost" data-exsave>Save this view</button><button class="btn btn-ghost" data-excsv>Download (Excel CSV)</button><button class="btn btn-ghost" data-exreset>Start again</button></div></div>
    ${views().length ? `<div class="card acard wide"><h3>Saved views</h3><div class="chips">${views().map(v => `<span class="chip tagchip"><button class="linkbtn" data-exview="${esc(v.id)}">${esc(v.name)}</button>${v.by === (RL.me() || {}).id || RL.isAdmin() ? `<button data-exdel="${esc(v.id)}" aria-label="Delete ${esc(v.name)}">×</button>` : ""}</span>`).join("")}</div><p class="hint">Saved views are shared with the team; each opens with the period chosen above.</p></div>` : ""}`;
}
// Ready-made views to start from.
const STARTERS = [["Sales by item and month", { ds: "sales", rows: "item", cols: "month", measure: "net", top: 15 }], ["Sales by channel and weekday", { ds: "sales", rows: "channel", cols: "weekday", measure: "net" }],
  ["Orders by hour", { ds: "sales", rows: "hour", measure: "orders", chart: "bar" }], ["Spend by supplier and category", { ds: "purchases", rows: "supplier", cols: "mcat", measure: "amount" }],
  ["Wastage by material and month", { ds: "moves", rows: "material", cols: "month", measure: "value", filters: { move: ["Wastage"] } }], ["Spoilage by item", { ds: "production", rows: "item", measure: "spoiled" }],
  ["Payments by person and mode", { ds: "payments", rows: "person", cols: "mode", measure: "amount" }], ["Customers by spend", { ds: "sales", rows: "customer", measure: "net", top: 25 }]];

V.analytics = () => {
  S.filter.an = S.filter.an || "overview"; const k = S.filter.an; const R = periodRange("an"); const P = S.anCompare === false ? null : previous(R);
  let h = band("Analytics", "", `<p class="bandnote">${esc(periodLabel("an"))}${P ? " · compared with the same length of time before" : ""}</p>`);
  h += `<div class="tools">${periodBar("an")}<label class="f" style="display:flex;align-items:center;gap:8px;margin:0"><input type="checkbox" data-ancmp ${P ? "checked" : ""}> Compare with previous period</label></div>`;
  h += `<div class="tools" style="padding-top:0">${chipBar("an", [["overview", "Overview"], ["sales", "Sales"], ["make", "Production"], ["buy", "Buying"], ["stock", "Stock"], ["explore", "Explore"]])}</div>`;
  if (k === "explore") h += `<div class="chips scroll" style="padding:0 12px 8px">${STARTERS.map(([n], i) => `<button class="chip" data-exstart="${i}">${esc(n)}</button>`).join("")}</div>`;
  try { h += `<div class="adash">${({ overview, sales, make: production, buy: buying, stock, explore })[k](R, P)}</div>`; } catch (e) { h += `<p class="hint">Couldn’t work this out: ${esc(e.message || e)}</p>`; }
  return h;
};
A_init();
function A_init() {
  H.click.push(async T => {
    if (S.view !== "analytics") return false;
    if (T.closest("[data-ancmp]")) { S.anCompare = T.closest("[data-ancmp]").checked; H.render(); return true; }
    const st = T.closest("[data-exstart]"); if (st) { const [, sp] = STARTERS[+st.dataset.exstart]; S.ex = { ...DEF, chart: "bar", cols: "", filters: {}, ...JSON.parse(JSON.stringify(sp)) }; H.render(); return true; }
    const ev2 = T.closest("[data-exval]"); if (ev2) { const x = spec(); const k = x.fdim; const vs = new Set(x.filters[k] || []); vs.has(ev2.dataset.exval) ? vs.delete(ev2.dataset.exval) : vs.add(ev2.dataset.exval); x.filters[k] = [...vs]; H.render(); return true; }
    const ec = T.closest("[data-exclear]"); if (ec) { delete spec().filters[ec.dataset.exclear]; H.render(); return true; }
    if (T.closest("[data-exreset]")) { S.ex = { ...DEF, filters: {} }; H.render(); return true; }
    if (T.closest("[data-excsv]")) { if (!RL.can("export") && !RL.can("reports")) { toast("Your role can’t export"); return true; } const x = spec(); const d = DATA[x.ds]; const res = pivot(x, periodRange("an"));
      const head = [(d.dims.find(y => y[0] === x.rows) || [])[1], ...(x.cols ? res.cols.map(c => labelOf(x.cols, c)) : []), (d.measures.find(m => m[0] === x.measure) || [])[1]];
      download(`analytics_${x.ds}_${x.rows}${x.cols ? "_by_" + x.cols : ""}_${today()}.csv`, [head, ...res.list.map(r => [labelOf(x.rows, r.key), ...(x.cols ? res.cols.map(c => r2(res.colVal(r, c))) : []), r2(r.v)]), ["Total", ...(x.cols ? res.cols.map(c => r2(res.colTot(c))) : []), r2(res.total)]]); toast("Downloaded"); return true; }
    if (T.closest("[data-exsave]")) { const ok = await ask(`<p class="cq">Save this view</p><input class="in" id="exName" placeholder="e.g. Cookie sales by month" style="margin-top:12px">`, [{ label: "Cancel", cls: "btn-ghost", value: false }, { label: "Save", cls: "btn-primary", value: true }], true);
      const name = ok ? ((document.getElementById("exName") || {}).value || "").trim() : ""; if (!name) return true; const x = spec();
      await ev.put("aviews", { id: uid("av"), name, spec: JSON.parse(JSON.stringify({ ...x, fdim: "" })), by: (RL.me() || {}).id || "" }); sync.soon(); toast("View saved"); H.render(); return true; }
    const vw = T.closest("[data-exview]"); if (vw) { const v = ev.get("aviews", vw.dataset.exview); if (v) { S.ex = { ...DEF, ...JSON.parse(JSON.stringify(v.spec)), filters: { ...(v.spec.filters || {}) } }; H.render(); } return true; }
    const dl = T.closest("[data-exdel]"); if (dl) { const v = ev.get("aviews", dl.dataset.exdel); if (v && await yesNo(`<p class="cq">Delete “${esc(v.name)}”?</p>`, "Delete", "btn-danger-solid")) { await ev.del("aviews", v.id); sync.soon(); H.render(); } return true; }
    return false;
  });
  H.change.push(T => {
    if (S.view !== "analytics" || !T.dataset.ex) return false; const x = spec(); const k = T.dataset.ex; let v = T.value;
    if (k === "top") v = +v;
    x[k] = v;
    if (k === "ds") { const d = DATA[v]; x.rows = d.dims.find(y => !["day", "week", "month", "weekday"].includes(y[0]))[0]; x.cols = ""; x.measure = d.measures[0][0]; x.filters = {}; x.fdim = ""; }
    if (k === "rows" && x.cols === v) x.cols = "";
    H.render(); return true;
  });
}
