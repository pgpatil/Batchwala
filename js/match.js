// Matching names and checking new records against existing ones before they are created.
import * as M from "./model.js";
import { esc, plate } from "./util.js";
import { ask } from "./ui.js";

// Lower case, words only, simple plurals dropped: "Amul Butter (500g)" ~ "amul butter 500g".
export const norm = s => String(s || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean).map(w => w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w).join(" ");
function lev(a, b) { if (a === b) return 0; const v = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) { let prev = v[0]; v[0] = i; for (let j = 1; j <= b.length; j++) { const tmp = v[j]; v[j] = Math.min(v[j] + 1, v[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = tmp; } }
  return v[b.length]; }
// 0..1: the best of edit distance, shared words and one name containing the other.
export function sim(a, b) {
  const x = norm(a), y = norm(b); if (!x || !y) return 0; if (x === y) return 1;
  const cx = x.replace(/ /g, ""), cy = y.replace(/ /g, ""); if (cx === cy) return 0.97;
  const ed = 1 - lev(cx, cy) / Math.max(cx.length, cy.length);
  const tx = new Set(x.split(" ")), ty = new Set(y.split(" ")); const inter = [...tx].filter(w => ty.has(w)).length; const jac = inter / new Set([...tx, ...ty]).size;
  const short = Math.min(cx.length, cy.length), long = Math.max(cx.length, cy.length);
  const cont = short >= 4 && (cx.includes(cy) || cy.includes(cx)) ? 0.7 + 0.3 * short / long : 0;
  return Math.max(ed, jac, cont);
}
export const SIMILAR = 0.72;
// Records whose name (or remembered other names) is like `name`, best first.
export function similar(list, name, min = SIMILAR) {
  return list.map(x => ({ x, score: Math.max(sim(name, x.name), ...(x.aka || []).map(a => sim(name, a))) })).filter(r => r.score >= min).sort((a, b) => b.score - a.score);
}
// Exact match on the name or a remembered other name (e.g. what a supplier calls it).
export const byNameOrAka = (list, name) => { const n = norm(name); return n ? list.find(x => norm(x.name) === n || (x.aka || []).some(a => norm(a) === n)) : null; };

/* ---------- checks before creating ---------- */
// For a new menu item, material or supplier: if something similar exists, ask. Returns "new", the existing record, or null (go back).
export async function confirmNew(kind, name, list) {
  const hits = similar(list, name).slice(0, 3); if (!hits.length) return "new";
  const v = await ask(`<p class="cq">Is this already in the app?</p><div class="cdetail">You’re adding the ${esc(kind)} <b>${esc(name)}</b>. Similar ${esc(kind)}${hits.length > 1 ? "s" : ""} already exist${hits.length > 1 ? "" : "s"}:</div>`,
    [...hits.map((h, i) => ({ label: `Use “${esc(h.x.name)}”`, cls: i ? "btn-ghost" : "btn-ok", value: "x" + i })), { label: `No, add “${esc(name)}” as new`, cls: "btn-ghost", value: "new" }, { label: "Go back", cls: "btn-danger", value: null }]);
  return v === "new" ? "new" : v ? hits[+v.slice(1)].x : null;
}
const digits = p => String(p || "").replace(/\D/g, "").slice(-10);
const flatN = f => String(f || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
// Before a new customer is saved: the same flat or phone under another name, or a name very like an existing customer’s.
// Returns the customer to use ({ customer, flat, phone }) or "new", or null to go back.
export async function checkCustomer(o) {
  const name = String(o.customer || "").trim(); if (!name) return "new";
  const cs = M.customers(); if (cs.some(c => c.key === M.ckey(o))) return "new";   // already a known customer
  const f = flatN(o.flat), ph = digits(o.phone);
  const hits = cs.map(c => { const why = []; if (f && flatN(c.flat) === f) why.push(`flat ${c.flat}`); if (ph.length >= 10 && digits(c.phone) === ph) why.push(`phone ${c.phone}`);
    if (!why.length && sim(name, c.customer) >= 0.85) why.push("a very similar name"); return why.length ? { c, why } : null; }).filter(Boolean).slice(0, 3);
  if (!hits.length) return "new";
  const v = await ask(`${plate(o.flat)}<p class="cq">New customer, or someone you know?</p><div class="cdetail"><b>${esc(name)}</b> isn’t a saved customer, but these share ${esc([...new Set(hits.flatMap(h => h.why.map(w => w.split(" ")[0])))].join(" and "))}:<br>${hits.map(h => `${esc(h.c.customer)} · ${esc(h.why.join(", "))} · ${h.c.orders.length} order${h.c.orders.length > 1 ? "s" : ""}`).join("<br>")}</div>`,
    [...hits.map((h, i) => ({ label: `It’s ${esc(h.c.customer)}`, cls: i ? "btn-ghost" : "btn-ok", value: "c" + i })), { label: `New customer “${esc(name)}”`, cls: "btn-ghost", value: "new" }, { label: "Go back", cls: "btn-danger", value: null }]);
  if (v === "new") return "new"; if (!v) return null;
  const c = hits[+v.slice(1)].c; return { customer: c.customer, flat: c.flat, phone: o.phone || c.phone };
}
