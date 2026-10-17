// Business rules over the event store: orders, payments, customers, stock, costing and the bake board.
import * as ev from "./events.js";
import { today, cmpFlat, flatKey } from "./util.js";

export const CHANNELS = { whatsapp: "WhatsApp", phone: "Phone", walkin: "Walk-in", swiggy: "Swiggy", zomato: "Zomato" };
export const PREORDER = ["whatsapp", "phone"];
export const STATUSES = ["received", "confirmed", "baking", "ready", "out", "delivered"];
export const STATUS_LABEL = { received: "Received", confirmed: "Confirmed", baking: "In a bake", ready: "Ready", out: "Out for delivery", delivered: "Delivered", cancelled: "Cancelled" };
export const DEFAULT_CONFIG = { id: "app", business: "My Bakery", tagline: "Home bakery", logo: "", accent: "#F7B718", upi: "", payee: "", activeTag: "", tags: [], festive: false, businessId: "b1", outletId: "home", folderName: "Batchwala data", clientId: "" };
export const config = () => ({ ...DEFAULT_CONFIG, ...(ev.get("config", "app") || {}) });

/* ---------- orders and payments ---------- */
export function normOrder(o) {
  const x = { no: "", customer: "", flat: "", phone: "", channel: "whatsapp", date: today(), items: [], discountPct: 0, status: "received", notes: "", tag: "", ...o };
  x.items = (x.items || []).map(i => ({ item: i.item || "", qty: +i.qty || 0, rate: +i.rate || 0, ...(i.menuId ? { menuId: i.menuId } : {}) }));
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
export const total = o => o.status === "cancelled" ? 0 : sub(o) - disc(o);
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
export const ingredients = () => ev.all("ingredients").map(i => ({ unit: "g", reorder: 0, cost: 0, barcode: "", ...i })).sort((a, b) => a.name.localeCompare(b.name));
export const moves = () => ev.all("moves").sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a._at < b._at ? 1 : -1));
export function stockMap() { const m = {}; ev.all("moves").forEach(v => { m[v.ingId] = (m[v.ingId] || 0) + (+v.qty || 0); }); return m; }
export function stockLevel(i, sm = stockMap()) { const s = sm[i.id] || 0; return { on: s, state: s <= 0 ? "out" : (i.reorder && s <= i.reorder ? "low" : "ok") }; }
export function unitCost(ing) {
  const p = ev.all("moves").filter(m => m.ingId === ing.id && m.type === "purchase" && m.qty > 0 && m.amount > 0).sort((a, b) => (a.date + a._at) < (b.date + b._at) ? 1 : -1)[0];
  return p ? p.amount / p.qty : (+ing.cost || 0);
}
export function recipeCost(m) {
  const ings = Object.fromEntries(ingredients().map(i => [i.id, i])); let cost = 0, missing = 0;
  (m.recipe || []).forEach(r => { const i = ings[r.ingId]; if (!i) { missing++; return; } const c = unitCost(i); if (!c) missing++; cost += c * (+r.qty || 0); });
  return { cost, missing, lines: (m.recipe || []).length };
}
export function requirement(lines) {
  const need = {}; const unknown = [];
  lines.forEach(l => { const m = menuByName(l.item); if (!m || !(m.recipe || []).length) { if (l.qty) unknown.push(l.item); return; } m.recipe.forEach(r => { need[r.ingId] = (need[r.ingId] || 0) + (+r.qty || 0) * l.qty; }); });
  return { need, unknown: [...new Set(unknown)] };
}
export const bakesOn = date => ev.all("bakes").filter(b => b.date === date);

/* ---------- bake board ---------- */
// Per item for a date: committed (pre-orders), par (kept ready for on-demand), baked, sold (counter and aggregator), left.
export function board(date) {
  const rows = new Map(); const row = name => { if (!rows.has(name)) rows.set(name, { item: name, committed: 0, par: 0, baked: 0, sold: 0 }); return rows.get(name); };
  orders(false).filter(o => o.date === date).forEach(o => o.items.forEach(i => { const r = row(i.item); if (PREORDER.includes(o.channel)) r.committed += i.qty; else r.sold += i.qty; }));
  menuActive().filter(m => m.par > 0).forEach(m => { row(m.name).par = m.par; });
  bakesOn(date).forEach(b => (b.lines || []).forEach(l => { row(l.item).baked += +l.qty || 0; }));
  return [...rows.values()].map(r => ({ ...r, toBake: Math.max(0, r.committed + r.par - r.baked), left: r.baked - r.committed - r.sold })).sort((a, b) => b.toBake - a.toBake || b.committed - a.committed);
}
