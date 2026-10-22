// Controls: approval limits (discounts, refunds, stock write-offs, purchase orders) with an on-the-spot approval by an admin or
// management person's PIN, every approval kept; and the audit trail: every change, who made it, when, on which device, and what changed.
import * as ev from "./events.js";
import * as sync from "./sync.js";
import * as M from "./model.js";
import * as R from "./roles.js";
import { S, V, H, chipBar, searchBox, band } from "./core.js";
import { download } from "./data.js";
import { periodBar, periodRange, periodLabel } from "./period.js";
import { esc, rs, uid, today, dLong, ICON } from "./util.js";
import { toast, ask } from "./ui.js";

/* ---------- approvals ---------- */
// Limits in Business settings (blank = no limit): discount % on a bill, refund ₹, stock write-off ₹ (wastage or a count that removes
// stock), and the PO value a buyer may approve on their own.
export const LIMITS = [["discount", "Discount on a bill above (%)", "%"], ["refund", "Refund above (₹)", "₹"], ["adjust", "Stock written off above (₹, wastage or counts)", "₹"], ["po", "PO a buyer approves on their own up to (₹)", "₹"]];
const limit = k => { const v = (M.config().approvals || {})[k]; return v === "" || v == null ? null : +v; };
const boss = () => R.isAdmin() || R.role() === "management";
const fmt = (k, v) => k === "discount" ? `${Math.round(v * 10) / 10}%` : rs(v);
// Resolves true when allowed: under the limit, by someone allowed, or approved now by an admin or management person with their PIN.
export async function approve(k, amount, what) {
  const lim = limit(k); if (lim == null || amount <= lim + 1e-9 || boss()) return true;
  const ok = R.members().filter(m => ["admin", "management"].includes(m.role) && R.hasPin(m));
  if (!ok.length) { toast(`${what} is above the limit of ${fmt(k, lim)}. Ask the admin to set a PIN so it can be approved here.`); return false; }
  const r = await ask(`<p class="cq">Needs approval</p><div class="cdetail">${esc(what)}: ${fmt(k, amount)}, above the limit of ${fmt(k, lim)}.</div>
    <select class="in" id="apWho" style="margin-top:10px">${ok.map(m => `<option value="${esc(m.id)}">${esc(m.name)} · ${esc(R.ROLES[m.role].label)}</option>`).join("")}</select>
    <input class="in" id="apPin" inputmode="numeric" maxlength="4" placeholder="Their PIN" style="margin-top:8px;text-align:center;font-size:20px;letter-spacing:.3em">`, [{ label: "Cancel", cls: "btn-ghost", value: false }, { label: "Approve", cls: "btn-primary", value: true }], true);
  if (!r) return false; const m = ev.get("members", (document.getElementById("apWho") || {}).value); const pin = (document.getElementById("apPin") || {}).value || "";
  if (!m || !await R.checkPin(m, pin)) { toast("Wrong PIN · not approved"); return false; }
  await ev.put("approvals", { id: uid("ap"), date: today(), kind: k, what, amount, limit: lim, approver: m.id, asked: (R.me() || {}).id || "", at: new Date().toISOString() }); sync.soon(); toast(`Approved by ${m.name}`); return true;
}
H.approve = approve;
H.poSelfLimit = () => limit("po");

/* ---------- audit trail ---------- */
const NOISE = new Set(["locks", "devices"]);
const AREA = { orders: "Orders", payments: "Payments", menu: "Menu", ingredients: "Materials", moves: "Stock moves", bakes: "Batches", config: "Settings", members: "Users", grns: "GRNs", transfers: "Transfers", fg: "Finished goods", suppliers: "Suppliers", plans: "Plans", porders: "Purchase orders", spays: "Supplier payments", wos: "Work orders", closes: "Day close", stocktakes: "Stock-takes", preturns: "Purchase returns", custs: "Customers", overheads: "Overheads", aviews: "Saved views", quotes: "Quotations", standing: "Standing orders", creturns: "Credit notes", contracts: "Rate contracts", lends: "Returnables", qlogs: "Food safety", complaints: "Complaints", licences: "Licences", equipment: "Equipment", mlogs: "Maintenance", approvals: "Approvals" };
function label(e) {
  const d = e.data || (ev.history(e.kind, e.rid).filter(x => x.data).at(-1) || {}).data || {}; const ings = M.ingMap();
  switch (e.kind) {
    case "orders": return `Order ${d.no || ""} · ${d.customer || ""}`;
    case "payments": { const o = ev.get("orders", d.orderId); return `${rs(d.amount || 0)} ${d.mode || ""}${o ? ` · order ${o.no}` : d.customer ? ` · ${d.customer}` : ""}`; }
    case "moves": { const i = ings[d.ingId]; return `${i ? i.name : "?"} ${d.qty > 0 ? "+" : ""}${Math.round((d.qty || 0) * 100) / 100} ${i ? i.unit : ""} · ${d.type || ""}${d.note ? " · " + d.note : ""}`; }
    case "config": return "Business settings"; case "members": return d.name || "Person";
    case "approvals": return `${d.what || ""} · approved by ${(ev.get("members", d.approver) || {}).name || "?"}`;
    default: return d.no ? `${d.no}${d.supplier ? " · " + d.supplier : d.customer ? " · " + d.customer : ""}` : d.name || d.customer || d.supplier || d.item || e.rid;
  }
}
// What changed against the record's previous version (field names only; money and quantities shown).
function changed(e) {
  const h = ev.history(e.kind, e.rid); const ix = h.findIndex(x => x.id === e.id); if (e.op === "del") return "Deleted"; if (ix <= 0) return "Created";
  const a = h[ix - 1].data || {}, b = e.data || {}; const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(k => !k.startsWith("_") && JSON.stringify(a[k]) !== JSON.stringify(b[k]));
  const show = k => ["status", "price", "rate", "qty", "amount", "total", "reorder", "role", "date", "discountPct", "discountAmt"].includes(k) && typeof b[k] !== "object" ? `${k}: ${a[k] ?? "–"} → ${b[k] ?? "–"}` : k;
  return keys.length ? "Changed " + keys.slice(0, 6).map(show).join(", ") + (keys.length > 6 ? ` +${keys.length - 6}` : "") : "Saved again (no change)";
}
V.audit = () => {
  if (!R.isAdmin() && R.role() !== "management") return band("Audit trail") + `<p class="hint">Only the admin and management see the audit trail.</p>`;
  const [a, b] = periodRange("audit"); const from = a + "T00:00:00", to = b + "T23:59:59.999"; const who = S.filter.auditWho || ""; const area = S.filter.auditArea || ""; const q = (S.query.audit || "").toLowerCase().trim();
  const devs = Object.fromEntries(ev.all("devices").map(d => [d.id, d.letter]));
  let rows = ev.events().filter(e => !NOISE.has(e.kind) && e.at >= from && e.at <= to && (!who || e.by === who) && (!area || e.kind === area)).sort((x, y) => x.at < y.at ? 1 : -1);
  const total = rows.length; rows = rows.slice(0, 1500).map(e => ({ e, lbl: label(e), what: changed(e) })); if (q) rows = rows.filter(r => (r.lbl + " " + r.what).toLowerCase().includes(q));
  S.auditRows = rows; const people = R.members(); const areas = [...new Set(ev.events().filter(e => !NOISE.has(e.kind)).map(e => e.kind))].sort();
  let h = band("Audit trail", `<button class="pillbtn" data-auditcsv>${ICON.dl}Excel</button>`, `<p class="bandnote">${esc(periodLabel("audit"))} · ${total} change${total === 1 ? "" : "s"}${total > 1500 ? " (latest 1,500 shown)" : ""}</p>`);
  h += `<div class="tools">${periodBar("audit")}<select class="in" data-auditwho style="width:auto"><option value="">Everyone</option>${people.map(m => `<option value="${esc(m.id)}" ${who === m.id ? "selected" : ""}>${esc(m.name)}</option>`).join("")}</select>
    <select class="in" data-auditarea style="width:auto"><option value="">Every area</option>${areas.map(k => `<option value="${esc(k)}" ${area === k ? "selected" : ""}>${esc(AREA[k] || k)}</option>`).join("")}</select>${searchBox("audit", "Search what changed")}</div>`;
  if (!rows.length) return h + `<div class="empty"><strong>No changes here</strong>Try another period or filter.</div>`;
  return h + `<div class="card tablecard"><table class="reg"><thead><tr><th>When</th><th>Who</th><th>Device</th><th>Area</th><th>Record</th><th>What changed</th></tr></thead><tbody>${rows.map(({ e, lbl, what }) => `<tr${e.kind === "orders" && e.data ? ` data-open="${esc(e.rid)}" tabindex="0"` : ""}><td data-v="${esc(e.at)}">${esc(new Date(e.at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }))}</td><td>${esc((ev.get("members", e.by) || {}).name || "–")}</td><td>${esc(devs[e.dev] || "–")}</td><td>${esc(AREA[e.kind] || e.kind)}</td><td>${esc(lbl)}</td><td class="items">${esc(what)}</td></tr>`).join("")}</tbody></table></div>
  <p class="hint">Every change is kept and synced; nothing here can be edited. Changes replaced long ago may have been tidied after 120 days, but the latest version of each record always stays.</p>`;
};
H.click.push(T => { if (S.view !== "audit") return false;
  if (T.closest("[data-auditcsv]")) { if (!R.can("export") && !R.isAdmin()) { toast("Your role can’t export"); return true; } download(`audit_${today()}.csv`, [["When", "Who", "Area", "Record", "What changed"], ...(S.auditRows || []).map(({ e, lbl, what }) => [e.at, (ev.get("members", e.by) || {}).name || "", AREA[e.kind] || e.kind, lbl, what])]); toast("Downloaded"); return true; }
  return false; });
H.change.push(T => { if (S.view !== "audit") return false; if (T.matches("[data-auditwho]")) { S.filter.auditWho = T.value; H.render(); return true; } if (T.matches("[data-auditarea]")) { S.filter.auditArea = T.value; H.render(); return true; } return false; });
