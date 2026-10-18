// More tab, first-run setup, users and roles, business settings, cloud sync, backup, Excel export.
import * as ev from "./events.js";
import * as sync from "./sync.js";
import * as M from "./model.js";
import * as R from "./roles.js";
import { APP_NAME, GOOGLE_CLIENT_ID, DATA_FOLDER } from "./config.js";
import { createDriveAdapter } from "./storage/drive.js";
import * as L from "./lock.js";
import { S, A, V, H, guard, logoHtml, toran, clean } from "./core.js";
import { $, esc, rs, rs2, num, uid, today, cmpFlat, ICON } from "./util.js";
import { ui, toast, openSheet, closeSheet, ask, yesNo } from "./ui.js";

/* ---------- More ---------- */
V.more = () => {
  const c = M.config(); const me = R.me(); const st = sync.status;
  const items = [
    ["menu", "menu", "Menu, prices & recipes", `${M.menuActive().length} items on sale`, R.can("menu.edit") || R.can("reports")],
    ["@stock", "stock", "Inventory · RM / PM / semi-finished", `${M.ingredients().length} items`, !H.onBar("stock") && (R.can("stock.buy") || R.can("stock.count"))],
    ["@insights", "chart", "Cost & stock reports", "Food cost, wastage, variance, stock ageing, buying, tax, day book", !H.onBar("insights") && H.canOpen("insights")],
    ["@wo", "oven", "Work orders", "Issue materials, complete, see variance", !H.onBar("wo") && H.canOpen("wo")],
    ["@po", "orders", "Purchase orders", "Raise, approve, receive against", !H.onBar("po") && H.canOpen("po")],
    ["@sup", "people", "Suppliers & payables", "What you owe, payments, statements", !H.onBar("sup") && H.canOpen("sup")],
    ["@plan", "plan", "Planning", "What to make, semi-finished, indent and batch cards", !H.onBar("plan") && H.canOpen("plan")],
    ["@bom", "tree", "BOM", "Multilevel bills of materials", !H.onBar("bom") && (R.can("menu.edit") || R.can("reports") || R.can("bake.record"))],
    ["@batches", "batch", "Batches", `${M.batches().filter(b => !b.void).length} recorded · pieces, spoilage and cost`, !H.onBar("batches") && (R.can("bake.record") || R.can("orders.edit"))],
    ["customers", "people", "Customers", `${M.customers().length} saved`, R.can("customers")],
    ["reports", "chart", "Sales & profit", "Sales by day and channel, best sellers, margins", R.can("reports")],
    ["users", "people", "Users & roles", `${R.members().length} people`, R.isAdmin()],
    ["settings", "gear", "Business settings", "Logo, name, colour, UPI ID, occasions", R.isAdmin()],
    ["syncSettings", "cloud", "Cloud sync (Google Drive)", st.state === "off" ? "Off · this phone only" : st.state === "ok" ? "On · up to date" : st.state === "error" ? "Needs attention" : "On", true],
    ["backup", "backup", "Backup & restore", "Save a backup file or load one", R.isAdmin()],
    ["export", "dl", "Export to Excel", "Orders, payments, batches, stock and menu", R.can("export")],
    ["data", "dl", "Import & export", "CSV by data type, with templates", R.can("export") || R.isAdmin()],
    ["help", "help", "Help", "How every screen and module works", true],
    ["switchUser", "people", "Switch user", "Hand this phone to someone else", true]
  ].filter(x => x[4]);
  return `<div class="band"><div class="top">${logoHtml(c)}<div class="biz"><div class="name">${esc(c.business)}</div><div class="sub">${esc(me ? me.name + " · " + R.ROLES[me.role].label : "")}</div></div></div>${toran()}</div>
  ${H.switchers ? `<div class="moresw">${H.switchers()}</div>` : ""}
  <div class="menu-list" style="margin-top:14px">${items.map(([a, ic, t, s]) => `<button class="mi" ${a[0] === "@" ? `data-go="${a.slice(1)}"` : `data-act="${a}"`}><span class="ic">${ICON[ic]}</span><span class="grow">${t}<small>${esc(s)}</small></span><span class="chev">${ICON.chev}</span></button>`).join("")}</div>
  <p class="hint" style="padding:4px 18px">${APP_NAME} 2.11${R.mode() !== "classic" ? " · " + esc(M.MODES[R.mode()]) + " mode" : ""} · ${st.state === "off" ? "data saved on this phone only" : "synced through Google Drive"}${st.last ? " · last sync " + new Date(st.last).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : ""}</p>`;
};

/* ---------- first run ---------- */
export function setupView() {
  return `<div class="band"><div class="top"><div class="logo"><span class="mark">${APP_NAME[0]}</span></div><div class="biz"><div class="name">${APP_NAME}</div><div class="sub">Orders, bakes, deliveries and payments</div></div></div><div class="bandedge"></div></div>
  <div class="setup">
    ${R.members().length ? `<div class="card pad"><h3 class="h">This app already has a team</h3><p class="hint">Ask an admin to add you in Users & roles, then join with Google above.</p></div>` : `<div class="card pad"><h3 class="h">Start fresh on this phone</h3><p class="hint">You become the admin. You can load your existing orders from a backup file afterwards.</p>
      <label class="f" for="suName">Your name</label><input class="in" id="suName" placeholder="e.g. Pankaj" autocomplete="name">
      <label class="f" for="suBiz">Business name</label><input class="in" id="suBiz" placeholder="e.g. Neena’s Magic">
      <button class="btn btn-primary" data-act="setupStart">Start</button></div>`}
    <div class="card pad"><h3 class="h">Join with Google</h3><p class="hint">For a second phone once the admin has turned on cloud sync and shared the data folder with you.</p>
      ${GOOGLE_CLIENT_ID ? `<button class="btn btn-ghost" data-act="setupJoin">Sign in with Google</button>` : `<p class="hint">Not available until the Google client ID is set in <code>js/config.js</code> (see README).</p>`}</div>
    <div class="card pad"><h3 class="h">Restore a backup</h3><p class="hint">A backup file saved from this app, or from the earlier tracker.</p>
      <label class="btn btn-ghost" style="position:relative">Choose backup file<input type="file" accept="application/json,.json" id="suFile" style="position:absolute;inset:0;opacity:0"></label></div>
  </div>`;
}
const prefixFor = name => { const used = new Set(R.members().map(m => m.prefix)); const base = (name.trim()[0] || "X").toUpperCase(); if (!used.has(base)) return base; for (const ch of name.toUpperCase().replace(/[^A-Z]/g, "").slice(1)) if (!used.has(base + ch)) return base + ch; for (const a of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") for (const b of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") if (!used.has(base + a + b)) return base + a + b; return base + "Z"; };
async function createMember(name, role, email = "") { const m = { id: uid("u"), name: name.trim(), role, email: email.trim().toLowerCase(), prefix: prefixFor(name), pin: "" }; await ev.put("members", m); return m; }
A.setupStart = async () => {
  const name = $("#suName").value.trim(), biz = $("#suBiz").value.trim();
  if (!name) { toast("Add your name"); $("#suName").focus(); return; }
  // A device that already holds a team's data (synced or restored) must not start a new business over it.
  if (R.members().length) { toast("This app already belongs to a team. Ask an admin to add you, then join with Google."); return; }
  const m = await createMember(name, "admin"); await R.setMe(m.id);
  if (!ev.get("config", "app")) await ev.put("config", { ...M.DEFAULT_CONFIG, business: biz || "My Bakery", businessId: uid("b") });
  S.view = R.home(); H.render(); toast("You’re the admin. Add your menu and materials first.");
};
A.setupJoin = async el => {
  el.disabled = true; el.textContent = "Connecting…";
  try {
    const a = createDriveAdapter({ clientId: GOOGLE_CLIENT_ID, folderName: DATA_FOLDER });
    const email = await a.connect(); await a.findOrCreateFolder(false);
    await ev.setMeta("drive", { clientId: GOOGLE_CLIENT_ID, folderName: DATA_FOLDER, folderId: a.folderId });
    await sync.use(a); await sync.syncNow();
    const m = R.matchEmail(email);
    if (m) { await R.setMe(m.id); S.view = R.home(); H.render(); toast(`Welcome, ${m.name}`); }
    else { toast(`${email} isn’t on the team yet. Ask the admin to add you in Users & roles.`); el.disabled = false; el.textContent = "Sign in with Google"; }
  } catch (e) { toast(e.message || "Couldn’t connect"); el.disabled = false; el.textContent = "Sign in with Google"; }
};

/* ---------- users ---------- */
function usersSheet() {
  if (!R.isAdmin()) return;
  const ms = R.members(); const meId = (R.me() || {}).id;
  openSheet({ kind: "users", redraw: usersSheet }, `<div class="sh-head"><h2 class="h">Users & roles</h2><button class="x" data-close aria-label="Close">×</button></div>
  <p class="hint" style="margin-top:-6px">Each role opens the app on its own home screen and sees only its own modules.</p>
  <div class="kv">${ms.map(m => `<div style="align-items:center"><button class="who" data-member="${esc(m.id)}"><div class="nm">${esc(m.name)}${m.id === meId ? " <small class='mut'>(you)</small>" : ""}</div><div class="subl">${esc(R.ROLES[m.role].label)}${m.email ? " · " + esc(m.email) : ""} · orders ${esc(m.prefix)}-…</div></button><span class="chev">${ICON.chev}</span></div>`).join("")}</div>
  <button class="btn btn-primary" data-act="newMember">${ICON.plus}Add a person</button>
  <label class="f" style="margin-top:14px">What each role can do</label>
  <div class="kv">${R.ROLE_KEYS.map(k => `<div><span><b>${esc(R.ROLES[k].label)}</b><small class="mut" style="display:block">${esc(R.ROLES[k].note)}</small></span></div>`).join("")}</div>`);
}
const modeKey = x => { const mm = Array.isArray(x.modes) ? x.modes : (x.role === "admin" && R.mode() !== "classic" ? ["restaurant", "erp"] : ["restaurant"]); return mm.length > 1 ? "both" : mm[0]; };
async function memberSheet(m) {
  const lk = m ? await L.open("members", m.id, m.name) : {}; if (!lk) return;
  const isNew = !m; const x = m ? { ...m } : { id: uid("u"), name: "", role: "management", email: "", prefix: "", pin: "" };
  const a = sync.current();
  openSheet({ ...lk, kind: "member", x, isNew }, `<div class="sh-head"><h2 class="h">${isNew ? "Add a person" : esc(x.name)}</h2><button class="x" data-close aria-label="Close">×</button></div>
  <label class="f" for="mbName">Name</label><input class="in" id="mbName" value="${esc(x.name)}">
  <label class="f">Role</label><div class="chips">${R.ROLE_KEYS.map(k => `<button class="chip" data-mrole="${k}" aria-pressed="${x.role === k}">${R.ROLES[k].label}</button>`).join("")}</div>
  <p class="hint" id="mbNote">${esc(R.ROLES[x.role].note)}</p>
  <label class="f">Uses</label><div class="chips">${[["restaurant", "Restaurant"], ["erp", "ERP"], ["both", "Both"]].map(([k, l]) => `<button class="chip" data-mmode="${k}" aria-pressed="${modeKey(x) === k}">${l}</button>`).join("")}</div>
  <p class="hint">Restaurant: counter, orders, payments, deliveries and the outlet’s bake board. ERP: purchases (GRN), stock by location, BOM, production, batches, transfers and finished goods. Both: a switch between the two.</p>
  ${M.locations().length > 1 ? `<label class="f" for="mbLoc">Usually works at</label><select class="in" id="mbLoc">${M.locations().map(l => `<option value="${esc(l.id)}" ${(x.loc || M.locations()[0].id) === l.id ? "selected" : ""}>${esc(l.name)}</option>`).join("")}</select>` : ""}
  <label class="f" for="mbEmail">Google account email <small class="mut">(for signing in on their own phone)</small></label><input class="in" id="mbEmail" type="email" value="${esc(x.email)}" autocapitalize="off">
  <label class="f" for="mbPin">PIN for switching on a shared phone <small class="mut">(optional, 4 digits)</small></label><input class="in" id="mbPin" inputmode="numeric" maxlength="4" value="${esc(x.pin || "")}">
  <button class="btn btn-primary" data-act="saveMember">${isNew ? "Add" : "Save"}</button>
  ${a && x.email ? `<button class="btn btn-ghost" data-act="shareFolder">Share the data folder with ${esc(x.email)}</button>` : ""}
  ${!isNew && x.id !== (R.me() || {}).id ? `<button class="btn btn-danger" data-act="removeMember">Remove ${esc(x.name)}</button>` : ""}`);
}
A.users = usersSheet;
A.newMember = () => memberSheet(null);
A.saveMember = async () => {
  const st = ui.sheet, x = st.x; x.name = $("#mbName").value.trim(); x.email = $("#mbEmail").value.trim().toLowerCase(); x.pin = $("#mbPin").value.replace(/\D/g, "").slice(0, 4);
  if (!x.name) { toast("Add a name"); return; }
  if (x.pin && x.pin.length !== 4) { toast("PIN must be 4 digits"); return; }
  if (!x.prefix) x.prefix = prefixFor(x.name);
  if (x.id === (R.me() || {}).id && x.role !== "admin" && R.members().filter(m => m.role === "admin").length < 2) { toast("Keep at least one admin"); return; }
  if ($("#mbLoc")) x.loc = $("#mbLoc").value;
  if (!await L.saveOk(st)) return;
  const erpBefore = M.erpOn(); const { _at, _by, ...rec } = x; await ev.put("members", rec);
  // ERP starts counting finished goods from the day it is first given to someone.
  if (!erpBefore && M.erpOn() && !M.config().erpStart) await ev.put("config", clean({ ...M.config(), erpStart: today(), id: "app" }));
  if (x.id === (R.me() || {}).id) { R.setMode(null); S.view = R.home(); }
  sync.soon(); toast(st.isNew ? `${x.name} added` : "Saved"); usersSheet();
};
A.removeMember = async () => { const x = ui.sheet.x; if (await yesNo(`<p class="cq">Remove ${esc(x.name)}?</p><div class="cdetail">They can no longer use the app. Their past work stays in the history.</div>`, "Remove", "btn-danger-solid")) { await ev.del("members", x.id); sync.soon(); usersSheet(); } };
A.shareFolder = async () => { const x = ui.sheet.x; const a = sync.current(); try { await a.ready(); await a.shareWith(x.email); toast(`Folder shared with ${x.email}`); } catch (e) { toast(e.message || "Couldn’t share the folder"); } };
A.switchUser = () => {
  const ms = R.members();
  openSheet({ kind: "switch" }, `<div class="sh-head"><h2 class="h">Who is using this phone?</h2><button class="x" data-close aria-label="Close">×</button></div>
  <div class="kv">${ms.map(m => `<div><button class="who" data-switch="${esc(m.id)}"><div class="nm">${esc(m.name)}</div><div class="subl">${esc(R.ROLES[m.role].label)}${m.pin ? " · PIN" : ""}</div></button><span class="chev">${ICON.chev}</span></div>`).join("")}</div>`);
};
H.click.push(async T => {
  const st = ui.sheet;
  const mb = T.closest("[data-member]"); if (mb) { memberSheet(ev.get("members", mb.dataset.member)); return true; }
  const mm = T.closest("[data-mmode]"); if (mm && st && st.kind === "member") { const k = mm.dataset.mmode; st.x.modes = k === "both" ? ["restaurant", "erp"] : [k]; document.querySelectorAll("[data-mmode]").forEach(b => b.setAttribute("aria-pressed", b.dataset.mmode === k)); return true; }
  const mr = T.closest("[data-mrole]"); if (mr && st && st.kind === "member") { st.x.role = mr.dataset.mrole; document.querySelectorAll("[data-mrole]").forEach(b => b.setAttribute("aria-pressed", b.dataset.mrole === st.x.role)); $("#mbNote").textContent = R.ROLES[st.x.role].note; return true; }
  const sw = T.closest("[data-switch]"); if (sw) { const m = ev.get("members", sw.dataset.switch);
    // Switching into an admin or management login needs that person's PIN; without one set, only they can use it on their own phone.
    if (["admin", "management"].includes(m.role) && !m.pin && m.id !== (R.me() || {}).id) { toast(`${m.name} has no PIN yet. They can set one in Users & roles to allow switching here.`); return true; }
    if (m.pin) { const v = await ask(`<p class="cq">PIN for ${esc(m.name)}</p><input class="in" id="pinIn" inputmode="numeric" maxlength="4" style="margin-top:12px;text-align:center;font-size:24px;letter-spacing:8px">`, [{ label: "Cancel", cls: "btn-ghost", value: false }, { label: "Unlock", cls: "btn-primary", value: true }], true);
      if (!v) return true; if (($("#pinIn") || {}).value !== m.pin) { toast("Wrong PIN"); return true; } }
    await R.setMe(m.id); R.setMode(null); await ev.setMeta("mode", null); if (m.loc) { M.setHere(m.loc); await ev.setMeta("here", m.loc); } S.view = R.home(); closeSheet(); toast(`Now using as ${m.name}`); return true; }
  if (st && st.kind === "settings") {
    const co = T.closest("[data-costing]"); if (co) { syncSettings(); st.c.costing = co.dataset.costing; drawSettings(st); return true; }
    const ti = T.closest("[data-taxincl]"); if (ti) { syncSettings(); st.c.tax.incl = ti.dataset.taxincl === "1"; drawSettings(st); return true; }
    const ts = T.closest("[data-taxsplit]"); if (ts) { syncSettings(); st.c.tax.split = ts.dataset.taxsplit === "1"; drawSettings(st); return true; }
    const lk = T.closest("[data-lockind]"); if (lk) { syncSettings(); const [ix, k] = lk.dataset.lockind.split(":"); st.c.locations[+ix].kind = k; drawSettings(st); return true; }
    const lr = T.closest("[data-locrm]"); if (lr) { syncSettings(); const l = st.c.locations[+lr.dataset.locrm];
      const used = ev.all("moves").some(m => m.outletId === l.id) || ev.all("orders").some(o => o.outletId === l.id) || ev.all("transfers").some(t => t.from === l.id || t.to === l.id) || ev.all("bakes").some(b => b.outletId === l.id);
      if (used) { toast(`${l.name} has records; rename it instead`); return true; } st.c.locations.splice(+lr.dataset.locrm, 1); drawSettings(st); return true; } }
  const dt = T.closest("[data-deltag]"); if (dt && st && st.kind === "settings") { syncSettings(); st.c.tags = (st.c.tags || []).filter(g => g !== dt.dataset.deltag); if (st.c.activeTag === dt.dataset.deltag) st.c.activeTag = ""; drawSettings(st); return true; }
  return false;
});

/* ---------- business settings ---------- */
async function settingsSheet() { if (!R.isAdmin()) return; const lk = await L.open("config", "app", "Business settings"); if (!lk) return; const c = JSON.parse(JSON.stringify(M.config())); c.tax = M.taxCfg(); c.locations = M.locations().map(l => ({ ...l }));
  const st = { ...lk, kind: "settings", c }; st.redraw = () => drawSettings(st); drawSettings(st); }
function hue(hex) { const n = parseInt(hex.slice(1), 16); const r = (n >> 16) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (!d) return -1; let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return (h * 60 + 360) % 360; }
function drawSettings(st) {
  const c = st.c;
  openSheet(st, `<div class="sh-head"><h2 class="h">Business settings</h2><button class="x" data-close aria-label="Close">×</button></div>
  <label class="f">Logo</label><div class="logoprev">${logoHtml(c)}<label class="btn btn-ghost" style="margin:0;flex:1;height:48px;position:relative">${c.logo ? "Change logo" : "Upload logo"}<input type="file" accept="image/*" id="sLogo" style="position:absolute;inset:0;opacity:0"></label>${c.logo ? `<button class="btn btn-danger" style="margin:0;width:auto;padding:0 12px;height:48px" data-act="removeLogo">Remove</button>` : ""}</div>
  <label class="f" for="sBiz">Business name</label><input class="in" id="sBiz" value="${esc(c.business)}">
  <label class="f" for="sTag">Tagline</label><input class="in" id="sTag" value="${esc(c.tagline || "")}" placeholder="Home bakery">
  <label class="f" for="sAccent">Brand colour <small class="mut">(header and main buttons only)</small></label><div class="two"><input class="in" id="sAccent" type="color" value="${esc(c.accent || "#F7B718")}" style="padding:4px"><span class="hint" id="sAccentNote" style="align-self:center"></span></div>
  <label class="f" style="display:flex;align-items:center;gap:12px">Festive border under the header <button class="swt" role="switch" aria-checked="${!!c.festive}" data-act="toggleFestive" aria-label="Festive border"></button></label>
  <div class="two"><div><label class="f" for="sUpi">UPI ID</label><input class="in" id="sUpi" value="${esc(c.upi || "")}" placeholder="name@okaxis" autocapitalize="off"></div>
  <div><label class="f" for="sPayee">Name on UPI</label><input class="in" id="sPayee" value="${esc(c.payee || "")}" placeholder="As shown in UPI app"></div></div>
  <p class="hint">The UPI ID goes into WhatsApp order messages and reminders.</p>
  <label class="f" style="display:flex;align-items:center;gap:12px;margin-top:18px">Charge tax on bills <button class="swt" role="switch" aria-checked="${!!c.tax.on}" data-act="toggleTax" aria-label="Tax on bills"></button></label>
  ${c.tax.on ? `<div class="two"><div><label class="f" for="sTaxName">Tax name</label><input class="in" id="sTaxName" value="${esc(c.tax.name)}" placeholder="GST"></div><div><label class="f" for="sTaxRate">Default rate %</label><input class="in" id="sTaxRate" inputmode="decimal" value="${esc(c.tax.rate)}"></div></div>
    <label class="f" for="sGstin">${esc(c.tax.name || "GST")}IN <small class="mut">(printed on bills)</small></label><input class="in" id="sGstin" value="${esc(c.tax.gstin || "")}" autocapitalize="characters" placeholder="Optional">
    <div class="chips" style="margin-top:10px"><button class="chip" data-taxincl="0" aria-pressed="${!c.tax.incl}">Prices exclude tax</button><button class="chip" data-taxincl="1" aria-pressed="${!!c.tax.incl}">Prices include tax</button></div>
    <div class="chips" style="margin-top:6px"><button class="chip" data-taxsplit="1" aria-pressed="${!!c.tax.split}">Split into C${esc(c.tax.name)} + S${esc(c.tax.name)}</button><button class="chip" data-taxsplit="0" aria-pressed="${!c.tax.split}">One line</button></div>
    <p class="hint">Each menu item and material can have its own rate (Menu & recipes, Stock); otherwise the default applies. New orders and GRNs use the rates at the time; old bills don’t change.</p>` : ""}
  <label class="f" style="margin-top:18px">Material cost</label><div class="chips">${[["avg", "Weighted average of stock"], ["last", "Last purchase price"]].map(([k, l]) => `<button class="chip" data-costing="${k}" aria-pressed="${(c.costing === "last" ? "last" : "avg") === k}">${l}</button>`).join("")}</div>
  <p class="hint">Used for recipe, batch and stock values. Average smooths price changes; old batches keep the cost they were saved with.</p>
  <label class="f" style="margin-top:18px">Locations</label><div class="kv">${c.locations.map((l, ix) => `<div style="align-items:center;gap:8px"><input class="in" data-locname="${ix}" value="${esc(l.name)}" style="flex:1;min-width:0"><div class="chips">${[["kitchen", "Kitchen"], ["outlet", "Outlet"]].map(([k, n]) => `<button class="chip" data-lockind="${ix}:${k}" aria-pressed="${l.kind === k}">${n}</button>`).join("")}</div>${ix ? `<button class="rm" data-locrm="${ix}" aria-label="Remove location">×</button>` : ""}</div>`).join("")}</div>
  <button class="add-line" data-act="addLocation">+ Add outlet or kitchen</button>
  <p class="hint">Kitchens make; outlets sell and receive transfers. The first location holds everything recorded before locations existed.</p>
  <label class="f" for="sTables">Dine-in tables at the counter</label><input class="in" id="sTables" inputmode="numeric" value="${esc(c.tables || 10)}" placeholder="10">
  <label class="f">Occasions</label><div class="chips">${(c.tags || []).map(g => `<span class="chip tagchip">${esc(g)}<button data-deltag="${esc(g)}" aria-label="Remove ${esc(g)}">×</button></span>`).join("") || `<span class="hint">None yet</span>`}</div>
  <div class="two" style="margin-top:8px"><input class="in" id="sNewTag" placeholder="e.g. Diwali 2026"><button class="btn btn-ghost" style="margin:0;height:48px" data-act="addTag">Add occasion</button></div>
  <label class="f" for="sActive">Tag new orders with</label><select class="in" id="sActive"><option value="">Nothing (regular orders)</option>${(c.tags || []).map(g => `<option ${g === c.activeTag ? "selected" : ""}>${esc(g)}</option>`).join("")}</select>
  <button class="btn btn-primary" data-act="saveSettings">Save settings</button>`);
}
function syncSettings() { const c = ui.sheet.c; const g = id => document.getElementById(id); c.business = g("sBiz").value.trim() || "My Bakery"; c.tagline = g("sTag").value.trim(); c.upi = g("sUpi").value.trim(); c.payee = g("sPayee").value.trim(); c.activeTag = g("sActive").value; c.accent = g("sAccent").value; c.tables = Math.min(60, Math.max(0, Math.round(num(g("sTables").value)))) || 10;
  if (g("sTaxName")) { c.tax.name = g("sTaxName").value.trim() || "GST"; c.tax.rate = num(g("sTaxRate").value); c.tax.gstin = g("sGstin").value.trim().toUpperCase(); }
  c.locations.forEach((l, ix) => { const el = document.querySelector(`[data-locname="${ix}"]`); if (el) l.name = el.value.trim() || l.name; }); }
async function shrinkImage(file, size = 256) {
  const url = URL.createObjectURL(file); const img = new Image(); img.src = url; await img.decode();
  const cv = document.createElement("canvas"); const s = Math.min(img.width, img.height); cv.width = cv.height = size;
  cv.getContext("2d").drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size); URL.revokeObjectURL(url); return cv.toDataURL("image/png");
}
A.settings = settingsSheet;
A.removeLogo = () => { syncSettings(); ui.sheet.c.logo = ""; drawSettings(ui.sheet); };
A.toggleTax = () => { syncSettings(); ui.sheet.c.tax.on = !ui.sheet.c.tax.on; drawSettings(ui.sheet); };
A.addLocation = () => { syncSettings(); const c = ui.sheet.c; c.locations.push({ id: uid("l"), name: `Outlet ${c.locations.filter(l => l.kind === "outlet").length + 1}`, kind: "outlet" }); drawSettings(ui.sheet); };
A.toggleFestive = () => { syncSettings(); ui.sheet.c.festive = !ui.sheet.c.festive; drawSettings(ui.sheet); };
A.addTag = () => { syncSettings(); const v = $("#sNewTag").value.trim(); if (!v) { toast("Type the occasion name"); return; } ui.sheet.c.tags = [...new Set([...(ui.sheet.c.tags || []), v])]; drawSettings(ui.sheet); };
A.saveSettings = async () => { syncSettings(); const h = hue(ui.sheet.c.accent); if (!await L.saveOk(ui.sheet)) return;
  if ((h >= 0 && (h < 15 || h > 340)) || (h > 100 && h < 170)) { toast("That colour is too close to the red or green used for status. Pick another."); return; }
  await ev.put("config", clean({ ...ui.sheet.c, id: "app" })); sync.soon(); closeSheet(); toast("Settings saved"); };
H.change.push(async T => {
  const st = ui.sheet; if (!st || st.kind !== "settings" || T.id !== "sLogo") return false;
  const f = T.files && T.files[0]; if (!f) return true; try { syncSettings(); st.c.logo = await shrinkImage(f); drawSettings(st); toast("Logo ready. Tap Save settings."); } catch (_) { toast("Use a PNG or JPG image"); } return true;
});

/* ---------- cloud sync ---------- */
function syncSheet() {
  const s = sync.status; const a = sync.current(); const cfg = M.config();
  const clientId = cfg.clientId || GOOGLE_CLIENT_ID;
  openSheet({ kind: "sync", redraw: syncSheet }, `<div class="sh-head"><h2 class="h">Cloud sync</h2><button class="x" data-close aria-label="Close">×</button></div>
  ${a ? `<div class="kv"><div><span>Status</span><b>${{ ok: "Up to date", syncing: "Syncing…", offline: "Offline", error: "Needs attention", idle: "Starting" }[s.state] || s.state}</b></div>
    <div><span>Google account</span><span>${esc(a.account || s.account || "")}</span></div><div><span>Last sync</span><span>${s.last ? new Date(s.last).toLocaleString("en-IN") : "Not yet"}</span></div></div>
    ${s.error ? `<p class="hint" style="color:var(--due)">${esc(s.error)}</p>` : ""}
    <button class="btn btn-primary" data-act="syncNow">Sync now</button>
    ${a.folderLink && a.folderLink() ? `<a class="btn btn-ghost" href="${esc(a.folderLink())}" target="_blank" rel="noopener">Open the data folder in Drive</a>` : ""}
    ${R.isAdmin() ? `<button class="btn btn-danger" data-act="syncOff">Turn off sync on this phone</button>` : ""}`
  : (R.isAdmin() ? `<p class="hint" style="margin-top:0">Sync keeps every phone up to date through one shared folder in your Google Drive. Each phone writes only its own files, so two people working at once never overwrite each other.</p>
    <label class="f" for="gClient">Google OAuth client ID</label><input class="in" id="gClient" value="${esc(clientId)}" placeholder="…apps.googleusercontent.com" autocapitalize="off">
    <p class="hint">Created once in Google Cloud Console; the README walks through it.</p>
    <label class="f" for="gFolder">Data folder name</label><input class="in" id="gFolder" value="${esc(cfg.folderName || DATA_FOLDER)}">
    <button class="btn btn-primary" data-act="syncOn">Connect Google Drive</button>`
  : `<p class="hint" style="margin-top:0">Sync is off on this phone. Ask the admin to share the data folder with your Google account, then sign in here.</p>
    <button class="btn btn-primary" data-act="syncJoin" ${clientId ? "" : "disabled"}>Sign in with Google</button>`)}`);
}
async function connectDrive(clientId, folderName, create) {
  const a = createDriveAdapter({ clientId, folderName });
  const email = await a.connect(); await a.findOrCreateFolder(create);
  await ev.setMeta("drive", { clientId, folderName, folderId: a.folderId });
  await sync.use(a); return email;
}
A.syncSettings = syncSheet;
A.syncNow = async () => { const a = sync.current(); try { if (a && a.reconnect) await a.reconnect(); } catch (_) {} await sync.syncNow(); syncSheet(); toast(sync.status.state === "ok" ? "Up to date" : sync.status.error || "Sync didn’t finish"); };
A.syncOff = async () => { if (await yesNo(`<p class="cq">Turn off sync?</p><div class="cdetail">Data stays on this phone. Other phones keep their copy.</div>`, "Turn off", "btn-danger-solid")) { await ev.setMeta("drive", null); await sync.use(null); syncSheet(); } };
A.syncOn = async el => { const id = $("#gClient").value.trim(), folder = $("#gFolder").value.trim() || DATA_FOLDER; if (!id) { toast("Paste the Google client ID first"); return; }
  el.disabled = true; el.textContent = "Connecting…";
  try { const email = await connectDrive(id, folder, true); const me = R.me(); if (me && !me.email) { await ev.put("members", { ...clean(me), email: email.toLowerCase() }); }
    await ev.put("config", clean({ ...M.config(), clientId: id, folderName: folder })); await sync.syncNow(); toast("Connected to Google Drive"); syncSheet(); }
  catch (e) { toast(e.message || "Couldn’t connect"); el.disabled = false; el.textContent = "Connect Google Drive"; } };
A.syncJoin = async el => { const cfg = M.config(); el.disabled = true;
  try { const email = await connectDrive(cfg.clientId || GOOGLE_CLIENT_ID, cfg.folderName || DATA_FOLDER, false); await sync.syncNow(); const m = R.matchEmail(email); if (m) await R.setMe(m.id); toast("Connected"); syncSheet(); }
  catch (e) { toast(e.message || "Couldn’t connect"); el.disabled = false; } };
export async function resumeSync() {
  try { const t = localStorage.getItem("bw.testAdapter"); if (t) { const { createHttpAdapter } = await import("../tests/http-adapter.js"); await sync.use(createHttpAdapter(t)); return; } } catch (_) {}
  const d = await ev.getMeta("drive"); if (!d || !d.clientId) return;
  await sync.use(createDriveAdapter({ clientId: d.clientId, folderName: d.folderName, folderId: d.folderId }));
}

/* ---------- backup and legacy import ---------- */
function backupSheet() {
  if (!R.isAdmin()) return;
  openSheet({ kind: "backup" }, `<div class="sh-head"><h2 class="h">Backup & restore</h2><button class="x" data-close aria-label="Close">×</button></div>
  <p class="hint" style="margin-top:0">A backup file holds every change ever made. Keep one even with cloud sync on.</p>
  <button class="btn btn-primary" data-act="saveBackup">${ICON.dl}Save backup file</button>
  <label class="btn btn-ghost" style="position:relative">Load a backup file<input type="file" accept="application/json,.json" id="bFile" style="position:absolute;inset:0;opacity:0"></label>
  <p class="hint">Loading adds the file’s data to what is here; nothing is deleted. Backups from the earlier Bakery POS and the Claude tracker are converted automatically.</p>`);
}
A.backup = backupSheet;
A.saveBackup = async () => { const data = { app: "batchwala", version: 2, exportedAt: new Date().toISOString(), events: await ev.allEvents() };
  const blob = new Blob([JSON.stringify(data)], { type: "application/json" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${APP_NAME.toLowerCase()}-backup-${today()}.json`; document.body.appendChild(a); a.click(); a.remove(); toast("Backup saved"); };
function aliasesFor(name) { const w = name.replace(/^[A-Z]\.\s*/, "").toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim(); const parts = w.split(" "); const out = new Set([w]);
  if (parts[0] && parts[0].length >= 4) out.add(parts[0]); const last = parts.at(-1); if (last && last.length >= 4) out.add(last.endsWith("s") ? last.slice(0, -1) : last); if (parts.length >= 2) out.add(parts[0] + parts[1]); return [...out].join(", "); }
export async function importFile(data) {
  // Restored events keep the device they came from; the next sync publishes them, so other devices and a new folder get them too.
  if (data && data.app === "batchwala" && Array.isArray(data.events)) { const n = await ev.ingest(data.events); await ev.setMeta("sync.publishForeign", true); sync.soon(); return n; }
  if (!data || !Array.isArray(data.records)) throw new Error("This isn’t a backup file from this app");
  let n = 0; const c = M.config();
  for (const r of data.records) {
    const { kind, updatedAt, ...rec } = r;
    if (kind === "menu") { await ev.put("menu", { ...rec, aliases: rec.aliases || aliasesFor(rec.name || ""), par: rec.par || 0 }); n++; }
    else if (kind === "orders") {
      const { delivered, received, mode, paidOn, deliveredAt, ...o } = rec;
      const order = { ...o, no: String(o.no || ""), channel: o.channel || "whatsapp", status: delivered ? "delivered" : (o.status || "received"), businessId: c.businessId, outletId: c.outletId };
      await ev.put("orders", order); n++;
      if (+received > 0) { await ev.put("payments", { id: uid("p"), orderId: order.id, customerKey: M.ckey(order), amount: +received, mode: mode || "", date: paidOn || o.date || today(), note: "Imported", businessId: c.businessId }); }
    }
    else if (kind === "config") { await ev.put("config", { ...c, business: rec.business || c.business, tagline: rec.tagline || c.tagline, upi: rec.upi || c.upi, payee: rec.payee || c.payee, tags: rec.tags || c.tags, activeTag: rec.activeTag ?? c.activeTag, logo: rec.logo || c.logo, id: "app" }); n++; }
    else if (["ingredients", "moves", "bakes"].includes(kind)) { await ev.put(kind, rec); n++; }
  }
  return n;
}
H.change.push(async T => {
  if (T.id !== "bFile" && T.id !== "suFile") return false;
  const f = T.files && T.files[0]; if (!f) return true;
  try { const data = JSON.parse(await f.text());
    if (T.id === "suFile" && !R.members().length && !(data.app === "batchwala")) { const m = await createMember("Admin", "admin"); await R.setMe(m.id); }
    const n = await importFile(data); sync.soon();
    if (!R.me()) { const admin = R.members().find(m => m.role === "admin"); if (admin) { await R.setMe(admin.id); S.view = R.home(); } }
    closeSheet(); H.render(); toast(`Loaded ${n} records`); }
  catch (err) { toast(err.message || "Couldn’t read that file"); }
  return true;
});

/* ---------- Excel ---------- */
export function buildWorkbook() {
  const X = window.XLSX; const wb = X.utils.book_new(); const os = M.orders().sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : cmpFlat(a, b));
  const L = [["Order #", "Date", "Location", "Channel", "Status", "Customer", "Flat", "Phone", "Occasion", "Item", "Qty", "Rate (₹)", "Line (₹)", "Tax %", "Offer %", "Tax (₹)", "Order total (₹)", "Received (₹)", "Balance (₹)", "Notes"]];
  os.forEach(o => o.items.forEach((i, ix) => L.push([o.no, o.date, M.locName(o.outletId || M.locations()[0].id), M.chanLabel(o), M.STATUS_LABEL[o.status] || o.status, o.customer, o.flat, o.phone, o.tag, i.item, i.qty, i.rate, i.qty * i.rate, i.taxPct || "", ix ? "" : o.discountPct || "", ix ? "" : M.taxOf(o).tax || "", ix ? "" : M.total(o), ix ? "" : M.received(o), ix ? "" : M.bal(o), ix ? "" : o.notes])));
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(L), "Orders");
  const byId = Object.fromEntries(os.map(o => [o.id, o]));
  const P = [["Date", "Order #", "Customer", "Amount (₹)", "Mode", "Note"]]; ev.all("payments").sort((a, b) => a.date < b.date ? -1 : 1).forEach(p => { const o = byId[p.orderId] || {}; P.push([p.date, o.no || "", o.customer || "", p.amount, p.mode, p.note || ""]); });
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(P), "Payments");
  const C = [["Customer", "Flat", "Phone", "Orders", "Total (₹)", "Received (₹)", "Balance (₹)", "Last order"]]; M.customers().sort(cmpFlat).forEach(c => C.push([c.customer, c.flat, c.phone, c.orders.length, c.spend, c.received, c.balance, c.last]));
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(C), "Customers");
  const sm = M.stockMap(); const I = [["Material", "Type", "Unit", "On hand", "Reorder at", "Cost per unit (₹)", "Stock value (₹)", "Supplier"]]; M.ingredients().forEach(i => { const c = M.unitCost(i); I.push([i.name, M.ING_TYPES[i.type], i.unit, sm[i.id] || 0, i.reorder, +c.toFixed(4), Math.round((sm[i.id] || 0) * c), i.supplier]); });
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(I), "Inventory");
  const ings = Object.fromEntries(M.ingredients().map(i => [i.id, i]));
  const Bm = [["Parent", "Parent type", "Per", "Component", "Component type", "Qty", "Unit", "Cost (₹)"]];
  M.menu().forEach(m => (m.recipe || []).forEach(r => { const i = ings[r.ingId]; if (i) Bm.push([m.name, "Finished item", "1 piece", i.name, M.ING_TYPES[i.type], r.qty, i.unit, Math.round(M.unitCost(i) * r.qty * 100) / 100]); }));
  M.ingredients().filter(x => x.type === "sf").forEach(x => x.recipe.forEach(r => { const i = ings[r.ingId]; if (i) Bm.push([x.name, "Semi-finished", `1 run (${x.yield} ${x.unit})`, i.name, M.ING_TYPES[i.type], r.qty, i.unit, Math.round(M.unitCost(i) * r.qty * 100) / 100]); }));
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(Bm), "BOM");
  const G = [["GRN", "Date", "Supplier", "Invoice", "Received at", "Material", "Qty", "Unit", "Amount (₹)", "Tax %", "GRN tax (₹)", "GRN total (₹)", "Status"]];
  M.grns().slice().reverse().forEach(g => g.lines.forEach((l, ix) => { const i = ings[l.ingId]; G.push([g.no, g.date, g.supplier, g.invoiceNo || "", M.locName(g.loc), i ? i.name : "?", l.qty, i ? i.unit : "", l.amount, l.taxPct || "", ix ? "" : g.tax || "", ix ? "" : g.total, g.void ? "Undone" : ""]); }));
  if (G.length > 1) X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(G), "GRNs");
  const Tr = [["Transfer", "Date", "From", "To", "Item or material", "Qty", "Unit", "Status"]];
  M.transfers().slice().reverse().forEach(t => t.lines.forEach(l => { const i = l.ingId ? ings[l.ingId] : null; Tr.push([t.no, t.date, M.locName(t.from), M.locName(t.to), l.item || (i ? i.name : "?"), l.qty, l.item ? "pcs" : (i ? i.unit : ""), t.void ? "Undone" : ""]); }));
  if (Tr.length > 1) X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(Tr), "Transfers");
  const V2 = [["Date", "Material", "Type", "Qty", "Unit", "Amount (₹)", "Note"]]; M.moves().forEach(m => { const i = ings[m.ingId]; V2.push([m.date, i ? i.name : "?", m.type, m.qty, i ? i.unit : "", m.amount || "", m.note || ""]); });
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(V2), "Stock movements");
  const Bt = [["Batch #", "Date", "Time", "Item", "Pieces", "Spoiled", "Batch cost (₹)", "Made by", "Note"]];
  M.batches().filter(b => !b.void).reverse().forEach(b => { const m = ev.get("members", b.madeBy || b._by); const at = b.at || b._at;
    b.lines.forEach((l, ix) => Bt.push([b.no, b.date, ix || !at ? "" : new Date(at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }), l.item, l.qty, l.spoiled, ix ? "" : Math.round(M.batchCost(b) * 100) / 100, ix ? "" : (m ? m.name : ""), ix ? "" : b.notes])); });
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(Bt), "Batches");
  const Mn = [["Item", "Category", "Price (₹)", "Short names", "Keep ready", "Recipe cost (₹)", "Margin %", "On sale"]]; M.menu().forEach(m => { const rc = M.recipeCost(m); Mn.push([m.name, m.category, m.price, m.aliases, m.par, rc.lines ? Math.round(rc.cost * 100) / 100 : "", rc.lines && m.price ? Math.round((1 - rc.cost / m.price) * 100) : "", m.active !== false ? "Yes" : "No"]); });
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(Mn), "Menu");
  return wb;
}
A.export = () => { if (!guard("export")) return; if (!window.XLSX) { toast("Excel export needs internet the first time"); return; }
  window.XLSX.writeFile(buildWorkbook(), `${(M.config().business || "bakery").replace(/[^\w]+/g, "_")}_${today()}.xlsx`); toast("Excel file saved"); };
// Daily readable copy in the Drive folder (admin and management phones only)
export async function dailyReport() {
  const a = sync.current(); if (!a || !window.XLSX || !(R.isAdmin() || R.role() === "management") || sync.status.state !== "ok") return;
  const key = "report." + today(); if (await ev.getMeta(key)) return;
  try { const buf = window.XLSX.write(buildWorkbook(), { bookType: "xlsx", type: "array" });
    await a.writeBinary(`Report_${today()}.xlsx`, new Blob([buf]), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"); await ev.setMeta(key, true); } catch (_) {}
}
