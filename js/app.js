// App shell: navigation by role, rendering, delegated events and start-up.
import * as ev from "./events.js";
import * as sync from "./sync.js";
import * as M from "./model.js";
import * as R from "./roles.js";
import { S, A, V, H, hooks } from "./core.js";
import "./orders.js";
import "./money.js";
import "./inventory.js";
import { waSheet } from "./ops.js";
import { setupView, resumeSync, dailyReport } from "./admin.js";
import { APP_NAME } from "./config.js";
import { $, ICON } from "./util.js";
import { ui, toast, closeSheet, yesNo } from "./ui.js";

const TAB = { today: ["Today", ICON.today], orders: ["Orders", ICON.orders], pay: ["Payments", ICON.pay], stock: ["Stock", ICON.stock], bake: ["Bake", ICON.oven], run: ["My run", ICON.run], sale: ["Sale", ICON.cart], more: ["More", ICON.more] };
function allowedViews() {
  const t = R.tabs().slice();
  if (t.includes("today")) { t.push("bake", "run"); if (R.can("sale")) t.push("sale"); }
  return t;
}
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
function navHtml() {
  const tabs = R.tabs(); const owe = R.can("money") ? M.customers().filter(c => c.balance > 0).length : 0; const low = H.lowCount ? H.lowCount() : 0;
  return `<div class="nav-in" style="grid-template-columns:repeat(${tabs.length},1fr)">${tabs.map(t => `<button class="nb" data-view="${t}" aria-current="${S.view === t ? "page" : "false"}"><span class="dot">${TAB[t][1]}${t === "pay" && owe ? `<em>${owe}</em>` : ""}${t === "stock" && low ? `<em>${low}</em>` : ""}</span>${TAB[t][0]}</button>`).join("")}</div>`;
}
export function render() {
  applyTheme();
  if (!R.me()) { $("#nav").style.display = "none"; $("#fab").style.display = "none"; $("#main").innerHTML = setupView(); return; }
  $("#nav").style.display = "";
  if (!allowedViews().includes(S.view)) S.view = R.home();
  const v = S.view;
  const fabOn = (["today", "orders", "pay"].includes(v) && (R.can("orders.edit") || R.can("sale") || R.can("wa.import"))) || (v === "stock" && R.can("stock.buy"));
  $("#fab").style.display = fabOn ? "" : "none";
  $("#fab").innerHTML = v === "stock" ? `${ICON.plus}Add stock` : `${ICON.plus}New order`;
  $("#nav").innerHTML = navHtml();
  const a = document.activeElement; const sk = a && a.dataset && a.dataset.search; const pos = sk ? a.selectionStart : 0;
  const sx = $("#days") ? $("#days").scrollLeft : null;
  const back = !R.tabs().includes(v) ? `<button class="backbar" data-go="${R.home()}">${ICON.back}Back to ${TAB[R.home()][0]}</button>` : "";
  $("#main").innerHTML = back + (V[v] ? V[v]() : "");
  if (sk) { const el = document.querySelector(`[data-search="${sk}"]`); if (el) { el.focus(); el.setSelectionRange(pos, pos); } }
  const days = $("#days");
  if (days) { if (sx != null && !S.center) days.scrollLeft = sx; else { const sel = days.querySelector('[aria-pressed="true"]'); if (sel) days.scrollLeft = sel.offsetLeft - days.clientWidth / 2 + sel.offsetWidth / 2; } S.center = false; }
}
function rerenderSheet() { const s = ui.sheet; if (!s || !s.redraw) return; $("#sheet").dataset.keep = "1"; const top = $("#sheet").scrollTop; s.redraw(); $("#sheet").scrollTop = top; }
hooks.render = render; hooks.rerenderSheet = rerenderSheet; H.render = render;
ui.onClose = () => render();

/* ---------- events ---------- */
const DIRTY = ["compose", "waConfirm"];
document.addEventListener("click", async e => {
  const T = e.target;
  const nb = T.closest(".nb"); if (nb) { S.view = nb.dataset.view; if (S.view === "today") S.center = true; render(); window.scrollTo({ top: 0 }); return; }
  const go = T.closest("[data-go]"); if (go) { if (ui.sheet) closeSheet(); S.view = go.dataset.go; if (go.dataset.stockfilter) S.filter.stock = go.dataset.stockfilter; render(); window.scrollTo({ top: 0 }); return; }
  if (T.closest("#fab")) { H.fab && H.fab(); return; }
  if (T.closest("[data-close]")) { const st = ui.sheet;
    if (st && DIRTY.includes(st.kind) && (st.dirty || st.kind === "waConfirm") && !await yesNo(`<p class="cq">Discard this order?</p><div class="cdetail">What you’ve entered will be lost.</div>`, "Discard", "btn-danger-solid", "Keep editing")) return;
    closeSheet(); return; }
  const f = T.closest("[data-filter]"); if (f) { const [k, v] = f.dataset.filter.split(":"); S.filter[k] = v; render(); return; }
  const tf = T.closest("[data-tagf]"); if (tf) { S.filter.ordersTag = tf.dataset.tagf; render(); return; }
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
  if (T.dataset && T.dataset.pickday != null) { if (T.value) { S.date = T.value; S.center = true; render(); } return; }
  for (const h of H.change) if (await h(T, e)) return;
});
document.addEventListener("keydown", e => { if (e.key === "Escape" && ui.sheet && !ui.confirmOpen) { const x = document.querySelector("[data-close]"); x ? x.click() : closeSheet(); } });
$("#scrim").addEventListener("click", () => { const x = document.querySelector("#sheet [data-close]"); x ? x.click() : closeSheet(); });

/* ---------- start ---------- */
(async () => {
  try { await ev.init(); } catch (err) { $("#main").innerHTML = `<div class="empty"><strong>Storage isn’t available</strong>This browser blocked local storage. Open the app in Chrome or Safari, not a private window.</div>`; return; }
  await R.loadMe();
  ev.setActor(() => (R.me() || {}).id || "setup");
  if (R.me()) S.view = R.home();
  ev.onChange(() => { if (ui.sheet && ui.sheet.redraw && !["compose", "waConfirm", "settings", "member", "ingEdit", "item", "move", "bake", "part"].includes(ui.sheet.kind)) rerenderSheet(); render(); });
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
})();
