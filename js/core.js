// Shared state, helpers and registries used by every screen module.
import * as ev from "./events.js";
import * as sync from "./sync.js";
import * as M from "./model.js";
import { can } from "./roles.js";
import { esc, rs, uid, today, ICON } from "./util.js";
import { toast } from "./ui.js";

export const S = { view: "today", date: today(), filter: {}, query: {}, center: true, lastIn: {} };
export const A = {};                       // actions: data-act="name" → A.name(el, event)
export const V = {};                       // views: V.today() → html
export const H = { click: [], input: [], change: [] };   // extra handlers; return true when handled
export const hooks = { render: () => {}, rerenderSheet: () => {} };
export const render = () => hooks.render();
export const rerenderSheet = () => hooks.rerenderSheet();

export function guard(perm) { if (can(perm)) return true; toast("Your role can’t do this. Ask an admin."); return false; }
export const clean = o => { const { _at, _by, ...r } = o; return JSON.parse(JSON.stringify(r)); };
// New orders belong to this device's location; tax rates are stamped on lines the first time they're saved.
export async function saveOrder(o) { const c = M.config(); await ev.put("orders", clean(M.withTax({ businessId: c.businessId, outletId: M.here(), ...o }))); sync.soon(); return true; }
export async function addPayment(o, amount, mode, note = "", reverses = "") {
  await ev.put("payments", { id: uid("p"), orderId: o.id, customerKey: M.ckey(o), amount: Math.round(amount * 100) / 100, mode: mode || "", date: today(), note, ...(reverses ? { reverses } : {}), businessId: M.config().businessId });
  sync.soon();
}
// Pay several orders oldest first; amount undefined = all balances in full
export async function payOrders(list, mode, amount) {
  let left = amount == null ? Infinity : amount;
  for (const o of list.slice().sort((a, b) => a.date < b.date ? -1 : 1)) { if (left <= 0) break; const b = M.bal(o); if (b <= 0) continue; const p = Math.min(b, left); left -= p; await addPayment(o, p, mode); }
}
export async function reversePayments(o) { for (const p of M.paymentsFor(o.id)) { if (p.amount > 0 && !M.paymentsFor(o.id).some(x => x.reverses === p.id)) await addPayment(o, -p.amount, p.mode, "Reversed", p.id); } }

export function logoHtml(c = M.config()) { return `<div class="logo">${c.logo ? `<img src="${esc(c.logo)}" alt="${esc(c.business)} logo">` : `<span class="mark">${esc((c.business || "B")[0])}</span>`}</div>`; }
export const toran = () => M.config().festive ? `<div class="toran" aria-hidden="true"></div>` : `<div class="bandedge" aria-hidden="true"></div>`;
export const chipBar = (key, chips) => `<div class="chips">${chips.map(c => `<button class="chip" data-filter="${key}:${c[0]}" aria-pressed="${S.filter[key] === c[0]}">${c[1]}${c[2] != null ? `<span class="n">${c[2]}</span>` : ""}</button>`).join("")}</div>`;
export const searchBox = (key, ph) => `<input class="search" data-search="${key}" type="search" placeholder="${ph}" value="${esc(S.query[key] || "")}" aria-label="${ph}">`;
export const matchQ = (key, o) => { const q = (S.query[key] || "").toLowerCase().trim(); return !q || ((o.customer || "") + " " + (o.flat || "") + " " + (o.phone || "") + " " + (o.no || "")).toLowerCase().includes(q); };
export const band = (title, right = "", extra = "") => `<div class="band"><div class="page-title"><h1 class="h">${title}</h1>${right}</div>${extra}${toran()}</div>`;
export function payTag(o) { if (o.status === "cancelled") return `<span class="tag t-due">Cancelled</span>`; const s = M.payState(o); return s === "paid" ? `<span class="tag t-paid">${ICON.check}Paid</span>` : s === "part" ? `<span class="tag t-part">${rs(M.bal(o))} due</span>` : `<span class="tag t-due">Unpaid</span>`; }
export const chanTag = o => o.channel && o.channel !== "whatsapp" ? `<span class="tag t-chan">${esc(M.chanLabel(o))}</span>` : "";
export const noLabel = o => o.no ? "#" + esc(o.no) : "";
