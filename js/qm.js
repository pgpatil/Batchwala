// Quality and upkeep: checking goods on receipt, daily food-safety logs (fridge and freezer temperatures, cleaning, pest checks),
// customer complaints with root cause and action, licences and certificates with expiry reminders, and equipment with service schedules.
import * as ev from "./events.js";
import * as sync from "./sync.js";
import * as M from "./model.js";
import * as R from "./roles.js";
import { asLines, layoutSwitch } from "./table.js";
import { S, V, H, guard, chipBar, searchBox, band, clean } from "./core.js";
import { printHtml } from "./plan.js";
import { esc, rs, num, uid, today, addDays, dLong, dLabel, qty, ICON } from "./util.js";
import { ui, toast, openSheet, closeSheet, yesNo, ask } from "./ui.js";

const me = () => (R.me() || {}).id || "";
const who = id => (ev.get("members", id) || {}).name || "";
const daysTo = d => Math.round((new Date(d + "T00:00:00") - new Date(today() + "T00:00:00")) / 864e5);

/* ---------- goods-receipt inspection ---------- */
const QC_CHECKS = ["Packaging intact", "Within best-before", "Right item and grade", "Clean, no pests or damage"];
const RJ_REASONS = ["Damaged", "Expired / short life", "Wrong item or grade", "Temperature too high", "Pest or contamination", "Other"];
export const qcState = g => !g.qc ? "none" : g.qc.lines.some(l => l.rejected > 0) ? "part" : "ok";
{ const prev = H.grnExtras; H.grnExtras = g => { const ings = M.ingMap(); const q = g.qc;
  return (prev ? prev(g) : "") + (g.void ? "" : `<label class="f" style="margin-top:12px">Inspection ${!q ? `<span class="tag t-camp">Not checked</span>` : qcState(g) === "ok" ? `<span class="tag t-paid">Accepted</span>` : `<span class="tag t-due">Part rejected</span>`}</label>
  ${q ? `<div class="kv">${q.checks.map(c => `<div><span>${esc(c.name)}</span><b class="${c.ok ? "" : "due"}">${c.ok ? "✓" : "✗"}</b></div>`).join("")}${q.temp !== "" && q.temp != null ? `<div><span>Temperature on arrival</span><b>${q.temp} °C</b></div>` : ""}
    ${q.lines.filter(l => l.rejected > 0).map(l => `<div><span>Rejected: ${esc((ings[l.ingId] || {}).name || "?")} · ${esc(l.reason)}</span><b class="due">${qty(l.rejected, (ings[l.ingId] || {}).unit || "")}</b></div>`).join("")}</div><p class="hint">By ${esc(who(q.by))} · ${esc(dLong(q.date))}${q.note ? " · " + esc(q.note) : ""}</p>` : ""}
  ${R.can("stock.buy") || R.can("stock.count") ? `<button class="btn btn-ghost" data-qcnew="${esc(g.id)}">${q ? "Inspect again" : "Inspect this delivery"}</button>` : ""}`); }; }
function qcSheet(id) {
  const g = M.grns().find(x => x.id === id); if (!g) return; const ings = M.ingMap(); const q = g.qc || {};
  const st = { kind: "qcNew", id, checks: QC_CHECKS.map(n => ({ name: n, ok: q.checks ? (q.checks.find(c => c.name === n) || { ok: true }).ok : true })), lines: g.lines.map(l => ({ ingId: l.ingId, qty: l.qty, rejected: ((q.lines || []).find(x => x.ingId === l.ingId) || {}).rejected || 0, reason: ((q.lines || []).find(x => x.ingId === l.ingId) || {}).reason || "" })) };
  st.redraw = () => drawQc(st); drawQc(st);
}
function drawQc(st) {
  const g = M.grns().find(x => x.id === st.id); const ings = M.ingMap();
  openSheet(st, `<div class="sh-head"><h2 class="h">Inspect ${esc(g.no)}</h2><button class="x" data-close aria-label="Close">×</button></div>
  <p class="hint" style="margin-top:-4px">${esc(g.supplier)} · ${esc(dLong(g.date))}</p>
  <label class="f">Checks</label><div class="chips">${st.checks.map((c, ix) => `<button class="chip" data-qcchk="${ix}" aria-pressed="${c.ok}">${c.ok ? "✓" : "✗"} ${esc(c.name)}</button>`).join("")}</div>
  <label class="f" for="qcTemp">Temperature on arrival °C <small class="mut">(chilled and frozen goods)</small></label><input class="in" id="qcTemp" inputmode="decimal" placeholder="Optional" value="${esc(st.temp ?? "")}">
  <label class="f">Rejected <small class="mut">(0 = accepted)</small></label><div class="kv">${st.lines.map((l, ix) => { const i = ings[l.ingId] || { name: "?", unit: "" };
    return `<div style="align-items:center;gap:8px;flex-wrap:wrap"><span>${esc(i.name)} <small class="mut">received ${qty(l.qty, i.unit)}</small></span><span style="display:flex;gap:6px;align-items:center"><input class="rate" data-qcrj="${ix}" inputmode="decimal" value="${l.rejected ? +(l.rejected / (i.unit === "pcs" ? 1 : 1000)).toFixed(3) : ""}" placeholder="0"><span class="unitlbl">${i.unit === "pcs" ? "pcs" : i.unit === "g" ? "kg" : "L"}</span>
      <select class="in" data-qcrs="${ix}" style="min-width:150px"><option value="">Reason…</option>${RJ_REASONS.map(r => `<option ${l.reason === r ? "selected" : ""}>${esc(r)}</option>`).join("")}</select></span></div>`; }).join("")}</div>
  <label class="f" for="qcNote">Note</label><input class="in" id="qcNote" placeholder="Optional">
  <button class="btn btn-primary" data-qcsave>Save inspection</button>`);
}
function syncQc(st) { const ings = M.ingMap(); const t = document.getElementById("qcTemp"); if (t) st.temp = t.value.trim();
  st.lines.forEach((l, ix) => { const i = ings[l.ingId] || { unit: "g" }; const v = document.querySelector(`[data-qcrj="${ix}"]`), r = document.querySelector(`[data-qcrs="${ix}"]`); if (v) l.rejected = Math.min(l.qty, Math.max(0, num(v.value) * (i.unit === "pcs" ? 1 : 1000))); if (r) l.reason = r.value; }); }
async function saveQc(st) {
  syncQc(st); const g = ev.get("grns", st.id); if (st.lines.some(l => l.rejected > 0 && !l.reason)) { toast("Give a reason for each rejection"); return; }
  const qc = { date: today(), by: me(), checks: st.checks, temp: st.temp === "" ? "" : num(st.temp), lines: st.lines.filter(l => l.rejected > 0).map(({ ingId, rejected, reason }) => ({ ingId, rejected, reason })), note: (document.getElementById("qcNote") || {}).value || "" };
  await ev.put("grns", { ...clean(g), qc }); sync.soon();
  if (qc.lines.length && H.dnSheet && R.can("stock.buy") && await yesNo(`<p class="cq">Send the rejected goods back?</p><div class="cdetail">Raise a debit note now: stock comes off and ${esc(g.supplier)}’s balance drops.</div>`, "Raise debit note", "btn-primary", "Later")) {
    H.dnSheet({ grnId: g.id }); const s2 = ui.sheet; if (s2 && s2.kind === "dnNew") { s2.x.reason = qc.lines[0].reason.startsWith("Expired") ? "Expired / near expiry" : qc.lines[0].reason.startsWith("Wrong") ? "Wrong item" : "Damaged";
      qc.lines.forEach(r => { const l = s2.x.lines.find(x => x.ingId === r.ingId); if (l) l.qty = Math.min(l.max, r.rejected); }); s2.redraw(); } return; }
  toast(qc.lines.length ? "Inspection saved · part rejected" : "Inspection saved · accepted"); H.grnDetail(g.id);
}

/* ---------- food-safety logs (HACCP) ---------- */
// Checks set by the admin: a temperature with its safe range, or a yes / no. Each day's entries are kept per check.
const DEF_CHECKS = [{ id: "fridge", name: "Fridge temperature", kind: "temp", min: 0, max: 5 }, { id: "freezer", name: "Freezer temperature", kind: "temp", min: -30, max: -18 },
  { id: "handwash", name: "Hand-wash station stocked (soap, towels)", kind: "yes" }, { id: "clean", name: "Kitchen and floors cleaned", kind: "yes" }, { id: "pest", name: "No signs of pests", kind: "yes" }, { id: "staff", name: "Staff in caps, aprons, gloves", kind: "yes" }];
export const qChecks = () => M.config().qChecks || DEF_CHECKS;
const logId = (d, c) => `${d}@${c}`;
export const dayLog = d => qChecks().map(c => ({ c, e: ev.get("qlogs", logId(d, c.id)) }));
const okOf = (c, v) => c.kind === "temp" ? v !== "" && v != null && +v >= +c.min && +v <= +c.max : v === true;
H.qlogDue = () => dayLog(today()).filter(x => !x.e).length;
V.qlog = () => {
  const d = S.qlogDate || today(); const rows = dayLog(d); const done = rows.filter(x => x.e).length; const bad = rows.filter(x => x.e && !x.e.ok).length;
  const days = Array.from({ length: 14 }, (_, i) => addDays(today(), -i)); const can = R.can("bake.record") || R.can("stock.count") || R.isAdmin();
  let h = band("Food safety logs", `<button class="pillbtn" data-qlprint>${ICON.print}Print month</button>${R.isAdmin() ? `<button class="pillbtn" data-qlsetup>Checks</button>` : ""}`, `<div class="stats"><div class="st"><b>${done}/${rows.length}</b><span>done for ${esc(dLabel(d))}</span></div><div class="st"><b class="${bad ? "due" : ""}">${bad}</b><span>out of range</span></div></div>`);
  h += `<div class="tools"><div class="chips scroll">${days.map(x => { const r = dayLog(x); const n = r.filter(y => y.e).length; return `<button class="chip" data-qldate="${x}" aria-pressed="${x === d}">${esc(dLabel(x))}${n < r.length ? ` <em class="pillnum">${r.length - n}</em>` : " ✓"}</button>`; }).join("")}</div></div>`;
  return h + `<div class="card" style="margin:0 12px"><div class="kv">${rows.map(({ c, e }) => `<div style="align-items:center;gap:8px;flex-wrap:wrap"><span><b>${esc(c.name)}</b>${c.kind === "temp" ? ` <small class="mut">safe ${c.min} to ${c.max} °C</small>` : ""}${e ? `<small class="mut" style="display:block">${esc(who(e.by))} · ${esc(new Date(e.at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }))}${e.note ? " · " + esc(e.note) : ""}</small>` : ""}</span>
    <span style="display:flex;gap:6px;align-items:center">${c.kind === "temp" ? `<input class="rate" data-qlv="${esc(c.id)}" inputmode="decimal" value="${e ? esc(e.value) : ""}" placeholder="°C" ${can ? "" : "disabled"}>` : `<button class="chip" data-qlyes="${esc(c.id)}" aria-pressed="${e ? e.value === true : false}" ${can ? "" : "disabled"}>Yes</button><button class="chip" data-qlno="${esc(c.id)}" aria-pressed="${e ? e.value === false : false}" ${can ? "" : "disabled"}>No</button>`}
    ${e ? (e.ok ? `<span class="tag t-paid">OK</span>` : `<span class="tag t-due">Action needed</span>`) : ""}</span></div>`).join("")}</div>
    <p class="hint">An entry out of range asks what was done about it (corrective action), which is kept with the log. The month prints as a sheet for inspections.</p></div>`;
};
async function saveLog(cid, value) {
  const d = S.qlogDate || today(); const c = qChecks().find(x => x.id === cid); if (!c) return; let ok = okOf(c, value); let note = "";
  if (!ok) { const r = await ask(`<p class="cq">${esc(c.name)}: ${c.kind === "temp" ? value + " °C is outside " + c.min + " to " + c.max + " °C" : "No"}</p><div class="cdetail">What was done about it?</div><input class="in" id="qlAct" placeholder="e.g. door left open, reset thermostat, re-checked at 11:30" style="margin-top:10px">`, [{ label: "Cancel", cls: "btn-ghost", value: false }, { label: "Save", cls: "btn-primary", value: true }], true);
    if (!r) { H.render(); return; } note = (document.getElementById("qlAct") || {}).value.trim(); if (!note) { toast("Write what was done"); H.render(); return; } }
  await ev.put("qlogs", { id: logId(d, cid), date: d, check: cid, value, ok, note, by: me(), at: new Date().toISOString() }); sync.soon(); H.render();
}
function printMonth() {
  const t = today(); const m0 = t.slice(0, 8) + "01"; const days = []; for (let d = m0; d <= t; d = addDays(d, 1)) days.push(d); const cs = qChecks();
  printHtml(`Food safety log · ${new Date(t).toLocaleDateString("en-IN", { month: "long", year: "numeric" })}`, `<div class="bcard tight"><div class="bc-step"><table><thead><tr><th>Date</th>${cs.map(c => `<th>${esc(c.name)}</th>`).join("")}<th>By</th></tr></thead><tbody>${days.map(d => `<tr><td>${esc(dLabel(d))}</td>${cs.map(c => { const e = ev.get("qlogs", logId(d, c.id)); return `<td>${!e ? "–" : c.kind === "temp" ? esc(e.value) + "°" : e.value ? "✓" : "✗"}${e && !e.ok ? " ⚠ " + esc(e.note || "") : ""}</td>`; }).join("")}<td>${esc([...new Set(cs.map(c => (ev.get("qlogs", logId(d, c.id)) || {}).by).filter(Boolean).map(who))].join(", "))}</td></tr>`).join("")}</tbody></table></div><div class="bc-sign"><span>Checked by ______</span><span>Food safety supervisor ______</span></div></div>`);
}
function checksSheet() {
  const st = { kind: "qlSetup", list: JSON.parse(JSON.stringify(qChecks())) }; st.redraw = () => drawChecks(st); drawChecks(st);
}
function drawChecks(st) {
  openSheet(st, `<div class="sh-head"><h2 class="h">Daily checks</h2><button class="x" data-close aria-label="Close">×</button></div>
  <div class="kv">${st.list.map((c, ix) => `<div style="align-items:center;gap:6px;flex-wrap:wrap"><input class="in" data-qcn="${ix}" value="${esc(c.name)}" style="flex:1;min-width:160px"><div class="chips">${[["temp", "Temperature"], ["yes", "Yes / no"]].map(([k, l]) => `<button class="chip" data-qck="${ix}:${k}" aria-pressed="${c.kind === k}">${l}</button>`).join("")}</div>${c.kind === "temp" ? `<input class="in" data-qcmin="${ix}" inputmode="decimal" value="${c.min}" style="max-width:70px" aria-label="Min °C"><input class="in" data-qcmax="${ix}" inputmode="decimal" value="${c.max}" style="max-width:70px" aria-label="Max °C">` : ""}<button class="rm" data-qcrm="${ix}" aria-label="Remove">×</button></div>`).join("")}</div>
  <button class="add-line" data-qcadd>+ Add a check</button><button class="btn btn-primary" data-qcsetsave>Save checks</button>`);
}
const syncChecks = st => st.list.forEach((c, ix) => { const n = document.querySelector(`[data-qcn="${ix}"]`), a = document.querySelector(`[data-qcmin="${ix}"]`), b = document.querySelector(`[data-qcmax="${ix}"]`); if (n) c.name = n.value.trim(); if (a) c.min = num(a.value); if (b) c.max = num(b.value); });

/* ---------- complaints ---------- */
const C_KINDS = ["Taste / quality", "Foreign object", "Allergen", "Stale / expired", "Wrong or missing item", "Late delivery", "Packaging", "Service", "Other"];
export const complaints = () => ev.all("complaints").sort((a, b) => (b.date + b._at).localeCompare(a.date + a._at));
H.complaintOpen = () => complaints().filter(c => c.status !== "closed").length;
{ const prev = H.orderExtras; H.orderExtras = o => (prev ? prev(o) : "") + (R.can("orders.edit") || R.can("money") ? `<button class="btn btn-ghost" data-ccnew="${esc(o.id)}">Log a complaint</button>` : ""); }
V.complaints = () => {
  S.filter.cc = S.filter.cc || "open"; const all = complaints(); const k = S.filter.cc; const list = all.filter(c => k === "all" || (k === "open" ? c.status !== "closed" : c.status === "closed"));
  const by = {}; all.forEach(c => { by[c.kind] = (by[c.kind] || 0) + 1; });
  let h = band("Complaints", `<button class="pillbtn" data-ccnew="">${ICON.plus}Log a complaint</button>`, `<div class="stats"><div class="st"><b class="${all.filter(c => c.status !== "closed").length ? "due" : ""}">${all.filter(c => c.status !== "closed").length}</b><span>open</span></div><div class="st"><b>${all.filter(c => c.date >= addDays(today(), -29)).length}</b><span>last 30 days</span></div>${Object.keys(by).length ? `<div class="st"><b>${esc(Object.entries(by).sort((a, b) => b[1] - a[1])[0][0])}</b><span>most common</span></div>` : ""}</div>`);
  h += `<div class="tools">${layoutSwitch("complaints")}${chipBar("cc", [["open", "Open"], ["closed", "Closed"], ["all", "All", all.length]])}</div>`;
  if (!list.length) return h + `<div class="empty"><strong>No complaints here</strong>Log customer complaints with what happened, the root cause and the action taken, and close them when sorted. Allergen and foreign-object complaints are marked serious.</div>`;
  return h + `<div class="card tablecard"><table class="reg"><thead><tr><th>No.</th><th>Date</th><th>Customer</th><th>Kind</th><th>Item</th><th>What happened</th><th>Status</th></tr></thead><tbody>${list.map(c => `<tr data-cc="${esc(c.id)}" tabindex="0"><td><b>${esc(c.no)}</b></td><td data-v="${esc(c.date)}">${esc(dLong(c.date))}</td><td>${esc(c.customer || "")}</td><td>${esc(c.kind)}${c.serious ? ` <span class="tag t-due">serious</span>` : ""}</td><td>${esc(c.item || "")}</td><td class="items">${esc(c.text || "")}</td><td>${c.status === "closed" ? `<span class="tag t-paid">Closed</span>` : `<span class="tag t-part">Open</span>`}</td></tr>`).join("")}</tbody></table></div>`;
};
function ccSheet(id, orderId = "", draft = null) {
  const c = id ? ev.get("complaints", id) : null; const o = orderId ? M.orders().find(x => x.id === orderId) : c && c.orderId ? M.orders().find(x => x.id === c.orderId) : null;
  const x = draft || (c ? clean(c) : null) || { kind: C_KINDS[0], customer: o ? o.customer : "", orderId: o ? o.id : "", item: o && o.items.length === 1 ? o.items[0].item : "", text: "", cause: "", action: "", status: "open" };
  openSheet({ kind: "ccEdit", id: id || "", x, redraw: () => ccSheet(id, orderId, x) }, `<div class="sh-head"><h2 class="h">${c ? esc(c.no) : "New complaint"}</h2><button class="x" data-close aria-label="Close">×</button></div>
  ${o ? `<p class="hint" style="margin-top:-4px">Order <button class="linkbtn" data-open="${esc(o.id)}">${esc(o.no)}</button> · ${esc(dLong(o.date))}</p>` : ""}
  <div class="two"><div><label class="f" for="ccCust">Customer</label><input class="in" id="ccCust" value="${esc(x.customer)}"></div><div><label class="f" for="ccItem">Item</label><input class="in" id="ccItem" list="ccItems" value="${esc(x.item || "")}"><datalist id="ccItems">${M.menu().map(m => `<option value="${esc(m.name)}">`).join("")}</datalist></div></div>
  <label class="f">Kind</label><div class="chips">${C_KINDS.map(k => `<button class="chip" data-cck="${esc(k)}" aria-pressed="${x.kind === k}">${esc(k)}</button>`).join("")}</div>
  <label class="f" for="ccText">What happened</label><textarea class="in" id="ccText" rows="2">${esc(x.text)}</textarea>
  <label class="f" for="ccCause">Root cause</label><textarea class="in" id="ccCause" rows="2" placeholder="e.g. tray not covered in transit">${esc(x.cause || "")}</textarea>
  <label class="f" for="ccAct">Action taken</label><textarea class="in" id="ccAct" rows="2" placeholder="e.g. replaced the cake, briefed the delivery team">${esc(x.action || "")}</textarea>
  <div class="btnrow"><button class="btn btn-primary" data-ccsave="open">Save</button><button class="btn btn-ok" data-ccsave="closed">Save and close</button></div>
  ${o && R.can("money") && H.orderExtras ? `<p class="hint">To credit the customer, use Return / credit note on the order.</p>` : ""}`);
}
async function saveCc(status) {
  const st = ui.sheet; const g = id => document.getElementById(id).value.trim(); const x = st.x; const text = g("ccText"); if (!text) { toast("Write what happened"); return; }
  if (status === "closed" && !g("ccAct")) { toast("Write the action taken before closing"); return; }
  const prev = st.id && ev.get("complaints", st.id); const serious = ["Foreign object", "Allergen"].includes(x.kind);
  const rec = { ...(prev ? clean(prev) : { id: uid("cc"), no: M.nextDocNo("complaints", R.numPrefix(), "CC"), date: today(), by: me() }), customer: g("ccCust"), item: g("ccItem"), kind: x.kind, serious, orderId: x.orderId || "", text, cause: g("ccCause"), action: g("ccAct"), status, ...(status === "closed" ? { closedAt: today() } : {}) };
  await ev.put("complaints", rec); sync.soon(); closeSheet(); toast(`${rec.no} ${status === "closed" ? "closed" : "saved"}`); H.render();
}

/* ---------- licences and certificates ---------- */
export const licences = () => ev.all("licences").sort((a, b) => (a.expiry || "9999") < (b.expiry || "9999") ? -1 : 1);
const licState = l => !l.expiry ? "ok" : l.expiry < today() ? "expired" : daysTo(l.expiry) <= (+l.remind || 30) ? "soon" : "ok";
H.licDue = () => licences().filter(l => licState(l) !== "ok").length;
V.lic = () => {
  const all = licences(); const can = R.isAdmin() || R.role() === "management";
  let h = band("Licences & certificates", can ? `<button class="pillbtn" data-licnew>${ICON.plus}Add</button>` : "", `<div class="stats"><div class="st"><b class="${all.some(l => licState(l) === "expired") ? "due" : ""}">${all.filter(l => licState(l) === "expired").length}</b><span>expired</span></div><div class="st"><b>${all.filter(l => licState(l) === "soon").length}</b><span>expiring soon</span></div><div class="st"><b>${all.length}</b><span>on file</span></div></div>`);
  if (!all.length) return h + `<div class="empty"><strong>Nothing on file yet</strong>Your FSSAI licence, GST and trade licences, fire NOC, staff medical certificates, and your suppliers’ FSSAI numbers, each with its expiry date. You’re reminded before they lapse.</div>`;
  return h + `<div class="card tablecard"><table class="reg"><thead><tr><th>What</th><th>Whose</th><th>Number</th><th>Expires</th><th>Status</th></tr></thead><tbody>${all.map(l => { const s = licState(l);
    return `<tr data-lic="${esc(l.id)}" tabindex="0"><td><b>${esc(l.name)}</b></td><td>${esc(l.holder || M.config().business)}</td><td>${esc(l.number || "")}</td><td data-v="${esc(l.expiry || "9999")}">${l.expiry ? esc(dLong(l.expiry)) : "No expiry"}</td><td>${s === "expired" ? `<span class="tag t-due">Expired</span>` : s === "soon" ? `<span class="tag t-part">${daysTo(l.expiry)} days left</span>` : `<span class="tag t-paid">Valid</span>`}</td></tr>`; }).join("")}</tbody></table></div>`;
};
function licSheet(id) {
  const l = id ? ev.get("licences", id) : { name: "", holder: "", number: "", expiry: "", remind: 30 }; const sups = M.suppliers().map(s => s.name);
  openSheet({ kind: "licEdit", id: id || "" }, `<div class="sh-head"><h2 class="h">${id ? esc(l.name) : "Licence or certificate"}</h2><button class="x" data-close aria-label="Close">×</button></div>
  <label class="f" for="lcName">What</label><input class="in" id="lcName" list="lcNames" value="${esc(l.name)}" placeholder="e.g. FSSAI licence"><datalist id="lcNames">${["FSSAI licence", "GST registration", "Trade licence", "Fire NOC", "Shop & establishment", "Staff medical certificate", "Pest control contract", "Water test report"].map(x => `<option value="${x}">`).join("")}</datalist>
  <label class="f" for="lcHolder">Whose <small class="mut">(blank = your business; or a supplier or staff name)</small></label><input class="in" id="lcHolder" list="lcHolders" value="${esc(l.holder || "")}"><datalist id="lcHolders">${[...sups, ...R.members().map(m => m.name)].map(x => `<option value="${esc(x)}">`).join("")}</datalist>
  <div class="two"><div><label class="f" for="lcNo">Number</label><input class="in" id="lcNo" value="${esc(l.number || "")}"></div><div><label class="f" for="lcExp">Expires</label><input class="in" id="lcExp" type="date" value="${esc(l.expiry || "")}"></div></div>
  <label class="f" for="lcRem">Remind how many days before</label><input class="in" id="lcRem" inputmode="numeric" value="${l.remind || 30}">
  <button class="btn btn-primary" data-licsave>Save</button>${id ? `<button class="btn btn-danger" data-licdel="${esc(id)}">Remove</button>` : ""}`);
}

/* ---------- equipment and maintenance ---------- */
export const equipment = () => ev.all("equipment").sort((a, b) => a.name.localeCompare(b.name));
const mlogs = id => ev.all("mlogs").filter(m => m.equipId === id).sort((a, b) => a.date < b.date ? 1 : -1);
const lastService = e => (mlogs(e.id).find(m => m.kind === "Service") || {}).date || e.bought || "";
const nextService = e => +e.every > 0 ? addDays(lastService(e) || today(), +e.every) : "";
H.equipDue = () => equipment().filter(e => nextService(e) && nextService(e) <= today()).length + equipment().filter(e => e.down).length;
V.equip = () => {
  const all = equipment(); const can = R.can("bake.record") || R.isAdmin(); const t = today(); const yr = addDays(t, -365);
  let h = band("Equipment", R.isAdmin() || R.role() === "management" ? `<button class="pillbtn" data-eqnew>${ICON.plus}Add equipment</button>` : "", `<div class="stats"><div class="st"><b class="${all.some(e => e.down) ? "due" : ""}">${all.filter(e => e.down).length}</b><span>down now</span></div><div class="st"><b>${all.filter(e => nextService(e) && nextService(e) <= t).length}</b><span>service due</span></div><div class="st"><b>${rs(ev.all("mlogs").filter(m => m.date >= yr).reduce((s, m) => s + (+m.cost || 0), 0))}</b><span>spent in a year</span></div></div>`);
  if (!all.length) return h + `<div class="empty"><strong>No equipment yet</strong>Ovens, mixers, proofers, fridges and freezers, with how often each is serviced. Log services and breakdowns; you’re reminded when a service is due.</div>`;
  h += `<div class="tools">${layoutSwitch("equip")}</div>`;
  return h + `<div class="card tablecard"><table class="reg"><thead><tr><th>Equipment</th><th>Where</th><th>Last service</th><th>Next service</th><th class="r">Breakdowns (year)</th><th>Status</th></tr></thead><tbody>${all.map(e => { const nx = nextService(e); const bd = mlogs(e.id).filter(m => m.kind === "Breakdown" && m.date >= yr).length;
    return `<tr data-eq="${esc(e.id)}" tabindex="0"><td><b>${esc(e.name)}</b>${e.model ? ` <small class="mut">${esc(e.model)}</small>` : ""}</td><td>${esc(M.locName(e.loc || M.locations()[0].id))}</td><td>${lastService(e) ? esc(dLong(lastService(e))) : "–"}</td><td data-v="${esc(nx || "9999")}">${nx ? `${nx <= t ? `<b class="due">${esc(dLabel(nx))}</b>` : esc(dLong(nx))}` : "–"}</td><td class="r">${bd || "–"}</td><td>${e.down ? `<span class="tag t-due">Down</span>` : `<span class="tag t-paid">Working</span>`}</td></tr>`; }).join("")}</tbody></table></div>`;
};
function eqDetail(id) {
  const e = ev.get("equipment", id); if (!e) { closeSheet(); return; } const ls = mlogs(id); const nx = nextService(e); const can = R.can("bake.record") || R.isAdmin();
  openSheet({ kind: "eqView", id, redraw: () => eqDetail(id) }, `<div class="sh-head"><h2 class="h">${esc(e.name)}</h2><button class="x" data-close aria-label="Close">×</button></div>
  <div class="subl" style="margin:-4px 0 10px">${esc(M.locName(e.loc || M.locations()[0].id))}${e.model ? " · " + esc(e.model) : ""}${e.serial ? " · S/N " + esc(e.serial) : ""}${e.warranty ? " · warranty till " + esc(dLong(e.warranty)) : ""}</div>
  ${e.down ? `<div class="banner bad">Down since ${esc(dLong(e.down))}</div>` : ""}
  <div class="kv"><div><span>Service every</span><b>${+e.every ? e.every + " days" : "–"}</b></div><div><span>Next service</span><b class="${nx && nx <= today() ? "due" : ""}">${nx ? esc(dLong(nx)) : "–"}</b></div><div><span>Spent on it</span><b>${rs(ls.reduce((s, m) => s + (+m.cost || 0), 0))}</b></div></div>
  ${can ? `<div class="btnrow"><button class="btn btn-ok" data-mlog="${esc(id)}:Service">Log a service</button>${e.down ? `<button class="btn btn-ok" data-mlog="${esc(id)}:Repair">Repaired · working again</button>` : `<button class="btn btn-danger" data-mlog="${esc(id)}:Breakdown">Report a breakdown</button>`}</div>` : ""}
  <label class="f" style="margin-top:12px">History</label><div class="kv">${ls.map(m => `<div><span><b>${esc(m.kind)}</b> · ${esc(dLong(m.date))}${m.note ? ` <small class="mut">${esc(m.note)}</small>` : ""}${m.hours ? ` <small class="mut">· ${m.hours} h down</small>` : ""}</span><span>${m.cost ? rs(m.cost) : ""}</span></div>`).join("") || `<div class="mut">Nothing yet.</div>`}</div>
  ${R.isAdmin() || R.role() === "management" ? `<button class="btn btn-ghost" data-eqedit="${esc(id)}">Edit details</button>` : ""}`);
}
function eqSheet(id) {
  const e = id ? ev.get("equipment", id) : { name: "", loc: M.here(), model: "", serial: "", bought: "", warranty: "", every: 90 };
  openSheet({ kind: "eqEdit", id: id || "" }, `<div class="sh-head"><h2 class="h">${id ? "Edit equipment" : "Add equipment"}</h2><button class="x" data-close aria-label="Close">×</button></div>
  <label class="f" for="eqName">Name</label><input class="in" id="eqName" value="${esc(e.name)}" placeholder="e.g. Deck oven 1">
  ${M.locations().length > 1 ? `<label class="f" for="eqLoc">Where</label><select class="in" id="eqLoc">${M.locations().map(l => `<option value="${esc(l.id)}" ${l.id === e.loc ? "selected" : ""}>${esc(l.name)}</option>`).join("")}</select>` : ""}
  <div class="two"><div><label class="f" for="eqModel">Make / model</label><input class="in" id="eqModel" value="${esc(e.model || "")}"></div><div><label class="f" for="eqSerial">Serial no.</label><input class="in" id="eqSerial" value="${esc(e.serial || "")}"></div></div>
  <div class="two"><div><label class="f" for="eqBought">Bought on</label><input class="in" id="eqBought" type="date" value="${esc(e.bought || "")}"></div><div><label class="f" for="eqWar">Warranty till</label><input class="in" id="eqWar" type="date" value="${esc(e.warranty || "")}"></div></div>
  <label class="f" for="eqEvery">Service every (days)</label><input class="in" id="eqEvery" inputmode="numeric" value="${e.every || ""}" placeholder="e.g. 90">
  <button class="btn btn-primary" data-eqsave>Save</button>`);
}

/* ---------- actions ---------- */
H.click.push(async T => {
  const st = ui.sheet;
  const qn = T.closest("[data-qcnew]"); if (qn) { qcSheet(qn.dataset.qcnew); return true; }
  if (st && st.kind === "qcNew") { const ck = T.closest("[data-qcchk]"); if (ck) { syncQc(st); const c = st.checks[+ck.dataset.qcchk]; c.ok = !c.ok; drawQc(st); return true; } if (T.closest("[data-qcsave]")) { await saveQc(st); return true; } }
  const qd = T.closest("[data-qldate]"); if (qd) { S.qlogDate = qd.dataset.qldate; H.render(); return true; }
  const qy = T.closest("[data-qlyes]"); if (qy) { await saveLog(qy.dataset.qlyes, true); return true; }
  const qno = T.closest("[data-qlno]"); if (qno) { await saveLog(qno.dataset.qlno, false); return true; }
  if (T.closest("[data-qlprint]")) { printMonth(); return true; }
  if (T.closest("[data-qlsetup]")) { checksSheet(); return true; }
  if (st && st.kind === "qlSetup") {
    const k = T.closest("[data-qck]"); if (k) { syncChecks(st); const [ix, kind] = k.dataset.qck.split(":"); Object.assign(st.list[+ix], kind === "temp" ? { kind, min: st.list[+ix].min ?? 0, max: st.list[+ix].max ?? 5 } : { kind }); drawChecks(st); return true; }
    const rm = T.closest("[data-qcrm]"); if (rm) { syncChecks(st); st.list.splice(+rm.dataset.qcrm, 1); drawChecks(st); return true; }
    if (T.closest("[data-qcadd]")) { syncChecks(st); st.list.push({ id: uid("qc"), name: "", kind: "yes" }); drawChecks(st); return true; }
    if (T.closest("[data-qcsetsave]")) { syncChecks(st); if (st.list.some(c => !c.name)) { toast("Name every check"); return true; } const { _at, _by, ...c } = ev.get("config", "app") || { id: "app" }; await ev.put("config", { ...c, id: "app", qChecks: st.list }); sync.soon(); closeSheet(); toast("Checks saved"); H.render(); return true; } }
  const cn = T.closest("[data-ccnew]"); if (cn) { ccSheet("", cn.dataset.ccnew); return true; }
  const cc = T.closest("[data-cc]"); if (cc) { ccSheet(cc.dataset.cc); return true; }
  if (st && st.kind === "ccEdit") { const k = T.closest("[data-cck]"); if (k) { ["ccCust", "ccItem", "ccText", "ccCause", "ccAct"].forEach(i => { const m = { ccCust: "customer", ccItem: "item", ccText: "text", ccCause: "cause", ccAct: "action" }[i]; st.x[m] = document.getElementById(i).value; }); st.x.kind = k.dataset.cck;
      ccSheet(st.id, st.x.orderId, st.x); return true; }
    const sv = T.closest("[data-ccsave]"); if (sv) { await saveCc(sv.dataset.ccsave); return true; } }
  if (T.closest("[data-licnew]")) { licSheet(""); return true; }
  const lc = T.closest("[data-lic]"); if (lc) { if (R.isAdmin() || R.role() === "management") licSheet(lc.dataset.lic); return true; }
  if (T.closest("[data-licsave]")) { const g = id => document.getElementById(id).value.trim(); if (!g("lcName")) { toast("What is it?"); return true; } const id = ui.sheet.id || uid("lc");
    await ev.put("licences", { id, name: g("lcName"), holder: g("lcHolder"), number: g("lcNo"), expiry: g("lcExp"), remind: Math.max(1, Math.round(num(g("lcRem")) || 30)) }); sync.soon(); closeSheet(); toast("Saved"); H.render(); return true; }
  const ld = T.closest("[data-licdel]"); if (ld) { if (await yesNo(`<p class="cq">Remove this?</p>`, "Remove", "btn-danger-solid")) { await ev.del("licences", ld.dataset.licdel); sync.soon(); closeSheet(); H.render(); } return true; }
  if (T.closest("[data-eqnew]")) { eqSheet(""); return true; }
  const eq = T.closest("[data-eq]"); if (eq) { eqDetail(eq.dataset.eq); return true; }
  const ee = T.closest("[data-eqedit]"); if (ee) { eqSheet(ee.dataset.eqedit); return true; }
  if (T.closest("[data-eqsave]")) { const g = id => (document.getElementById(id) || {}).value || ""; if (!g("eqName").trim()) { toast("Name it"); return true; } const prev = ui.sheet.id && ev.get("equipment", ui.sheet.id);
    const rec = { ...(prev ? clean(prev) : { id: uid("eq") }), name: g("eqName").trim(), loc: g("eqLoc") || (prev ? prev.loc : M.here()), model: g("eqModel").trim(), serial: g("eqSerial").trim(), bought: g("eqBought"), warranty: g("eqWar"), every: Math.max(0, Math.round(num(g("eqEvery")))) };
    await ev.put("equipment", rec); sync.soon(); toast("Saved"); eqDetail(rec.id); H.render(); return true; }
  const ml = T.closest("[data-mlog]"); if (ml) { const [id, kind] = ml.dataset.mlog.split(":"); const e = ev.get("equipment", id);
    const r = await ask(`<p class="cq">${esc(kind === "Breakdown" ? "Breakdown of " : kind === "Repair" ? "Repair of " : "Service of ")}${esc(e.name)}</p><input class="in" id="mlNote" placeholder="${kind === "Breakdown" ? "What went wrong" : "What was done, by whom"}" style="margin-top:10px"><div class="two" style="margin-top:8px"><input class="in" id="mlCost" inputmode="numeric" placeholder="Cost ₹"><input class="in" id="mlHours" inputmode="decimal" placeholder="${kind === "Repair" ? "Hours it was down" : "Hours"}"></div>`, [{ label: "Cancel", cls: "btn-ghost", value: false }, { label: "Save", cls: "btn-primary", value: true }], true);
    if (!r) return true; const v = k => (document.getElementById(k) || {}).value || "";
    await ev.put("mlogs", { id: uid("ml"), equipId: id, date: today(), kind, note: v("mlNote").trim(), cost: Math.max(0, num(v("mlCost"))), hours: Math.max(0, num(v("mlHours"))), by: me() });
    await ev.put("equipment", { ...clean(e), down: kind === "Breakdown" ? today() : kind === "Repair" ? "" : e.down || "" }); sync.soon(); eqDetail(id); H.render(); return true; }
  return false;
});
H.change.push(T => { if (S.view !== "qlog" || !T.dataset.qlv || ui.sheet) return false; const v = T.value.trim(); if (v === "" || !/^-?\d+(\.\d+)?$/.test(v)) { if (v !== "") toast("Enter the temperature as a number"); return true; } saveLog(T.dataset.qlv, +v); return true; });
