// Roles and permissions. Checked in the app on every screen and action.
// Note: with Drive storage these rules are enforced by the app only; see README.
import * as ev from "./events.js";

const MGMT = ["orders.edit", "orders.cancel", "sale", "deliver", "collect", "pay.record", "pay.reverse", "stock.buy", "stock.waste", "stock.count", "stock.edit",
  "bake.record", "menu.edit", "prices", "customers", "phone", "reports", "export", "history", "money", "wa.import"];
// Phones show `tabs` at the bottom; other screens the role may open (see app.js) are reached from the sidebar, More or in-page links.
export const ROLES = {
  admin:      { label: "Admin",      home: "pos",   tabs: ["pos", "today", "orders", "pay", "more"], perms: "*", note: "Every module, including users, settings, sync, backup and deleting records" },
  management: { label: "Management", home: "pos",   tabs: ["pos", "today", "orders", "pay", "more"], perms: MGMT, note: "Runs the business: counter, orders, money, stock, BOM, menu and prices, reports" },
  manager:    { label: "Manager",    home: "pos",   tabs: ["pos", "today", "orders", "pay", "more"], perms: MGMT.filter(p => !["menu.edit", "prices", "export", "history"].includes(p)), note: "Day-to-day operations; can’t change prices or recipes" },
  kitchen:    { label: "Kitchen",    home: "bake",  tabs: ["bake", "batches", "bom", "stock", "more"], perms: ["bake.record", "stock.waste", "stock.count"], note: "Bake board, batches, BOM, wastage and stock counts; no money or phone numbers" },
  delivery:   { label: "Delivery",   home: "run",   tabs: ["run", "more"], perms: ["deliver", "collect", "phone", "money"], note: "Today’s delivery run and payment collection" },
  counter:    { label: "Counter",    home: "pos",   tabs: ["pos", "more"], perms: ["sale", "money"], note: "Punches walk-in orders (takeaway or dine-in) and Swiggy / Zomato sales" }
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
