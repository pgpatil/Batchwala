// Business rules over the event store: orders, payments, customers, stock, costing and the bake board.
import * as ev from "./events.js";
import { today, addDays, cmpFlat, flatKey } from "./util.js";

// Results are worked out once per change of data (ev.dataVersion) and reused by every screen until something changes.
// Calls with object arguments (custom lists) aren't cached. Callers get their own array copy; the records inside are shared and read-only.
function memo(fn) { let v = -1; const cache = new Map();
  return (...args) => { if (args.some(a => a && typeof a === "object")) return fn(...args);
    const now = ev.dataVersion() + "|" + today(); if (now !== v) { v = now; cache.clear(); }   // a new day also refreshes (expiry, "today")
    const k = args.length ? JSON.stringify(args) : "";
    if (!cache.has(k)) cache.set(k, fn(...args)); const r = cache.get(k); return Array.isArray(r) ? r.slice() : r && typeof r === "object" ? { ...r } : r; }; }

export const CHANNELS = { whatsapp: "WhatsApp", phone: "Phone", instagram: "Instagram", bulk: "Bulk / event", other: "Other", walkin: "Walk-in", swiggy: "Swiggy", zomato: "Zomato" };
export const PREORDER = ["whatsapp", "phone", "instagram", "bulk", "other"];
export const SERVICE = { takeaway: "Takeaway", dinein: "Dine-in" };
// Walk-in orders carry a service (takeaway or dine-in at a table); everything else shows its channel.
export const chanLabel = o => o.channel === "walkin" && SERVICE[o.service] ? SERVICE[o.service] + (o.table ? " · T" + o.table : "") : (CHANNELS[o.channel] || o.channel);
export const STATUSES = ["received", "confirmed", "baking", "ready", "out", "delivered"];
export const STATUS_LABEL = { received: "Received", confirmed: "Confirmed", baking: "In a bake", ready: "Ready", out: "Out for delivery", delivered: "Delivered", cancelled: "Cancelled" };
export const DEFAULT_CONFIG = { id: "app", business: "My Bakery", tagline: "Home bakery", logo: "", accent: "#F7B718", upi: "", payee: "", activeTag: "", tags: [], festive: false, businessId: "b1", outletId: "home", folderName: "Batchwala data", clientId: "" };
export const config = memo(() => ({ ...DEFAULT_CONFIG, ...(ev.get("config", "app") || {}) }));

/* ---------- orders and payments ---------- */
const ISO = /^\d{4}-\d{2}-\d{2}$/;
export function normOrder(o) {
  const x = { no: "", customer: "", flat: "", phone: "", channel: "whatsapp", date: today(), items: [], discountPct: 0, status: "received", notes: "", tag: "", ...o };
  x.items = (x.items || []).map(i => ({ item: i.item || "", qty: +i.qty || 0, rate: +i.rate || 0, ...(i.menuId ? { menuId: i.menuId } : {}), ...(i.taxPct != null ? { taxPct: +i.taxPct || 0 } : {}), ...(i.list != null ? { list: +i.list } : {}) }));
  x.discountPct = +x.discountPct || 0;
  if (!ISO.test(x.date)) x.date = today();   // dates also go into HTML attributes; anything that isn't YYYY-MM-DD (bad sync or old import) becomes today
  return x;
}
let payCache = null, payStamp = null;
function payIndex() {
  const stamp = ev.dataVersion(); if (payStamp === stamp && payCache) return payCache;
  const p = ev.all("payments");
  const idx = {}; p.forEach(x => { (idx[x.orderId] = idx[x.orderId] || []).push(x); }); payCache = idx; payStamp = stamp; return idx;
}
export const orders = memo((withCancelled = true) => ev.all("orders").map(normOrder).filter(o => withCancelled || o.status !== "cancelled"));
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
  return [...map.values()].map(c => ({ ...c, spend: c.orders.reduce((s, o) => s + total(o), 0), balance: c.orders.reduce((s, o) => s + bal(o), 0), received: c.orders.reduce((s, o) => s + Math.min(received(o), total(o)), 0), credit: Math.round(creditOf(c.key) * 100) / 100 }));
}
// Customer credit: money held for a customer but not on any order (advances, overpayments moved to credit), less credit used or refunded.
// These are payments with no orderId; credit applied to an order is a "Credit" payment on the order plus a matching negative here.
export const creditOf = key => (payIndex()[""] || []).filter(p => p.customerKey === key).reduce((s, p) => s + (+p.amount || 0), 0);
export const creditEntries = key => (payIndex()[""] || []).filter(p => p.customerKey === key).sort((a, b) => a._at < b._at ? -1 : 1);
export const sortFlat = list => list.slice().sort(cmpFlat);
export function runOrder(a, b) { // delivery order: wing, then floor, then flat
  const x = flatKey(a.flat), y = flatKey(b.flat);
  if (x[0] !== y[0]) return x[0] - y[0]; if (x[1] !== y[1]) return x[1] < y[1] ? -1 : 1;
  return Math.floor(x[2] / 100) - Math.floor(y[2] / 100) || x[2] - y[2];
}

/* ---------- menu ---------- */
export const menu = memo(() => ev.all("menu").map(m => ({ category: "", active: true, recipe: [], aliases: "", par: 0, ...m, price: +m.price || 0, par: +m.par || 0 }))
  .sort((a, b) => (a.sort ?? 999) - (b.sort ?? 999) || a.name.localeCompare(b.name)));
export const menuActive = () => menu().filter(m => m.active !== false);
export const menuByName = name => menu().find(m => m.name.toLowerCase() === String(name).toLowerCase());

/* ---------- inventory ---------- */
// Materials: rm = raw material (bought), pm = packing material (bought), sf = semi-finished (made from a recipe that yields `yield` base units).
export const ING_TYPES = { rm: "Raw material", pm: "Packing material", sf: "Semi-finished" };
export const ingredients = memo(() => ev.all("ingredients").map(i => ({ unit: "g", reorder: 0, cost: 0, barcode: "", type: "rm", supplier: "", recipe: [], yield: 0, ...i })).sort((a, b) => a.name.localeCompare(b.name)));
export const ingMap = memo(() => Object.fromEntries(ingredients().map(i => [i.id, i])));
export const moves = memo(() => ev.all("moves").sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a._at < b._at ? 1 : -1)));
// Stock by material; with a location, only that location's moves (records from before locations count at the first one).
export function stockMap(loc = null) { const m = {}; const home = locations()[0].id; ev.all("moves").forEach(v => { if (loc && (v.outletId || home) !== loc) return; m[v.ingId] = (m[v.ingId] || 0) + (+v.qty || 0); }); return m; }
// Semi-finished made fresh (no "make when below" level) aren't flagged when they run out.
export function stockLevel(i, sm = stockMap()) { const s = sm[i.id] || 0; return { on: s, state: s <= 0 ? (i.type === "sf" && !i.reorder ? "ok" : "out") : (i.reorder && s <= i.reorder ? "low" : "ok") }; }
// Cost of bought materials: the moving weighted average of what's on hand (default), or the last purchase price (Business settings).
// Purchases add their amount; anything else coming in (counts, returns) comes in at the current average; anything going out leaves at it.
let costCache = null, costStamp = "";
export const costing = () => config().costing === "last" ? "last" : "avg";
function costIndex() {
  const mv = ev.all("moves"); const stamp = mv.length + ":" + ((mv.at(-1) || {}).id || "") + ":" + costing() + ":" + ev.all("ingredients").length; if (stamp === costStamp) return costCache;
  const own = Object.fromEntries(ev.all("ingredients").map(i => [i.id, +i.cost || 0])); const by = {};
  mv.sort((a, b) => (a.date + a._at) < (b.date + b._at) ? -1 : 1).forEach(m => { const x = by[m.ingId] = by[m.ingId] || { q: 0, v: 0, rates: [] }; const q = +m.qty || 0; if (!q) return;
    const last = () => x.rates.at(-1) || own[m.ingId] || 0;
    if (m.type === "purchase" && q > 0 && +m.amount > 0) { const rate = +m.amount / q;
      if (x.q < 0) x.v = x.q * rate;   // stock that went below zero is valued at this price, so the average still matches what's on hand
      x.rates.push(rate); x.q += q; x.v += +m.amount; return; }
    if (m.type === "purchase" && q < 0 && +m.amount < 0) {   // an undone purchase takes its money back out and drops its price; goods returned (ret) keep it
      const rate = +m.amount / q; const k = m.ret ? -1 : x.rates.map(r => Math.abs(r - rate) < 1e-9).lastIndexOf(true); if (k >= 0) x.rates.splice(k, 1);
      x.q += q; x.v += +m.amount; if (x.q <= 0) x.v = x.q * last(); return; }
    const avg = x.q > 0 ? x.v / x.q : last(); x.q += q; x.v += avg * q; if (x.q <= 0) x.v = x.q * last(); });
  costCache = Object.fromEntries(Object.entries(by).map(([id, x]) => [id, { avg: x.q > 0 && x.v > 0 ? x.v / x.q : (x.rates.at(-1) || own[id] || 0), last: x.rates.at(-1) || 0 }])); costStamp = stamp; return costCache;
}
export const lastPrice = ing => (costIndex()[ing.id] || {}).last || +ing.cost || 0;
// Semi-finished cost rolls up through their recipe, level by level.
export function unitCost(ing, seen = new Set()) {
  if (ing.type === "sf") {
    if (seen.has(ing.id) || !(+ing.yield > 0)) return +ing.cost || 0;
    const next = new Set(seen).add(ing.id); const ings = ingMap();
    return (ing.recipe || []).reduce((c, r) => c + (ings[r.ingId] ? unitCost(ings[r.ingId], next) * (+r.qty || 0) : 0), 0) / ing.yield;
  }
  const c = costIndex()[ing.id]; if (!c || !c.last) return +ing.cost || 0;
  return (costing() === "last" ? c.last : c.avg) || c.last;
}
// Buying units: a material can be bought in packs (a 50 kg bag, a box of 100); size is in its base unit (g, ml, pcs).
export const packOf = i => i && i.pack && +i.pack.size > 0 && i.pack.name ? { name: String(i.pack.name), size: +i.pack.size } : null;
/* ---------- material lots ---------- */
// Each GRN line is a lot, with its best-before date when one was given. Stock is used oldest first, so what's on hand sits in the newest lots.
export function materialLots(ingId = null) {
  const sm = stockMap(); const t = today(); const out = [];
  const lots = {}; grns().filter(g => !g.void).forEach(g => g.lines.forEach((l, ix) => { if (ingId && l.ingId !== ingId) return; (lots[l.ingId] = lots[l.ingId] || []).push({ ingId: l.ingId, grn: g, ix, date: g.date, qty: +l.qty || 0, exp: l.exp || "", lot: l.lot || "", rate: l.qty ? (+l.cost || +l.amount || 0) / l.qty : 0 }); }));
  Object.entries(lots).forEach(([id, ls]) => { let r = Math.max(0, sm[id] || 0); ls.sort((a, b) => (b.date + b.grn._at) < (a.date + a.grn._at) ? -1 : 1)
    .forEach(l => { l.left = Math.min(l.qty, r); r -= l.left; l.expired = !!l.exp && l.left > 0 && l.exp < t; l.soon = !!l.exp && l.left > 0 && !l.expired && l.exp <= addDays(t, 7); out.push(l); }); });
  return out.sort((a, b) => (a.exp || "9999") < (b.exp || "9999") ? -1 : 1);
}
export const expiringMaterials = () => materialLots().filter(l => l.expired || l.soon);
export function recipeCost(m) {
  const ings = ingMap(); let cost = 0, missing = 0;
  (m.recipe || []).forEach(r => { const i = ings[r.ingId]; if (!i) { missing++; return; } const c = unitCost(i); if (!c) missing++; cost += c * (+r.qty || 0); });
  return { cost, missing, lines: (m.recipe || []).length };
}
// Recipe versions: a recipe change can be dated, keeping the earlier recipe in versions[] as { until, recipe, yield, at } (until = the
// first day the newer recipe applies). recipeAt gives the recipe that applied on a date, so past food cost and work orders keep their standard.
export function recipeAt(rec, date) {
  if (!rec || !date || !(rec.versions || []).length) return rec;
  const v = rec.versions.filter(x => x.until > date).sort((a, b) => a.until < b.until ? -1 : 1)[0];
  return v ? { ...rec, recipe: v.recipe || [], ...(v.yield != null ? { yield: +v.yield } : {}) } : rec;
}
export function requirement(lines, at) {
  const need = {}; const unknown = [];
  lines.forEach(l => { const m = recipeAt(menuByName(l.item), at); if (!m || !(m.recipe || []).length) { if (l.qty) unknown.push(l.item); return; } m.recipe.forEach(r => { need[r.ingId] = (need[r.ingId] || 0) + (+r.qty || 0) * l.qty; }); });
  return { need, unknown: [...new Set(unknown)] };
}

/* ---------- batches ---------- */
// A batch is one recorded bake (kind "bakes"): numbered, with pieces and spoiled pieces per item and the stock it used.
export const batches = memo(() => ev.all("bakes").map(b => ({ no: "", notes: "", void: false, ...b, date: ISO.test(b.date) ? b.date : today(), lines: (b.lines || []).map(l => ({ item: l.item, qty: +l.qty || 0, spoiled: +l.spoiled || 0, discarded: +l.discarded || 0, cleared: +l.cleared || 0 })), prep: (b.prep || []).map(p => ({ ingId: p.ingId, runs: +p.runs || 0, qty: +p.qty || 0 })) }))
  .sort((a, b) => (a.date + (a.at || a._at || "")) < (b.date + (b.at || b._at || "")) ? 1 : -1));
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
export function batchNeed(lines, prep = [], at) {
  const { need, unknown } = requirement(lines, at); const ings = ingMap(); const made = {};
  prep.filter(p => p.runs > 0).forEach(p => { const i = recipeAt(ings[p.ingId], at); if (!i) return; made[i.id] = (made[i.id] || 0) + i.yield * p.runs;
    (i.recipe || []).forEach(r => { need[r.ingId] = (need[r.ingId] || 0) + (+r.qty || 0) * p.runs; }); });
  return { need, made, unknown };
}
// Planning across every BOM level: semi-finished on hand is used first; only the shortfall is made, in whole recipe runs, and exploded further.
// Each material is settled after all its parents (by its deepest level), so runs are counted once.
// opts.extra: { [semi-finished id]: base units } wanted directly. opts.ignoreStock: work out the full quantity, not net of stock.
// opts.exact: semi-finished in the exact quantity needed rather than whole recipe runs.
export function explode(lines, loc = null, opts = {}) {
  const ings = ingMap(); const sm = stockMap(loc); const avail = opts.ignoreStock ? {} : sm; const gross = { ...(opts.extra || {}) }; const make = {}; const unknown = [];
  lines.forEach(l => { const m = menuByName(l.item); if (!m || !(m.recipe || []).length) { if (l.qty) unknown.push(l.item); return; }
    m.recipe.forEach(r => { gross[r.ingId] = (gross[r.ingId] || 0) + (+r.qty || 0) * l.qty; }); });
  const lvl = {}; const walk = (id, d, path) => { if (path.has(id) || d > 12) return; lvl[id] = Math.max(lvl[id] || 0, d); const i = ings[id];
    if (i && i.type === "sf") (i.recipe || []).forEach(r => walk(r.ingId, d + 1, new Set(path).add(id))); };
  Object.keys(gross).forEach(id => walk(id, 0, new Set()));
  Object.keys(lvl).sort((a, b) => lvl[a] - lvl[b]).forEach(id => { const i = ings[id]; const q = gross[id] || 0;
    if (!i || i.type !== "sf" || q <= 0 || !(+i.yield > 0)) return; const short = q - Math.max(0, avail[id] || 0); if (short <= 1e-9) return;
    const runs = opts.exact ? short / i.yield : Math.ceil(short / i.yield - 1e-9); make[id] = runs; (i.recipe || []).forEach(r => { gross[r.ingId] = (gross[r.ingId] || 0) + (+r.qty || 0) * runs; }); });
  return { need: gross, make, level: lvl, unknown: [...new Set(unknown)], onHand: sm };
}
// A saved production plan for a date and kitchen: { id, date, loc, lines: [{ item, qty }] }. Without one, planning starts from the suggestion.
export const planId = (date, loc) => `${date}@${loc || ""}`;
export const planOf = (date, loc) => ev.get("plans", planId(date, loc));
// Every level of a recipe scaled to `qty` (pieces of a menu item, or g / ml / pcs of a semi-finished material).
// scratch: semi-finished lines are made in the batch (their own steps, deepest first); otherwise they are taken from stock as a line.
export function batchCard(rec, qty, scratch = true) {
  const ings = ingMap(); const steps = []; const total = {};
  const walk = (name, recipe, mult, made, path) => {
    const lines = (recipe || []).map(r => ({ ing: ings[r.ingId], qty: (+r.qty || 0) * mult })).filter(l => l.ing && l.qty > 0);
    lines.forEach(l => { const i = l.ing; if (scratch && i.type === "sf" && +i.yield > 0 && (i.recipe || []).length && !path.has(i.id)) walk(i.name, i.recipe, l.qty / i.yield, { ing: i, qty: l.qty, runs: l.qty / i.yield }, new Set(path).add(i.id));
      else total[i.id] = (total[i.id] || 0) + l.qty; });
    steps.push({ name, made, lines });
  };
  const sf = rec.type === "sf"; walk(rec.name, rec.recipe, sf ? qty / (+rec.yield || 1) : qty, sf ? { ing: rec, qty, runs: qty / (+rec.yield || 1) } : null, new Set(sf ? [rec.id] : []));
  // The same semi-finished used in two places is one step making the sum.
  const merged = []; steps.forEach(s => { const m = s.made && merged.find(x => x.made && x.made.ing.id === s.made.ing.id);
    if (!m) { merged.push({ ...s, lines: s.lines.map(l => ({ ...l })) }); return; } m.made.qty += s.made.qty; m.made.runs += s.made.runs;
    s.lines.forEach(l => { const x = m.lines.find(y => y.ing.id === l.ing.id); if (x) x.qty += l.qty; else m.lines.push({ ...l }); }); });
  const cost = Object.entries(total).reduce((s, [id, q]) => s + unitCost(ings[id]) * q, 0);
  return { steps: merged, total: Object.entries(total).map(([id, q]) => ({ ing: ings[id], qty: q })), cost };
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
export const suppliers = memo(() => ev.all("suppliers").sort((a, b) => a.name.localeCompare(b.name)));
export const supplierByName = n => { const k = String(n || "").trim().toLowerCase(); return suppliers().find(s => s.name.trim().toLowerCase() === k || (s.aka || []).some(a => a.trim().toLowerCase() === k)) || null; };

/* ---------- purchase orders ---------- */
// A PO: { no, date, supplier, loc, expected, lines: [{ ingId, qty, rate (per base unit), taxPct }], status: draft | approved | closed | cancelled }.
// Receiving is a GRN with poId; what's been received is read from those GRNs.
export const porders = memo(() => ev.all("porders").sort((a, b) => (b.date + b._at).localeCompare(a.date + a._at)));
// Received per material; with lines for the same material, allocated to them in order (see poLineReceived).
export function poReceived(po) { const r = {}; grns().filter(g => !g.void && g.poId === po.id).forEach(g => g.lines.forEach(l => { r[l.ingId] = (r[l.ingId] || 0) + (+l.qty || 0); })); return r; }
// Ordered per material (older POs may list a material twice), leaving out materials since deleted.
export function poOrdered(po) { const ings = ingMap(); const o = {}; po.lines.forEach(l => { if (ings[l.ingId]) o[l.ingId] = (o[l.ingId] || 0) + (+l.qty || 0); }); return o; }
export function poState(po) {
  if (po.status === "cancelled" || po.status === "closed" || po.status === "draft") return po.status;
  const r = poReceived(po); const ord = poOrdered(po); const ids = Object.keys(ord); const got = ids.filter(id => (r[id] || 0) > 0).length;
  return ids.every(id => (r[id] || 0) >= ord[id] - 1e-6) ? "received" : got ? "part" : "approved";
}
export const poValue = po => po.lines.reduce((s, l) => s + l.qty * l.rate * (1 + (+l.taxPct || 0) / 100), 0);
export const PO_LABEL = { draft: "Waiting for approval", approved: "Approved", part: "Part received", received: "Received", closed: "Closed short", cancelled: "Cancelled" };
// Open quantity of a material on approved POs (and drafts, with drafts = true), so nothing is ordered twice.
export function onOrder(drafts = false) { const m = {}; porders().filter(p => ["approved", "part", ...(drafts ? ["draft"] : [])].includes(poState(p))).forEach(p => { const r = poReceived(p); Object.entries(poOrdered(p)).forEach(([id, q]) => { m[id] = (m[id] || 0) + Math.max(0, q - (r[id] || 0)); }); }); return m; }
// What a supplier last charged for a material (per base unit, before tax), from GRNs.
export const nameKey = s => String(s || "").trim().toLowerCase();
export function lastRate(supplier, ingId) { const s = nameKey(supplier); for (const g of grns()) { if (g.void || nameKey(g.supplier) !== s) continue; const l = g.lines.find(x => x.ingId === ingId && x.qty > 0 && x.amount > 0); if (l) return l.amount / l.qty; } return 0; }
// The usual supplier for a material: set on the material, else whoever it was last bought from.
export function usualSupplier(i) { if (i.supplier) { const s = supplierByName(i.supplier); return s ? s.name : i.supplier.trim(); } const g = grns().find(g => !g.void && g.lines.some(l => l.ingId === i.id)); return g ? g.supplier : ""; }

/* ---------- payables ---------- */
// Bills are GRNs; payments to suppliers are their own records (kind "spays"); debit notes (kind "preturns") are goods sent back.
// A debit note against a GRN reduces that bill; a payment marked against bills settles those first; whatever is left settles the oldest bills.
// Money paid beyond every bill is an advance held by the supplier (a negative balance).
export const spays = memo(() => ev.all("spays").sort((a, b) => (b.date + b._at).localeCompare(a.date + a._at)));
export const preturns = memo(() => ev.all("preturns").sort((a, b) => (b.date + b._at).localeCompare(a.date + a._at)));
export const AGE = [["0–30", 0], ["31–60", 31], ["61–90", 61], ["90+", 91]];
export function supplierLedger(name) {
  const n = nameKey(name); const sup = supplierByName(name) || { name, days: 0 }; const days = +sup.days || 0; const t = today();
  const bills = grns().filter(g => !g.void && nameKey(g.supplier) === n).map(g => ({ date: g.date, doc: g.no, id: g.id, inv: g.invoiceNo || "", bill: +g.total || 0, open: +g.total || 0, due: addDays(g.date, days) })).sort((a, b) => a.date < b.date ? -1 : 1);
  const byId = Object.fromEntries(bills.map(b => [b.id, b]));
  const pays = spays().filter(p => nameKey(p.supplier) === n); const dns = preturns().filter(d => !d.void && nameKey(d.supplier) === n);
  const settle = (b, amt) => { const u = Math.min(b.open, Math.max(0, amt)); b.open = Math.round((b.open - u) * 100) / 100; return amt - u; };
  // A payment and its reversal cancel out, so neither settles anything.
  const reversed = new Set(pays.filter(p => p.revOf).map(p => p.revOf)); let pool = 0;
  dns.slice().reverse().forEach(d => { let left = +d.total || 0; if (d.grnId && byId[d.grnId]) left = settle(byId[d.grnId], left); pool += left; });
  pays.slice().reverse().filter(p => !p.revOf && !reversed.has(p.id)).forEach(p => { let left = +p.amount || 0; (p.bills || []).forEach(id => { if (byId[id]) left = settle(byId[id], left); }); pool += left; });
  bills.forEach(b => { pool = settle(b, pool); });
  const entries = [...bills.map(b => ({ date: b.date, doc: b.doc, bill: b.bill, paid: 0, ref: b.id })),
    ...dns.map(d => ({ date: d.date, doc: `Debit note ${d.no}`, bill: 0, paid: +d.total || 0, dn: d })),
    ...pays.map(p => ({ date: p.date, doc: (p.mode ? `Paid · ${p.mode}${p.ref ? " " + p.ref : ""}` : "Paid") + (p.bills && p.bills.length ? ` · for ${p.bills.map(id => (byId[id] || {}).doc).filter(Boolean).join(", ")}` : ""), bill: 0, paid: +p.amount || 0, pay: p }))]
    .sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.bill ? -1 : 1);
  let run = 0; entries.forEach(e => { run += e.bill - e.paid; e.bal = Math.round(run * 100) / 100; });
  const open = bills.filter(b => b.open > 0.005); const overdue = open.filter(b => b.due < t);
  // Ageing by the bill date; "due soon" is what falls due within the next week.
  const age = AGE.map(() => 0); open.forEach(b => { const d = Math.round((new Date(t) - new Date(b.date)) / 864e5); let k = 0; AGE.forEach(([, from], i) => { if (d >= from) k = i; }); age[k] += b.open; });
  const soon = open.filter(b => b.due >= t && b.due <= addDays(t, 7));
  const balance = Math.round(run * 100) / 100;
  return { sup, days, bills, pays, dns, entries, balance, advance: balance < 0 ? -balance : 0, open, age, soon, dueSoon: soon.reduce((s, b) => s + b.open, 0), overdue: overdue.reduce((s, b) => s + b.open, 0), oldest: open[0] ? open[0].due : "" };
}
export function payables() { const names = new Set([...suppliers().map(s => s.name), ...grns().filter(g => !g.void).map(g => g.supplier), ...spays().map(p => p.supplier), ...preturns().filter(d => !d.void).map(d => d.supplier)].filter(Boolean).map(x => x.trim()));
  const seen = new Set(); return [...names].filter(n => { const k = n.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).map(n => ({ name: n, ...supplierLedger(n) })); }
export const grns = memo(() => ev.all("grns").sort((a, b) => (b.date + b._at).localeCompare(a.date + a._at)));
// Transfers saved before the receive step existed have no status and count as received.
export const xferReceived = t => !t.status || t.status === "received";
export const xferShort = t => xferReceived(t) && (t.lines || []).some(l => l.recv != null && +l.recv < +l.qty);
export function inTransit(loc) { const m = {}; ev.all("transfers").filter(t => !t.void && t.to === loc && !xferReceived(t)).forEach(t => (t.lines || []).filter(l => l.item).forEach(l => { m[l.item] = (m[l.item] || 0) + (+l.qty || 0); })); return m; }
export const transfers = memo(() => ev.all("transfers").sort((a, b) => (b.date + b._at).localeCompare(a.date + a._at)));
// GRN-P12, T-P4: the document type, then the person's prefix so two phones never clash offline.
// Numbers run per document type; a prefix ending in a digit (older "R5" style) is separated with "-" so its digit isn't read as part of the number.
export function nextDocNo(kind, prefix, tag) { const p = prefix || ""; const sep = /\d$/.test(p) ? "-" : "";
  const n = ev.all(kind).map(x => { const s = String(x.no || ""); const m = /^[A-Z]+-(?:[A-Z]*\d+-|[A-Z]*)(\d+)$/.exec(s); return +(m ? m[1] : 0); });
  return `${tag}-${p}${sep}${Math.max(0, ...n) + 1}`; }

/* ---------- shelf life ---------- */
// Days a piece can be sold, counting the day it was baked. Set per menu item; otherwise cookies keep a month and everything else 3 days.
export const shelfLife = m => m && m.shelfLife != null && m.shelfLife !== "" ? Math.max(1, +m.shelfLife) : (/cookie/i.test(m ? `${m.name} ${m.category}` : "") ? 30 : 3);
// Pieces of each batch still unsold: delivered orders use up the oldest batch made on or before their date first.
// Discarded pieces and pieces cleared on a count also come off. A lot is expired from the day its shelf life ends.
export function batchLots() {
  const lots = {}; const t = today();
  batches().filter(b => !b.void).sort((a, b) => (a.date + (a.at || a._at || "")) < (b.date + (b.at || b._at || "")) ? -1 : 1)
    .forEach(b => b.lines.forEach((l, ix) => { (lots[l.item] = lots[l.item] || []).push({ b, ix, item: l.item, date: b.date, made: l.qty - l.spoiled, left: Math.max(0, l.qty - l.spoiled - l.discarded - l.cleared) }); }));
  orders(false).filter(isDelivered).flatMap(o => o.items.map(i => ({ item: i.item, qty: i.qty, date: o.date }))).sort((a, b) => a.date < b.date ? -1 : 1)
    .forEach(s => { let q = s.qty; for (const lot of lots[s.item] || []) { if (q <= 0) break; if (lot.date > s.date || lot.left <= 0) continue; const u = Math.min(lot.left, q); lot.left -= u; q -= u; } });
  return Object.values(lots).flat().map(l => { const life = shelfLife(menuByName(l.item)); const exp = addDays(l.date, life); return { ...l, life, expires: exp, expired: l.left > 0 && exp <= t }; });
}
export const expiredLots = () => batchLots().filter(l => l.expired).sort((a, b) => a.expires < b.expires ? -1 : 1);

// Heavier views over the data, cached the same way.
customers = memo(customers); stockMap = memo(stockMap); fgStock = memo(fgStock); batchLots = memo(batchLots); materialLots = memo(materialLots); payables = memo(payables); supplierLedger = memo(supplierLedger); board = memo(board); production = memo(production);
