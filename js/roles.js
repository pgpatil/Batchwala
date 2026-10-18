// Roles and permissions. Checked in the app on every screen and action.
// Note: with Drive storage these rules are enforced by the app only; see README.
import * as ev from "./events.js";

const MGMT = ["orders.edit", "orders.cancel", "sale", "deliver", "collect", "pay.record", "pay.reverse", "stock.buy", "stock.waste", "stock.count", "stock.edit",
  "bake.record", "transfer", "menu.edit", "prices", "customers", "phone", "reports", "export", "history", "money", "wa.import"];
// Phone tabs per mode. `classic` is used while nobody has ERP: one app with everything, as before ERP existed.
// Other screens a role may open (see app.js) are reached from the sidebar, More or in-page links.
const T = { boss: { classic: ["pos", "today", "orders", "pay", "more"], restaurant: ["pos", "today", "orders", "pay", "more"], erp: ["prod", "grn", "stock", "xfer", "more"] } };
export const ROLES = {
  admin:      { label: "Admin",      home: { classic: "pos", restaurant: "pos", erp: "prod" }, tabs: T.boss, perms: "*", note: "Every module, including users, settings, sync, backup and deleting records" },
  management: { label: "Management", home: { classic: "pos", restaurant: "pos", erp: "prod" }, tabs: T.boss, perms: MGMT, note: "Runs the business: counter, orders, money, purchases, stock, BOM, menu and prices, reports" },
  manager:    { label: "Manager",    home: { classic: "pos", restaurant: "pos", erp: "prod" }, tabs: T.boss, perms: MGMT.filter(p => !["menu.edit", "prices", "export", "history"].includes(p)), note: "Day-to-day operations; can’t change prices or recipes" },
  kitchen:    { label: "Kitchen",    home: { classic: "bake", restaurant: "bake", erp: "prod" }, tabs: { classic: ["bake", "batches", "bom", "stock", "more"], restaurant: ["bake", "more"], erp: ["prod", "batches", "xfer", "stock", "more"] }, perms: ["bake.record", "transfer", "stock.waste", "stock.count"], note: "Production, batches, transfers, BOM, wastage and stock counts; no money or phone numbers" },
  delivery:   { label: "Delivery",   home: { classic: "run", restaurant: "run", erp: "fg" }, tabs: { classic: ["run", "more"], restaurant: ["run", "more"], erp: ["fg", "more"] }, perms: ["deliver", "collect", "phone", "money"], note: "Today’s delivery run and payment collection" },
  counter:    { label: "Counter",    home: { classic: "pos", restaurant: "pos", erp: "fg" }, tabs: { classic: ["pos", "more"], restaurant: ["pos", "more"], erp: ["fg", "more"] }, perms: ["sale", "money"], note: "Punches walk-in orders (takeaway or dine-in) and Swiggy / Zomato sales" }
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
// The mode this device shows: classic while nobody has ERP; otherwise the person's chosen mode among those the admin gave them.
let modePick = null;
export const setMode = m => { modePick = m; };
export function myModes() { const m = me(); if (!m) return ["restaurant"]; return m.role === "admin" && !Array.isArray(m.modes) ? ["restaurant", "erp"] : (m.modes && m.modes.length ? m.modes : ["restaurant"]); }
const erpOn = () => ev.all("members").some(x => Array.isArray(x.modes) && x.modes.includes("erp"));
export function mode() { if (!erpOn()) return "classic"; const mm = myModes(); return mm.includes(modePick) ? modePick : mm[0]; }
export const tabs = () => (ROLES[role()] || ROLES.counter).tabs[mode()];
export const home = () => (ROLES[role()] || ROLES.counter).home[mode()];
export function matchEmail(email) { const e = String(email || "").toLowerCase(); return members().find(m => (m.email || "").toLowerCase() === e) || null; }
