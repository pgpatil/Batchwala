// Roles and permissions. Checked in the app on every screen and action.
// Note: with Drive storage these rules are enforced by the app only; see README.
import * as ev from "./events.js";

const MGMT = ["orders.edit", "orders.cancel", "sale", "deliver", "collect", "pay.record", "pay.reverse", "stock.buy", "stock.waste", "stock.count", "stock.edit",
  "bake.record", "menu.edit", "prices", "customers", "phone", "reports", "export", "history", "money", "wa.import"];
export const ROLES = {
  admin:      { label: "Admin",      home: "today", tabs: ["today", "orders", "pay", "stock", "more"], perms: "*", note: "Every module, including users, settings, sync, backup and deleting records" },
  management: { label: "Management", home: "today", tabs: ["today", "orders", "pay", "stock", "more"], perms: MGMT, note: "Runs the business: orders, money, stock, menu and prices, reports" },
  manager:    { label: "Manager",    home: "today", tabs: ["today", "orders", "pay", "stock", "more"], perms: MGMT.filter(p => !["menu.edit", "prices", "export", "history"].includes(p)), note: "Day-to-day operations; can’t change prices" },
  kitchen:    { label: "Kitchen",    home: "bake",  tabs: ["bake", "batches", "stock", "more"], perms: ["bake.record", "stock.waste", "stock.count"], note: "Bake board, batches, wastage and stock counts; no money or phone numbers" },
  delivery:   { label: "Delivery",   home: "run",   tabs: ["run", "more"], perms: ["deliver", "collect", "phone", "money"], note: "Today’s delivery run and payment collection" },
  counter:    { label: "Counter",    home: "sale",  tabs: ["sale", "more"], perms: ["sale", "money"], note: "Quick sales for walk-in and aggregator orders" }
};
export const ROLE_KEYS = Object.keys(ROLES);

let meId = null;
export async function loadMe() { meId = await ev.getMeta("me") || null; return me(); }
export async function setMe(id) { meId = id; await ev.setMeta("me", id); }
export const members = () => ev.all("members").sort((a, b) => ROLE_KEYS.indexOf(a.role) - ROLE_KEYS.indexOf(b.role) || a.name.localeCompare(b.name));
export function me() { return meId ? ev.get("members", meId) : null; }
export const role = () => { const m = me(); return m && ROLES[m.role] ? m.role : null; };
export function can(perm) { const r = ROLES[role()]; if (!r) return false; return r.perms === "*" || r.perms.includes(perm); }
export const isAdmin = () => role() === "admin";
export const tabs = () => (ROLES[role()] || ROLES.counter).tabs;
export const home = () => (ROLES[role()] || ROLES.counter).home;
export function matchEmail(email) { const e = String(email || "").toLowerCase(); return members().find(m => (m.email || "").toLowerCase() === e) || null; }
