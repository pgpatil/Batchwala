// Business rules over the event store: orders, payments, customers, stock, costing and the bake board.
import * as ev from "./events.js";
import { today, cmpFlat, flatKey } from "./util.js";

export const CHANNELS = { whatsapp: "WhatsApp", phone: "Phone", instagram: "Instagram", bulk: "Bulk / event", other: "Other", walkin: "Walk-in", swiggy: "Swiggy", zomato: "Zomato" };
export const PREORDER = ["whatsapp", "phone", "instagram", "bulk", "other"];
export const SERVICE = { takeaway: "Takeaway", dinein: "Dine-in" };
// Walk-in orders carry a service (takeaway or dine-in at a table); everything else shows its channel.
export const chanLabel = o => o.channel === "walkin" && SERVICE[o.service] ? SERVICE[o.service] + (o.table ? " · T" + o.table : "") : (CHANNELS[o.channel] || o.channel);
export const STATUSES = ["received", "confirmed", "baking", "ready", "out", "delivered"];
export const STATUS_LABEL = { received: "Received", confirmed: "Confirmed", baking: "In a bake", ready: "Ready", out: "Out for delivery", delivered: "Delivered", cancelled: "Cancelled" };
export const DEFAULT_CONFIG = { id: "app", business: "My Bakery", tagline: "Home bakery", logo: "", accent: "#F7B718", upi: "", payee: "", activeTag: "", tags: [], festive: false, businessId: "b1", outletId: "home", folderName: "Batchwala data", clientId: "" };
export const config = () => ({ ...DEFAULT_CONFIG, ...(ev.get("config", "app") || {}) });

/* ---------- orders and payments ---------- */
export function normOrder(o) {
  const x = { no: "", customer: "", flat: "", phone: "", channel: "whatsapp", date: today(), items: [], discountPct: 0, status: "received", notes: "", tag: "", ...o };
  x.items = (x.items || []).map(i => ({ item: i.item || "", qty: +i.qty || 0, rate: +i.rate || 0, ...(i.menuId ? { menuId: i.menuId } : {}), ...(i.taxPct != null ? { taxPct: +i.taxPct || 0 } : {}) }));
  x.discountPct = +x.discountPct || 0;
  return x;
}
let payCache = null, payStamp = null;
function payIndex() {
  const p = ev.all("payments"); const stamp = p.length + ":" + (p.at(-1) || {}).id;
  if (payStamp === stamp && payCache) return payCache;
  const idx = {}; p.forEach(x => { (idx[x.orderId] = idx[x.orderId] || []).push(x); }); payCache = idx; payStamp = stamp; return idx;
}
export const orders = (withCancelled = true) => ev.all("orders").map(normOrder).filter(o => withCancelled || o.status !== "cancelled");
export const paymentsFor = id => (payIndex()[id] || []).slice().sort((a, b) => a._at < b._at ? -1 : 1);
export const sub = o => o.items.reduce((s, i) => s + i.qty * i.rate, 0);
export const disc = o => Math.round(sub(o) * (o.discountPct || 0) / 100);
export const total = o => o.status === "cancelled" ? 0 : Math.round(sub(o) - disc(o) + (o.taxIncl ? 0 : taxOf(o).tax));

/* ---------- tax ---------- */
// Business setting; each order line keeps the rate it was sold at (taxPct), and the order keeps whether prices included tax (taxIncl),
// so changing the setting never changes old bills. Lines without taxPct are untaxed.
export const taxCfg = () => ({ on: false, name: "GST", incl: false, split: true, rate: 5, gstin: "", ...(config().tax || {}) });
export function taxRateFor(line) { const t = taxCfg(); if (!t.on) return 0; const m = (line.menuId && menu().find(x => x.id === line.menuId)) || menuByName(line.item); return m && m.taxPct != null && m.taxPct !== "" ? +m.taxPct : +t.rate || 0; }
// Stamps current rates on lines that have none; used when saving and to preview totals before saving.
export function withTax(o) { const t = taxCfg(); return { ...o, items: (o.items || []).map(i => i.taxPct != null ? i : { ...i, taxPct: taxRateFor(i) }), taxIncl: o.taxIncl ?? (t.on && t.incl) }; }
const r2 = v => Math.round(v * 100) / 100;
// Tax per rate on the discounted line amounts; inclusive prices have the tax taken out of them.
export function taxOf(o) {
  const f = 1 - (o.discountPct || 0) / 100; const by = {}; let tax = 0;
  (o.items || []).forEach(i => { const r = +i.taxPct || 0; if (!r) return; const amt = i.qty * i.rate * f; const t = o.taxIncl ? amt - amt / (1 + r / 100) : amt * r / 100; by[r] = (by[r] || 0) + t; tax += t; });
  Object.keys(by).forEach(k => by[k] = r2(by[k])); return { tax: r2(tax), by };
}
// Lines for a bill: "CGST 2.5%" + "SGST 2.5%" when split, else "GST 5%".
export function taxLines(o) { const t = taxCfg(); const { by } = taxOf(o); const out = [];
  Object.keys(by).sort((a, b) => a - b).forEach(r => { if (t.split) { const h = r2(by[r] / 2); out.push([`C${t.name} ${+r / 2}%`, h], [`S${t.name} ${+r / 2}%`, r2(by[r] - h)]); } else out.push([`${t.name} ${+r}%`, by[r]]); });
  return out; }
export const received = o => paymentsFor(o.id).reduce((s, p) => s + (+p.amount || 0), 0);
export const bal = o => Math.max(0, total(o) - received(o));
export const pcs = o => o.items.reduce((s, i) => s + i.qty, 0);
export const isDelivered = o => o.status === "delivered";
export function payState(o) { const t = total(o), r = received(o); if (t <= 0 || r >= t) return "paid"; return r > 0 ? "part" : "due"; }
export function lastPayMode(o) { const p = paymentsFor(o.id).filter(x => x.amount > 0).at(-1); return p ? p.mode : ""; }
export const ckey = o => (o.customer || "").trim().toLowerCase() + "|" + (o.flat || "").trim().toUpperCase();
// Each phone user numbers with their own prefix (P-29, N-30…) so two phones never clash offline.
// A new prefix starts after the highest number already used, so numbers keep rising.
export function nextNo(prefix) {
  const all = orders().map(o => String(o.no)).filter(Boolean);
  const num = n => +n.split("-").pop() || 0;
  const mine = all.filter(n => prefix ? n.startsWith(prefix + "-") : /^\d+$/.test(n)).map(num);
  const base = mine.length ? Math.max(...mine) : Math.max(0, ...all.map(num));
  return prefix ? `${prefix}-${base + 1}` : String(base + 1);
}
export function customers(list = orders(false)) {
  const map = new Map();
  list.filter(o => o.channel !== "walkin").sort((a, b) => a.date < b.date ? -1 : 1).forEach(o => {
    const k = ckey(o); if (!map.has(k)) map.set(k, { key: k, customer: o.customer, flat: o.flat, phone: "", orders: [] });
    const c = map.get(k); c.orders.push(o); if (o.phone) c.phone = o.phone; c.customer = o.customer; c.last = o.date;
  });
  return [...map.values()].map(c => ({ ...c, spend: c.orders.reduce((s, o) => s + total(o), 0), balance: c.orders.reduce((s, o) => s + bal(o), 0), received: c.orders.reduce((s, o) => s + Math.min(received(o), total(o)), 0) }));
}
export const sortFlat = list => list.slice().sort(cmpFlat);
export function runOrder(a, b) { // delivery order: wing, then floor, then flat
  const x = flatKey(a.flat), y = flatKey(b.flat);
  if (x[0] !== y[0]) return x[0] - y[0]; if (x[1] !== y[1]) return x[1] < y[1] ? -1 : 1;
  return Math.floor(x[2] / 100) - Math.floor(y[2] / 100) || x[2] - y[2];
}

/* ---------- menu ---------- */
export const menu = () => ev.all("menu").map(m => ({ category: "", active: true, recipe: [], aliases: "", par: 0, ...m, price: +m.price || 0, par: +m.par || 0 }))
  .sort((a, b) => (a.sort ?? 999) - (b.sort ?? 999) || a.name.localeCompare(b.name));
export const menuActive = () => menu().filter(m => m.active !== false);
export const menuByName = name => menu().find(m => m.name.toLowerCase() === String(name).toLowerCase());

/* ---------- inventory ---------- */
// Materials: rm = raw material (bought), pm = packing material (bought), sf = semi-finished (made from a recipe that yields `yield` base units).
export const ING_TYPES = { rm: "Raw material", pm: "Packing material", sf: "Semi-finished" };
export const ingredients = () => ev.all("ingredients").map(i => ({ unit: "g", reorder: 0, cost: 0, barcode: "", type: "rm", supplier: "", recipe: [], yield: 0, ...i })).sort((a, b) => a.name.localeCompare(b.name));
export const ingMap = () => Object.fromEntries(ingredients().map(i => [i.id, i]));
export const moves = () => ev.all("moves").sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a._at < b._at ? 1 : -1));
// Stock by material; with a location, only that location's moves (records from before locations count at the first one).
export function stockMap(loc = null) { const m = {}; const home = locations()[0].id; ev.all("moves").forEach(v => { if (loc && (v.outletId || home) !== loc) return; m[v.ingId] = (m[v.ingId] || 0) + (+v.qty || 0); }); return m; }
// Semi-finished made fresh (no "make when below" level) aren't flagged when they run out.
export function stockLevel(i, sm = stockMap()) { const s = sm[i.id] || 0; return { on: s, state: s <= 0 ? (i.type === "sf" && !i.reorder ? "ok" : "out") : (i.reorder && s <= i.reorder ? "low" : "ok") }; }
// Bought materials cost what the last purchase cost; semi-finished cost rolls up through their recipe, level by level.
export function unitCost(ing, seen = new Set()) {
  if (ing.type === "sf") {
    if (seen.has(ing.id) || !(+ing.yield > 0)) return +ing.cost || 0;
    const next = new Set(seen).add(ing.id); const ings = ingMap();
    return (ing.recipe || []).reduce((c, r) => c + (ings[r.ingId] ? unitCost(ings[r.ingId], next) * (+r.qty || 0) : 0), 0) / ing.yield;
  }
  const p = ev.all("moves").filter(m => m.ingId === ing.id && m.type === "purchase" && m.qty > 0 && m.amount > 0).sort((a, b) => (a.date + a._at) < (b.date + b._at) ? 1 : -1)[0];
  return p ? p.amount / p.qty : (+ing.cost || 0);
}
export function recipeCost(m) {
  const ings = ingMap(); let cost = 0, missing = 0;
  (m.recipe || []).forEach(r => { const i = ings[r.ingId]; if (!i) { missing++; return; } const c = unitCost(i); if (!c) missing++; cost += c * (+r.qty || 0); });
  return { cost, missing, lines: (m.recipe || []).length };
}
export function requirement(lines) {
  const need = {}; const unknown = [];
  lines.forEach(l => { const m = menuByName(l.item); if (!m || !(m.recipe || []).length) { if (l.qty) unknown.push(l.item); return; } m.recipe.forEach(r => { need[r.ingId] = (need[r.ingId] || 0) + (+r.qty || 0) * l.qty; }); });
  return { need, unknown: [...new Set(unknown)] };
}

/* ---------- batches ---------- */
// A batch is one recorded bake (kind "bakes"): numbered, with pieces and spoiled pieces per item and the stock it used.
export const batches = () => ev.all("bakes").map(b => ({ no: "", notes: "", void: false, ...b, lines: (b.lines || []).map(l => ({ item: l.item, qty: +l.qty || 0, spoiled: +l.spoiled || 0 })), prep: (b.prep || []).map(p => ({ ingId: p.ingId, runs: +p.runs || 0, qty: +p.qty || 0 })) }))
  .sort((a, b) => (a.date + (a.at || a._at || "")) < (b.date + (b.at || b._at || "")) ? 1 : -1);
export const bakesOn = date => batches().filter(b => b.date === date && !b.void);
export const batchPcs = b => b.lines.reduce((s, l) => s + l.qty, 0);
export const batchSpoiled = b => b.lines.reduce((s, l) => s + l.spoiled, 0);
// Stock used, priced when the batch was saved; older batches are priced from their stock moves at today's cost.
export function batchStock(b) {
  if (Array.isArray(b.stock)) return b.stock;
  const ings = Object.fromEntries(ingredients().map(i => [i.id, i])); const use = {};
  ev.all("moves").filter(m => m.ref === b.id && m.type === "bake").forEach(m => { use[m.ingId] = (use[m.ingId] || 0) - (+m.qty || 0); });
  return Object.entries(use).map(([ingId, q]) => ({ ingId, qty: q, cost: ings[ingId] ? unitCost(ings[ingId]) * q : 0 }));
}
export const batchText = (b, ings = ingMap()) => [...b.lines.map(l => `${l.item} × ${l.qty}`), ...b.prep.map(p => `${(ings[p.ingId] || {}).name || "?"} × ${p.runs} run${p.runs === 1 ? "" : "s"}`)].join(", ");
export const batchMadeValue = b => (b.made || []).reduce((s, x) => s + (+x.cost || 0), 0);
// Net cost of the finished pieces: everything taken off stock, less the value of semi-finished stock this batch made.
export const batchCost = b => Math.max(0, batchStock(b).reduce((s, x) => s + (+x.cost || 0), 0) - batchMadeValue(b));
// What a batch takes off stock: finished pieces use their recipe one level down (semi-finished from stock); prep runs use the semi-finished recipe.
export function batchNeed(lines, prep = []) {
  const { need, unknown } = requirement(lines); const ings = ingMap(); const made = {};
  prep.filter(p => p.runs > 0).forEach(p => { const i = ings[p.ingId]; if (!i) return; made[i.id] = (made[i.id] || 0) + i.yield * p.runs;
    (i.recipe || []).forEach(r => { need[r.ingId] = (need[r.ingId] || 0) + (+r.qty || 0) * p.runs; }); });
  return { need, made, unknown };
}
// Planning across every BOM level: semi-finished on hand is used first; only the shortfall is made, in whole recipe runs, and exploded further.
// Each material is settled after all its parents (by its deepest level), so runs are counted once.
export function explode(lines) {
  const ings = ingMap(); const sm = stockMap(); const gross = {}; const make = {}; const unknown = [];
  lines.forEach(l => { const m = menuByName(l.item); if (!m || !(m.recipe || []).length) { if (l.qty) unknown.push(l.item); return; }
    m.recipe.forEach(r => { gross[r.ingId] = (gross[r.ingId] || 0) + (+r.qty || 0) * l.qty; }); });
  const lvl = {}; const walk = (id, d, path) => { if (path.has(id) || d > 12) return; lvl[id] = Math.max(lvl[id] || 0, d); const i = ings[id];
    if (i && i.type === "sf") (i.recipe || []).forEach(r => walk(r.ingId, d + 1, new Set(path).add(id))); };
  Object.keys(gross).forEach(id => walk(id, 0, new Set()));
  Object.keys(lvl).sort((a, b) => lvl[a] - lvl[b]).forEach(id => { const i = ings[id]; const q = gross[id] || 0;
    if (!i || i.type !== "sf" || q <= 0 || !(+i.yield > 0)) return; const short = q - Math.max(0, sm[id] || 0); if (short <= 0) return;
    const runs = Math.ceil(short / i.yield); make[id] = runs; (i.recipe || []).forEach(r => { gross[r.ingId] = (gross[r.ingId] || 0) + (+r.qty || 0) * runs; }); });
  return { need: gross, make, level: lvl, unknown: [...new Set(unknown)], onHand: sm };
}
// True if `recipe` (for material `id`) reaches back to `id` through semi-finished recipes.
export function makesCycle(id, recipe) {
  const ings = ingMap(); const seen = new Set();
  const hit = rid => { if (rid === id) return true; if (seen.has(rid)) return false; seen.add(rid); const i = ings[rid]; return !!(i && i.type === "sf" && (i.recipe || []).some(r => hit(r.ingId))); };
  return (recipe || []).some(r => hit(r.ingId));
}
// Same idea as order numbers: each person's prefix keeps two phones from clashing offline.
export function nextBatchNo(prefix) { const n = batches().map(b => +String(b.no || "").split("-").pop() || 0); return `${prefix || ""}B-${Math.max(0, ...n) + 1}`; }

/* ---------- bake board ---------- */
// Per item for a date: committed (pre-orders), par (kept ready for on-demand), baked, sold (counter and aggregator), left.
export function board(date) {
  const rows = new Map(); const row = name => { if (!rows.has(name)) rows.set(name, { item: name, committed: 0, par: 0, baked: 0, sold: 0, spoiled: 0 }); return rows.get(name); };
  orders(false).filter(o => o.date === date).forEach(o => o.items.forEach(i => { const r = row(i.item); if (PREORDER.includes(o.channel)) r.committed += i.qty; else r.sold += i.qty; }));
  menuActive().filter(m => m.par > 0).forEach(m => { row(m.name).par = m.par; });
  bakesOn(date).forEach(b => b.lines.forEach(l => { const r = row(l.item); r.baked += l.qty - l.spoiled; r.spoiled += l.spoiled; }));
  return [...rows.values()].map(r => ({ ...r, toBake: Math.max(0, r.committed + r.par - r.baked), left: r.baked - r.committed - r.sold })).sort((a, b) => b.toBake - a.toBake || b.committed - a.committed);
}

/* ---------- locations and ERP ---------- */
// The first location is where records made before locations existed belong. Kitchens make; outlets sell (a lone kitchen sells too).
export const locations = () => { const l = (config().locations || []).filter(x => x && x.id); return l.length ? l : [{ id: config().outletId || "home", name: "Main kitchen", kind: "kitchen" }]; };
export const locName = id => (locations().find(l => l.id === id) || { name: id || "?" }).name;
export const kitchens = () => locations().filter(l => l.kind === "kitchen");
export const sellingLocs = () => { const o = locations().filter(l => l.kind === "outlet"); return o.length ? o : locations().slice(0, 1); };
let hereId = null;
export const setHere = id => { hereId = id; };
export const here = () => locations().some(l => l.id === hereId) ? hereId : locations()[0].id;
// Restaurant = counter, orders, payments, deliveries, outlet board. ERP = purchases (GRN), stock by location, BOM, production, batches, transfers, finished goods.
export const MODES = { restaurant: "Restaurant", erp: "ERP" };
export const modesOf = m => m && Array.isArray(m.modes) && m.modes.length ? m.modes : ["restaurant"];
export const erpOn = () => ev.all("members").some(m => modesOf(m).includes("erp"));
const since = () => config().erpStart || "0000";
const locOf = x => x.outletId || locations()[0].id;
// Finished goods on hand, by location and item, counted from the day ERP started:
// good pieces from batches + transfers received − transfers sent − delivered sales + adjustments.
// A transfer leaves the sender when sent and reaches the receiver only when received, at the quantity received.
export function fgStock() {
  const out = {}; const add = (loc, item, q) => { const L = out[loc] = out[loc] || {}; L[item] = (L[item] || 0) + q; }; const s0 = since();
  batches().filter(b => !b.void && b.date >= s0).forEach(b => b.lines.forEach(l => add(locOf(b), l.item, l.qty - l.spoiled)));
  ev.all("transfers").filter(t => !t.void && t.date >= s0).forEach(t => (t.lines || []).filter(l => l.item).forEach(l => { add(t.from, l.item, -(+l.qty || 0)); if (xferReceived(t)) add(t.to, l.item, l.recv != null ? +l.recv : +l.qty || 0); }));
  orders(false).filter(o => isDelivered(o) && o.date >= s0).forEach(o => o.items.forEach(i => add(locOf(o), i.item, -i.qty)));
  ev.all("fg").filter(f => f.date >= s0).forEach(f => add(f.loc, f.item, +f.qty || 0));
  return out;
}
// Outlet board for a date: per item, pre-orders still to hand over, kept-ready level, on hand here, sold here today, and what to ask the kitchen for.
export function outletBoard(date, loc = here()) {
  const fg = fgStock()[loc] || {}; const way = inTransit(loc); const rows = new Map(); const row = n => { if (!rows.has(n)) rows.set(n, { item: n, committed: 0, par: 0, onHand: 0, sold: 0, coming: 0 }); return rows.get(n); };
  orders(false).filter(o => o.date === date && locOf(o) === loc).forEach(o => o.items.forEach(i => { const r = row(i.item); if (isDelivered(o)) r.sold += i.qty; else r.committed += i.qty; }));
  if (sellingLocs().some(l => l.id === loc)) menuActive().filter(m => m.par > 0).forEach(m => { row(m.name).par = m.par; });
  Object.entries(fg).forEach(([n, q]) => { if (q) row(n).onHand = q; }); Object.entries(way).forEach(([n, q]) => { if (q) row(n).coming = q; });
  // Pieces already on the way count against the shortfall, so the kitchen isn't asked twice.
  return [...rows.values()].map(r => ({ ...r, short: Math.max(0, r.committed + r.par - Math.max(0, r.onHand) - r.coming) })).sort((a, b) => b.short - a.short || a.item.localeCompare(b.item));
}
// Production for a kitchen and date: what every selling location is short of, less finished goods already at the kitchen.
export function production(date, kitchen = (kitchens()[0] || locations()[0]).id) {
  const fg = fgStock(); const k = fg[kitchen] || {}; const rows = new Map();
  sellingLocs().forEach(l => outletBoard(date, l.id).forEach(r => { if (!r.short && l.id !== kitchen) return; const x = rows.get(r.item) || { item: r.item, need: 0, byLoc: {}, atKitchen: 0 };
    const n = l.id === kitchen ? r.committed + r.par : r.short; if (n) { x.need += n; x.byLoc[l.id] = n; } rows.set(r.item, x); }));
  const baked = bakesOn(date).filter(b => locOf(b) === kitchen).reduce((m, b) => { b.lines.forEach(l => m[l.item] = (m[l.item] || 0) + l.qty - l.spoiled); return m; }, {});
  return [...rows.values()].map(x => ({ ...x, atKitchen: Math.max(0, k[x.item] || 0), baked: baked[x.item] || 0, toBake: Math.max(0, x.need - Math.max(0, k[x.item] || 0)) }))
    .filter(x => x.need).sort((a, b) => b.toBake - a.toBake || a.item.localeCompare(b.item));
}
export const suppliers = () => ev.all("suppliers").sort((a, b) => a.name.localeCompare(b.name));
export const grns = () => ev.all("grns").sort((a, b) => (b.date + b._at).localeCompare(a.date + a._at));
// Transfers saved before the receive step existed have no status and count as received.
export const xferReceived = t => !t.status || t.status === "received";
export const xferShort = t => xferReceived(t) && (t.lines || []).some(l => l.recv != null && +l.recv < +l.qty);
export function inTransit(loc) { const m = {}; ev.all("transfers").filter(t => !t.void && t.to === loc && !xferReceived(t)).forEach(t => (t.lines || []).filter(l => l.item).forEach(l => { m[l.item] = (m[l.item] || 0) + (+l.qty || 0); })); return m; }
export const transfers = () => ev.all("transfers").sort((a, b) => (b.date + b._at).localeCompare(a.date + a._at));
// GRN-P12, T-P4: the document type, then the person's prefix so two phones never clash offline.
export function nextDocNo(kind, prefix, tag) { const n = ev.all(kind).map(x => +((/(\d+)$/.exec(String(x.no || "")) || [])[1] || 0)); return `${tag}-${prefix || ""}${Math.max(0, ...n) + 1}`; }
