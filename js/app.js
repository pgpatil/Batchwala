// App shell: navigation by role, rendering, delegated events and start-up.
import * as ev from "./events.js";
import * as sync from "./sync.js";
import * as M from "./model.js";
import * as R from "./roles.js";
import { S, A, V, H, hooks, logoHtml } from "./core.js";
import "./orders.js";
import "./money.js";
import "./inventory.js";
import "./batches.js";
import "./pos.js";
import "./bom.js";
import "./plan.js";
import "./purchase.js";
import "./wo.js";
import "./reports.js";
import { enhance } from "./table.js";
import "./erp.js";
import "./help.js";
import "./data.js";
import { waSheet } from "./ops.js";
import { setupView, resumeSync, dailyReport } from "./admin.js";
import { APP_NAME } from "./config.js";
import { $, esc, ICON } from "./util.js";
import { ui, toast, closeSheet, yesNo, focusKey, refocus } from "./ui.js";

const TAB = { help: ["Help", ICON.help], data: ["Import & export", ICON.dl], pos: ["Counter", ICON.cart], bom: ["BOM", ICON.tree], plan: ["Planning", ICON.plan], wo: ["Work orders", ICON.oven], po: ["Purchase orders", ICON.orders], sup: ["Suppliers & payables", ICON.people], insights: ["Cost & stock reports", ICON.chart], prod: ["Production", ICON.oven], grn: ["Purchases (GRN)", ICON.inbox], xfer: ["Transfers", ICON.truck], fg: ["Finished goods", ICON.batch], today: ["Today", ICON.today], orders: ["Orders", ICON.orders], pay: ["Payments", ICON.pay], stock: ["Inventory", ICON.stock], bake: ["Bake board", ICON.oven], batches: ["Batches", ICON.batch], run: ["Delivery run", ICON.run], more: ["More", ICON.more] };
const SHORT = { plan: "Plan", wo: "Work orders", po: "POs", sup: "Payables", insights: "Reports", bake: "Bake", run: "My run", grn: "GRN", fg: "FG stock", prod: "Make" };   // bottom-bar labels on phones
const ORDER = ["pos", "today", "orders", "bake", "prod", "grn", "stock", "xfer", "fg", "batches", "bom", "run", "pay", "more"];
// Screens grouped into buckets: one bottom-bar button per bucket on phones, a strip of its screens on top of each page, sections in the sidebar.
const BUCKETS = { orders: ["Orders", ICON.orders, ["today", "orders", "run", "pay"]], make: ["Make", ICON.oven, ["plan", "wo", "prod", "bake", "batches", "bom"]], stores: ["Stores", ICON.store, ["po", "grn", "sup", "stock", "xfer", "fg"]] };
const bucketOf = v => Object.keys(BUCKETS).find(k => BUCKETS[k][2].includes(v));
const inBucket = k => BUCKETS[k][2].filter(v => allowedViews().includes(v));
const onBar = v => R.bar().includes(v) || R.bar().includes("@" + bucketOf(v));
H.onBar = onBar;
// Screens a role may open in the current mode, from its permissions; its phone tabs are a subset.
// Classic (nobody has ERP) shows restaurant and production screens together, as before.
function allowedViews() {
  const md = R.mode(); const t = R.tabs().slice(); const c = R.can; const rest = md !== "erp", erp = md !== "restaurant";
  if (rest) { if (c("sale")) t.push("pos"); if (c("deliver") && t.includes("today")) t.push("run"); if (t.includes("today") || c("bake.record")) t.push("bake"); }
  if (erp) {
    if (c("bake.record") || c("orders.edit")) t.push("batches");
    if (c("bake.record") || c("menu.edit") || c("stock.edit") || c("reports")) t.push("bom", "plan");
    if (c("stock.buy") || c("stock.count")) t.push("stock");
    if (c("stock.buy")) t.push("po", "grn"); if (c("stock.buy") || c("payables")) t.push("sup"); if (c("bake.record")) t.push("wo"); if (c("reports")) t.push("insights");
    if (md === "erp") { if (c("bake.record") || c("orders.edit")) t.push("prod"); if (c("transfer")) t.push("xfer"); t.push("fg"); }
  }
  t.push("help"); if (c("export") || R.isAdmin()) t.push("data");
  return [...new Set(t)];
}
H.canOpen = v => allowedViews().includes(v);
// Mode switch (people the admin gave both modes) and this device's location (when there is more than one).
export function switchersHtml() {
  const both = R.mode() !== "classic" && R.myModes().length > 1; const locs = M.locations();
  return `${both ? `<div class="seg modesw" role="group" aria-label="Mode">${Object.entries(M.MODES).map(([k, l]) => `<button data-mode="${k}" aria-pressed="${R.mode() === k}">${l}</button>`).join("")}</div>` : ""}
  ${locs.length > 1 ? `<label class="locsel"><span>Location</span><select data-here aria-label="This device’s location">${locs.map(l => `<option value="${esc(l.id)}" ${M.here() === l.id ? "selected" : ""}>${esc(l.name)}${l.kind === "kitchen" ? " (kitchen)" : ""}</option>`).join("")}</select></label>` : ""}`;
}
// Wide screens get a sidebar, side drawers and table views.
const wideQ = window.matchMedia("(min-width: 1024px)");
S.wide = wideQ.matches;
wideQ.addEventListener("change", e => { S.wide = e.matches; if (R.me()) render(); });
function applyTheme() {
  const c = M.config(); const hex = /^#[0-9a-f]{6}$/i.test(c.accent || "") ? c.accent : "#F7B718";
  const n = parseInt(hex.slice(1), 16), r = n >> 16, g = n >> 8 & 255, b = n & 255;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255; const mix = (v) => Math.round(v + (255 - v) * 0.35);
  const root = document.documentElement.style;
  root.setProperty("--accent", hex); root.setProperty("--marigold", hex); root.setProperty("--marigold-2", `rgb(${mix(r)},${mix(g)},${mix(b)})`);
  root.setProperty("--on-accent", lum > 0.6 ? "#2A1A10" : "#FFFFFF");
  document.querySelector('meta[name="theme-color"]').setAttribute("content", hex);
  document.title = `${c.business} · ${APP_NAME}`;
}
// One list for both layouts: phones show the role's tabs at the bottom; wide screens show every allowed screen in a sidebar (.dx = sidebar only).
function navHtml() {
  const tabs = R.tabs(); const views = allowedViews(); const owe = R.can("money") ? M.customers().filter(c => c.balance > 0).length : 0; const low = H.lowCount ? H.lowCount() : 0;
  const c = M.config(); const me = R.me();
  const links = [["customers", ICON.people, "Customers", R.can("customers")], ["reports", ICON.chart, "Sales & profit", R.can("reports")], ["insights", ICON.chart, "Cost & stock reports", views.includes("insights")], ["menu", ICON.menu, "Menu & recipes", R.can("menu.edit") || R.can("reports")], ["data", ICON.dl, "Import & export", R.can("export") || R.isAdmin()], ["help", ICON.help, "Help", true]].filter(x => x[3]);
  const badge = vs => `${vs.includes("pay") && owe ? `<em>${owe}</em>` : ""}${vs.includes("stock") && low ? `<em>${low}</em>` : ""}`;
  const btn = (t, cls) => `<button class="nb ${cls}" data-view="${t}" aria-current="${S.view === t ? "page" : "false"}"><span class="dot">${TAB[t][1]}${badge([t])}</span><span class="nl">${cls === "dx" ? TAB[t][0] : SHORT[t] || TAB[t][0]}</span></button>`;
  // Phone bar: a bucket with one screen is that screen; with several, it opens the one used last.
  const bar = R.bar().map(t => { if (t[0] !== "@") return views.includes(t) || t === "more" ? btn(t, "mx") : ""; const k = t.slice(1); const vs = inBucket(k); if (!vs.length) return ""; if (vs.length === 1) return btn(vs[0], "mx");
    const go = vs.includes(S.lastIn[k]) ? S.lastIn[k] : vs[0];
    return `<button class="nb mx" data-view="${go}" aria-current="${vs.includes(S.view) ? "page" : "false"}"><span class="dot">${BUCKETS[k][1]}${badge(vs)}</span><span class="nl">${BUCKETS[k][0]}</span></button>`; }).filter(Boolean);
  const loose = ORDER.filter(v => views.includes(v) && !bucketOf(v) && v !== "more");
  const side = loose.map(v => btn(v, "dx")).join("") + Object.keys(BUCKETS).map(k => { const vs = inBucket(k); return vs.length ? `<div class="nav-sep dx">${BUCKETS[k][0]}</div>` + vs.map(v => btn(v, "dx")).join("") : ""; }).join("");
  return `<div class="nav-brand">${logoHtml(c)}<div><b>${esc(c.business)}</b><small>${esc(me.name + " · " + R.ROLES[me.role].label)}</small></div></div><div class="nav-sw dx">${switchersHtml()}</div>
  <div class="nav-in" style="grid-template-columns:repeat(${bar.length},1fr)">${bar.join("")}${side}${views.includes("more") || tabs.includes("more") ? btn("more", "dx") : ""}
  ${links.length ? `<div class="nav-sep dx">Records</div>${links.map(([a, ic, l]) => `<button class="nb dx" data-act="${a}"><span class="dot">${ic}</span><span class="nl">${l}</span></button>`).join("")}` : ""}</div>
  <p class="nav-keys dx">Keys: <kbd>N</kbd> new · <kbd>/</kbd> search</p>`;
}
export function render() {
  applyTheme();
  if (!R.me()) { $("#nav").style.display = "none"; $("#fab").style.display = "none"; $("#main").innerHTML = setupView(); return; }
  $("#nav").style.display = "";
  if (!allowedViews().includes(S.view)) S.view = R.home();
  const v = S.view;
  const fabOn = (["today", "orders", "pay"].includes(v) && (R.can("orders.edit") || R.can("sale") || R.can("wa.import"))) || ((v === "stock" || v === "grn") && R.can("stock.buy")) || (v === "xfer" && R.can("transfer"));
  $("#fab").style.display = fabOn ? "" : "none";
  $("#fab").innerHTML = `${ICON.plus}${v === "grn" || (v === "stock" && R.mode() === "erp") ? "New GRN" : v === "stock" ? "Add stock" : v === "xfer" ? "New transfer" : "New order"}`;
  $("#nav").innerHTML = navHtml();
  const fk = focusKey($("#main"));
  const sx = $("#days") ? $("#days").scrollLeft : null;
  const bk = bucketOf(v); if (bk) S.lastIn[bk] = v; const sibs = bk ? inBucket(bk) : [];
  const back = sibs.length > 1 ? `<nav class="bucketbar" aria-label="${BUCKETS[bk][0]}">${sibs.map(x => `<button data-view="${x}" aria-current="${x === v ? "page" : "false"}">${SHORT[x] || TAB[x][0]}</button>`).join("")}</nav>`
    : !onBar(v) && !R.tabs().includes(v) ? `<button class="backbar" data-go="${R.home()}">${ICON.back}Back to ${SHORT[R.home()] || TAB[R.home()][0]}</button>` : "";
  // A redraw of the same page keeps open cards and the place in inner scrolling panes (ticket, chip rows, wide tables).
  const same = S.lastView === v; S.lastView = v; const PANES = ".pos-ticket, .chips.scroll, .tablecard";
  const opened = same ? [...document.querySelectorAll("#main details[open][id]")].map(d => d.id) : [];
  const panes = same ? [...document.querySelectorAll("#main " + PANES.split(", ").join(", #main "))].map(e => [e.scrollTop, e.scrollLeft]) : [];
  $("#main").innerHTML = back + (V[v] ? V[v]() : "");
  opened.forEach(id => { const d = document.getElementById(id); if (d) d.open = true; });
  enhance($("#main"), v);
  if (panes.length) document.querySelectorAll("#main " + PANES.split(", ").join(", #main ")).forEach((e, i) => { if (panes[i]) [e.scrollTop, e.scrollLeft] = panes[i]; });
  if (fk) refocus($("#main"), fk);
  const days = $("#days");
  if (days) { if (sx != null && !S.center) days.scrollLeft = sx; else { const sel = days.querySelector('[aria-pressed="true"]'); if (sel) days.scrollLeft = sel.offsetLeft - days.clientWidth / 2 + sel.offsetWidth / 2; } S.center = false; }
}
function rerenderSheet() { const s = ui.sheet; if (!s || !s.redraw) return; $("#sheet").dataset.keep = "1"; const top = $("#sheet").scrollTop; s.redraw(); $("#sheet").scrollTop = top; }
hooks.render = render; hooks.rerenderSheet = rerenderSheet; H.render = render;
H.switchers = switchersHtml;
ui.onClose = () => render();

/* ---------- events ---------- */
const DIRTY = ["compose", "waConfirm"];
document.addEventListener("click", async e => {
  const T = e.target;
  // Date inputs styled as chips are invisible; desktop browsers only open their picker from the calendar icon, so open it explicitly.
  const dl = T.closest && T.closest("label"); const di = T.matches && T.matches('input[type="date"]') ? T : dl && dl.querySelector('input[type="date"]');
  if (di && di.showPicker && e.isTrusted) { try { di.showPicker(); } catch (_) {} if (T !== di) e.preventDefault(); }
  const nb = T.closest(".nb[data-view], .bucketbar [data-view]"); if (nb) { S.view = nb.dataset.view; if (S.view === "today") S.center = true; render(); window.scrollTo({ top: 0 }); return; }
  const go = T.closest("[data-go]"); if (go) { if (ui.sheet) closeSheet(); S.view = go.dataset.go; if (go.dataset.stockfilter) S.filter.stock = go.dataset.stockfilter; render(); window.scrollTo({ top: 0 }); return; }
  if (T.closest("#fab")) { H.fab && H.fab(); return; }
  if (T.closest("[data-close]")) { const st = ui.sheet;
    if (st && DIRTY.includes(st.kind) && (st.dirty || st.kind === "waConfirm") && !await yesNo(`<p class="cq">Discard this order?</p><div class="cdetail">What you’ve entered will be lost.</div>`, "Discard", "btn-danger-solid", "Keep editing")) return;
    closeSheet(); return; }
  const f = T.closest("[data-filter]"); if (f) { const [k, v] = f.dataset.filter.split(":"); S.filter[k] = v; render(); return; }
  const tf = T.closest("[data-tagf]"); if (tf) { S.filter.ordersTag = tf.dataset.tagf; render(); return; }
  const md = T.closest("[data-mode]"); if (md) { R.setMode(md.dataset.mode); await ev.setMeta("mode", md.dataset.mode); S.view = R.home(); render(); window.scrollTo({ top: 0 }); return; }
  const cf = T.closest("[data-chanf]"); if (cf) { S.filter.ordersChan = cf.dataset.chanf; render(); return; }
  const dy = T.closest("[data-day]"); if (dy) { S.date = dy.dataset.day; render(); return; }
  const dv = T.closest("[data-deliver]"); if (dv) { const { confirmDeliver } = await import("./orders.js"); const o = M.orders().find(x => x.id === dv.dataset.deliver); if (o) confirmDeliver(o, true); return; }
  const op = T.closest("[data-open]"); if (op) { const { openOrder } = await import("./orders.js"); openOrder(op.dataset.open); return; }
  if (T.closest("[data-wa]")) { const st = ui.sheet; const o = st && st.id ? M.orders().find(x => x.id === st.id) : null; if (o && !o.phone) { e.preventDefault(); toast("Add a phone number first, or copy the message"); } return; }
  for (const h of H.click) if (await h(T, e)) return;
  const a = T.closest("[data-act]"); if (a && A[a.dataset.act]) { e.preventDefault(); A[a.dataset.act](a, e); }
});
document.addEventListener("input", e => {
  const T = e.target; const sk = T.dataset && T.dataset.search;
  if (sk) { S.query[sk] = T.value; if (ui.sheet && ui.sheet.redraw) { rerenderSheet(); const el = document.querySelector(`[data-search="${sk}"]`); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } } else render(); return; }
  for (const h of H.input) if (h(T, e)) return;
});
document.addEventListener("change", async e => {
  const T = e.target;
  if (T.dataset && T.dataset.here != null) { M.setHere(T.value); await ev.setMeta("here", T.value); render(); toast(`This device is now at ${M.locName(T.value)}`); return; }
  if (T.dataset && T.dataset.pickday != null) { if (T.value) { S.date = T.value; S.center = true; render(); } return; }
  for (const h of H.change) if (await h(T, e)) return;
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && ui.sheet && !ui.confirmOpen) { const x = document.querySelector("[data-close]"); x ? x.click() : closeSheet(); return; }
  const T = e.target;
  if (e.key === "Enter" && T.matches && T.matches("tr[data-open],tr[data-batch],tr[data-ing],tr[data-grn],tr[data-xfer],tr[data-po],tr[data-sup],tr[data-wo]")) { T.click(); return; }
  // Desktop shortcuts, only when nothing is being typed and no drawer or dialog is open
  if (!R.me() || ui.sheet || ui.confirmOpen || e.ctrlKey || e.metaKey || e.altKey || (T.closest && T.closest("input,textarea,select,[contenteditable]"))) return;
  if (e.key === "/") { const sb = document.querySelector("#main [data-search]"); if (sb) { e.preventDefault(); sb.focus(); } }
  else if ((e.key === "n" || e.key === "N") && $("#fab").style.display !== "none") { e.preventDefault(); H.fab(); }
});
$("#scrim").addEventListener("click", () => { const x = document.querySelector("#sheet [data-close]"); x ? x.click() : closeSheet(); });

/* ---------- start ---------- */
(async () => {
  try { await ev.init(); } catch (err) { $("#main").innerHTML = `<div class="empty"><strong>Storage isn’t available</strong>This browser blocked local storage. Open the app in Chrome or Safari, not a private window.</div>`; return; }
  await R.loadMe(); R.setMode(await ev.getMeta("mode")); M.setHere(await ev.getMeta("here") || (R.me() || {}).loc || null);
  ev.setActor(() => (R.me() || {}).id || "setup");
  if (R.me()) S.view = R.home();
  ev.onChange(() => { if (ui.sheet && ui.sheet.redraw && !["compose", "waConfirm", "settings", "member", "ingEdit", "item", "move", "bake", "part", "batchSpoil", "grn", "xfer", "fgAdj", "xferRecv", "imp", "invin", "expiry"].includes(ui.sheet.kind)) rerenderSheet(); render(); });
  sync.onStatus(async st => {
    let joined = false;
    if (st.state === "ok" && !R.me()) { const a = sync.current(); const m = a && R.matchEmail(a.account); if (m) { await R.setMe(m.id); S.view = R.home(); joined = true; toast(`Welcome, ${m.name}`); } }
    if (joined || S.view === "more" || !R.me()) render(); if (ui.sheet && ui.sheet.kind === "sync") ui.sheet.redraw(); if (st.state === "ok") dailyReport(); });
  render();
  await resumeSync();
  const qs = new URLSearchParams(location.search);
  const shared = [qs.get("title"), qs.get("text"), qs.get("url")].filter(Boolean).join("\n");
  if (R.me() && shared) { history.replaceState(null, "", location.pathname); waSheet(shared); }
  else if (R.me() && qs.get("action") === "new") { history.replaceState(null, "", location.pathname); H.fab(); }
  else if (H.expiryCheck) H.expiryCheck();
  // Coming back to the app after a while counts as opening it again.
  let away = 0; document.addEventListener("visibilitychange", () => { if (document.hidden) away = Date.now(); else if (away && Date.now() - away > 30 * 60 * 1000 && H.expiryCheck) H.expiryCheck(); });
})();
