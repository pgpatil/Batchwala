// Inventory and production: Stock tab, ingredients, purchases, wastage, counts, recipes, the bake board and shopping list.
import * as ev from "./events.js";
import * as sync from "./sync.js";
import * as M from "./model.js";
import * as R from "./roles.js";
import { S, A, V, H, guard, chipBar, searchBox, band, toran } from "./core.js";
import { $, esc, rs, rs2, num, uid, today, addDays, dLong, dLabel, qty, UNITS, ICON, copyText, waHref } from "./util.js";
import { ui, toast, openSheet, closeSheet, ask, yesNo } from "./ui.js";

const big = u => UNITS[u] || null;
const unitChips = (u, sel, attr) => big(u) ? `<div class="chips unitchips">${[[u, 1], [big(u).big, big(u).f]].map(([n, f]) => `<button class="chip" data-${attr}="${f}" aria-pressed="${sel === f}">${n}</button>`).join("")}</div>` : `<span class="unitlbl">pcs</span>`;
const putMove = m => ev.put("moves", { id: uid("v"), date: today(), businessId: M.config().businessId, outletId: M.config().outletId, ...m }).then(() => sync.soon());
const stateTag = s => s === "out" ? `<span class="tag t-due">Out</span>` : s === "low" ? `<span class="tag t-part">Low</span>` : `<span class="tag t-paid">OK</span>`;
export function lowCount() { const sm = M.stockMap(); return M.ingredients().filter(i => M.stockLevel(i, sm).state !== "ok").length; }
H.lowCount = lowCount;
H.lowBadge = () => { const n = lowCount(); return n ? `<button class="pillbtn" data-go="stock" data-stockfilter="low" aria-label="${n} stock items low">${ICON.stock}${n} low</button>` : ""; };

/* ---------- Bake board ---------- */
V.bake = () => {
  const d = S.bakeDate || today(); const t = today(); const rows = M.board(d); const baked = M.bakesOn(d);
  const totalToBake = rows.reduce((s, r) => s + r.toBake, 0), committed = rows.reduce((s, r) => s + r.committed, 0);
  let h = band("Bake board", "", `<div class="stats"><div class="st"><b>${totalToBake}</b><span>pieces to bake</span></div><div class="st"><b>${committed}</b><span>pre-ordered</span></div><div class="st"><b>${rows.reduce((s, r) => s + r.baked, 0)}</b><span>baked so far</span></div></div>`);
  h += `<div class="tools"><div class="chips">${[t, addDays(t, 1), addDays(t, 2)].map((x, i) => `<button class="chip" data-bakedate="${x}" aria-pressed="${d === x}">${i === 0 ? "Today" : i === 1 ? "Tomorrow" : esc(dLong(x))}</button>`).join("")}</div></div>`;
  if (!rows.length) return h + `<div class="empty"><strong>Nothing to bake for ${esc(dLong(d))}</strong>Pre-orders and par levels for this day appear here.</div>`;
  h += `<ul class="list">${rows.map(r => `<li class="row board${r.toBake ? "" : " done"}"><div class="who"><div class="nm big">${esc(r.item)}</div><div class="subl">${r.committed} pre-ordered${r.par ? ` · ${r.par} kept ready` : ""}${r.sold ? ` · ${r.sold} sold at counter` : ""}${r.baked ? ` · ${r.baked} baked` : ""}${r.baked ? ` · ${Math.max(0, r.left)} left` : ""}</div></div>
    <div class="side"><div class="bignum">${r.toBake}</div><small class="mut">to bake</small></div></li>`).join("")}</ul>
  <div style="padding:0 12px 12px">${R.can("bake.record") ? `<button class="btn btn-primary" data-inv="bake" data-date="${d}">${ICON.oven}Record a bake</button>` : ""}
  ${baked.length ? `<label class="f">Bakes recorded</label><div class="kv">${baked.map(b => `<div><span>${(b.lines || []).map(l => esc(l.item) + " × " + l.qty).join(", ")}<small class="mut" style="display:block">${new Date(b.at || b._at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}</small></span>${R.can("bake.record") ? `<button class="linkbtn" data-undobake="${esc(b.id)}">Undo</button>` : ""}</div>`).join("")}</div>` : ""}</div>`;
  return h;
};
function bakeSheet(date) {
  if (!guard("bake.record")) return;
  const lines = M.board(date).filter(r => r.toBake > 0).map(r => ({ item: r.item, qty: r.toBake }));
  M.menuActive().forEach(m => { if (!lines.some(l => l.item === m.name)) lines.push({ item: m.name, qty: 0 }); });
  const st = { kind: "bake", date, lines }; st.redraw = () => drawBake(st); drawBake(st);
}
function drawBake(st) {
  const ings = Object.fromEntries(M.ingredients().map(i => [i.id, i])); const sm = M.stockMap();
  const { need, unknown } = M.requirement(st.lines); const ids = Object.keys(need).filter(id => ings[id]);
  const short = ids.filter(id => (sm[id] || 0) < need[id]);
  openSheet(st, `<div class="sh-head"><h2 class="h">Record bake</h2><button class="x" data-close aria-label="Close">×</button></div>
  <p class="hint" style="margin-top:-4px">${esc(dLong(st.date))} · pieces you are baking now</p>
  <div class="kv">${st.lines.map((l, ix) => `<div style="align-items:center"><span>${esc(l.item)}</span><div class="stepper"><button data-bstep="${ix}:-1" aria-label="One less">−</button><span>${l.qty}</span><button data-bstep="${ix}:1" aria-label="One more">+</button></div></div>`).join("")}</div>
  <label class="f" style="margin-top:14px">Stock this bake uses</label>
  ${ids.length ? `<div class="kv">${ids.map(id => { const i = ings[id]; const have = sm[id] || 0; const s = have < need[id];
    return `<div><span>${esc(i.name)}${s ? ` <span class="tag t-due">short ${qty(need[id] - have, i.unit)}</span>` : ""}</span><span>${qty(need[id], i.unit)} <small class="mut">/ ${qty(have, i.unit)}</small></span></div>`; }).join("")}</div>`
  : `<p class="hint">No recipe for these items yet, so stock won’t change. The bake still counts on the board.</p>`}
  ${unknown.length && ids.length ? `<p class="hint">No recipe yet for ${unknown.map(esc).join(", ")}.</p>` : ""}
  <button class="btn btn-primary" data-inv="saveBake" ${st.lines.some(l => l.qty > 0) ? "" : "disabled"}>${ICON.oven}Save bake</button>
  ${short.length ? `<p class="hint" style="color:var(--due)">${short.length} ingredient${short.length > 1 ? "s" : ""} will go below zero. Record purchases first, or save and fix with a stock count.</p>` : ""}`);
}

/* ---------- Stock tab ---------- */
V.stock = () => {
  S.filter.stock = S.filter.stock || "all";
  const money = R.can("money") && R.role() !== "kitchen";
  const sm = M.stockMap(); const ings = M.ingredients().map(i => ({ ...i, lv: M.stockLevel(i, sm), uc: M.unitCost(i) }));
  const low = ings.filter(i => i.lv.state !== "ok"); const value = ings.reduce((s, i) => s + Math.max(0, i.lv.on) * i.uc, 0);
  const m0 = today().slice(0, 8) + "01"; const spent = M.moves().filter(m => m.type === "purchase" && m.date >= m0).reduce((s, m) => s + (+m.amount || 0), 0);
  let h = band("Stock", R.can("stock.buy") ? `<button class="pillbtn" data-inv="shopping">${ICON.cart}Shopping list</button>` : "",
    `<div class="stats"><div class="st"><b>${low.length}</b><span>low or out</span></div>${money ? `<div class="st"><b>${rs(value)}</b><span>stock value</span></div><div class="st"><b>${rs(spent)}</b><span>bought this month</span></div>` : `<div class="st"><b>${ings.length}</b><span>ingredients</span></div>`}</div>`);
  const q = (S.query.stock || "").toLowerCase().trim();
  const rows = ings.filter(i => !q || (i.name + " " + (i.barcode || "")).toLowerCase().includes(q)).filter(i => S.filter.stock === "all" || (S.filter.stock === "low" ? i.lv.state !== "ok" : i.lv.state === "out"));
  h += `<div class="tools">${searchBox("stock", "Search or scan a barcode")}${chipBar("stock", [["all", "All", ings.length], ["low", "Low", low.length], ["out", "Out", ings.filter(i => i.lv.state === "out").length]])}</div>`;
  if (!ings.length) return h + `<div class="empty"><strong>Add your ingredients</strong>List what you buy with a reorder level. Purchases add stock; bakes use it up.${R.can("stock.edit") ? `<button class="btn btn-primary" data-inv="newIng" style="margin-top:14px">${ICON.plus}Add ingredient</button>` : ""}</div>`;
  if (!rows.length) return h + `<div class="empty"><strong>Nothing matches</strong>Try another search or filter.</div>`;
  h += `<ul class="list">${rows.map(i => { const pct = i.reorder ? Math.min(100, Math.max(0, i.lv.on / (i.reorder * 2) * 100)) : (i.lv.on > 0 ? 100 : 0);
    return `<li class="row${i.lv.state === "out" ? " warn" : ""}"><button class="who" data-ing="${esc(i.id)}"><div class="nm">${esc(i.name)}</div>
    <div class="subl">${stateTag(i.lv.state)} ${i.reorder ? "reorder at " + qty(i.reorder, i.unit) : "no reorder level"}${money && i.uc ? " · " + rs2(i.uc * (big(i.unit) ? big(i.unit).f : 1)) + "/" + (big(i.unit) ? big(i.unit).big : i.unit) : ""}</div>
    <div class="lvl"><i class="${i.lv.state}" style="width:${pct}%"></i></div></button><div class="amt">${qty(i.lv.on, i.unit)}</div></li>`; }).join("")}</ul>
  ${R.can("stock.edit") ? `<div style="padding:0 12px 20px"><button class="btn btn-ghost" data-inv="newIng">${ICON.plus}Add ingredient</button></div>` : ""}`;
  return h;
};

function ingSheet(id) {
  const i = M.ingredients().find(x => x.id === id); if (!i) { closeSheet(); return; }
  const money = R.can("money") && R.role() !== "kitchen";
  const lv = M.stockLevel(i); const uc = M.unitCost(i); const hist = M.moves().filter(m => m.ingId === id).slice(0, 40);
  const usedIn = M.menu().filter(m => (m.recipe || []).some(r => r.ingId === id));
  const label = { purchase: "Bought", bake: "Used in bake", waste: "Wasted", count: "Stock count", adjust: "Adjusted" };
  openSheet({ kind: "ing", id, redraw: () => ingSheet(id) }, `<div class="sh-head"><h2 class="h">${esc(i.name)}</h2><button class="x" data-close aria-label="Close">×</button></div>
  <div class="kpis" style="padding:0;margin-bottom:10px"><div class="kpi"><b>${qty(lv.on, i.unit)}</b><span>on hand ${stateTag(lv.state)}</span></div>${money ? `<div class="kpi"><b>${uc ? rs2(uc * (big(i.unit) ? big(i.unit).f : 1)) : "–"}</b><span>per ${big(i.unit) ? big(i.unit).big : i.unit}${uc ? " · value " + rs(Math.max(0, lv.on) * uc) : ""}</span></div>` : ""}</div>
  <div class="btnrow3">${R.can("stock.buy") ? `<button class="btn btn-ok" data-inv="buyThis">Bought</button>` : ""}${R.can("stock.waste") ? `<button class="btn btn-ghost" data-inv="wasteThis">Wasted</button>` : ""}${R.can("stock.count") ? `<button class="btn btn-ghost" data-inv="countThis">Count</button>` : ""}</div>
  <div class="kv" style="margin-top:12px"><div><span>Reorder level</span><span>${i.reorder ? qty(i.reorder, i.unit) : "Not set"}</span></div>${i.barcode ? `<div><span>Barcode</span><span>${esc(i.barcode)}</span></div>` : ""}<div><span>Used in</span><span>${usedIn.length ? usedIn.map(m => esc(m.name)).join(", ") : "No recipes yet"}</span></div></div>
  ${R.can("stock.edit") ? `<button class="btn btn-ghost" data-inv="editIng">Edit ingredient</button>` : ""}
  <label class="f" style="margin-top:16px">History</label>
  <div class="kv">${hist.map(m => `<div><span><b>${label[m.type] || m.type}</b><small class="mut" style="display:block">${esc(dLong(m.date))}${m.note ? " · " + esc(m.note) : ""}</small></span><span class="side"><b style="color:${m.qty < 0 ? "var(--due)" : "var(--ok)"}">${m.qty > 0 ? "+" : ""}${qty(m.qty, i.unit)}</b>${money && m.amount ? `<small class="mut">${rs(m.amount)}</small>` : ""}${R.isAdmin() && m.type !== "bake" ? `<button class="linkbtn" data-delmove="${esc(m.id)}">Reverse</button>` : ""}</span></div>`).join("") || `<div>No movements yet.</div>`}</div>`);
}
function ingEdit(i) {
  if (!guard("stock.edit")) return;
  const isNew = !i; const x = i ? { ...i } : { id: uid("i"), name: "", unit: "g", reorder: 0, cost: 0, barcode: "" };
  const st = { kind: "ingEdit", x, isNew, rf: big(x.unit) ? big(x.unit).f : 1 }; st.redraw = () => drawIngEdit(st); drawIngEdit(st);
}
function drawIngEdit(st) {
  const x = st.x; const b = big(x.unit);
  openSheet(st, `<div class="sh-head"><h2 class="h">${st.isNew ? "New ingredient" : "Edit ingredient"}</h2><button class="x" data-close aria-label="Close">×</button></div>
  <label class="f" for="gName">Name</label><input class="in" id="gName" value="${esc(x.name)}" placeholder="e.g. Paneer">
  <label class="f">Measured in</label><div class="chips">${[["g", "Weight (g, kg)"], ["ml", "Volume (ml, L)"], ["pcs", "Pieces"]].map(([u, l]) => `<button class="chip" data-gunit="${u}" aria-pressed="${x.unit === u}">${l}</button>`).join("")}</div>
  <label class="f" for="gReorder">Reorder when below</label><div class="two"><input class="in" id="gReorder" inputmode="decimal" value="${x.reorder ? +(x.reorder / st.rf).toFixed(3) : ""}" placeholder="0">${unitChips(x.unit, st.rf, "grf")}</div>
  <label class="f" for="gCost">Price per ${b ? b.big : x.unit} ₹ <small class="mut">(used until a purchase is recorded)</small></label><input class="in" id="gCost" inputmode="decimal" value="${x.cost ? +(x.cost * (b ? b.f : 1)).toFixed(2) : ""}" placeholder="Optional">
  <label class="f" for="gCode">Barcode <small class="mut">(optional · scan or type)</small></label><input class="in" id="gCode" value="${esc(x.barcode || "")}" autocapitalize="off">
  ${st.isNew ? `<label class="f" for="gOpen">Stock on hand now</label><div class="two"><input class="in" id="gOpen" inputmode="decimal" placeholder="0">${unitChips(x.unit, st.rf, "grf")}</div>` : ""}
  <button class="btn btn-primary" data-inv="saveIng">${st.isNew ? "Add ingredient" : "Save"}</button>
  ${!st.isNew && R.isAdmin() ? `<button class="btn btn-danger" data-inv="deleteIng">Delete ingredient</button>` : ""}`);
}
function syncIng() { const st = ui.sheet, x = st.x; const b = big(x.unit); x.name = $("#gName").value; x.reorder = num($("#gReorder").value) * st.rf; x.cost = num($("#gCost").value) / (b ? b.f : 1); x.barcode = $("#gCode").value.trim(); if ($("#gOpen")) st.open = num($("#gOpen").value) * st.rf; }

export function purchaseSheet(ingId) {
  if (!guard("stock.buy")) return;
  const ings = M.ingredients(); if (!ings.length) { if (R.can("stock.edit")) ingEdit(null); toast("Add the ingredient first"); return; }
  const i = ings.find(x => x.id === ingId) || ings[0];
  const st = { kind: "move", type: "purchase", ingId: i.id, f: big(i.unit) ? big(i.unit).f : 1 }; st.redraw = () => drawMove(st); drawMove(st);
}
H.purchaseSheet = purchaseSheet;
function moveSheet(type, ingId) { if (!guard(type === "waste" ? "stock.waste" : "stock.count")) return; const i = M.ingredients().find(x => x.id === ingId); const st = { kind: "move", type, ingId, f: big(i.unit) && type === "count" ? big(i.unit).f : 1 }; st.redraw = () => drawMove(st); drawMove(st); }
function drawMove(st) {
  const ings = M.ingredients(); const i = ings.find(x => x.id === st.ingId) || ings[0]; const on = M.stockLevel(i).on;
  const T = { purchase: ["Add stock", "Quantity bought", "Save purchase", "btn-ok"], waste: ["Record wastage", "Quantity wasted", "Save wastage", "btn-primary"], count: ["Stock count", "Actual quantity on the shelf", "Save count", "btn-primary"] }[st.type];
  openSheet(st, `<div class="sh-head"><h2 class="h">${T[0]}</h2><button class="x" data-close aria-label="Close">×</button></div>
  <label class="f" for="mIng">Ingredient</label><select class="in" id="mIng">${ings.map(x => `<option value="${esc(x.id)}" ${x.id === i.id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select>
  <p class="hint">On hand now: <b>${qty(on, i.unit)}</b></p>
  <label class="f" for="mQty">${T[1]}</label><div class="two"><input class="in" id="mQty" inputmode="decimal" placeholder="0">${unitChips(i.unit, st.f, "mf")}</div>
  ${st.type === "purchase" ? `<label class="f" for="mAmt">Amount paid ₹</label><input class="in" id="mAmt" inputmode="decimal" placeholder="Total bill for this item">` : ""}
  <div class="two"><div><label class="f" for="mDate">Date</label><input class="in" id="mDate" type="date" value="${today()}"></div><div><label class="f" for="mNote">${st.type === "purchase" ? "Supplier" : "Note"}</label><input class="in" id="mNote" placeholder="Optional"></div></div>
  <button class="btn ${T[3]}" data-inv="saveMove">${T[2]}</button>`);
}
function shoppingSheet() {
  const sm = M.stockMap(); const list = M.ingredients().map(i => ({ ...i, on: sm[i.id] || 0 })).filter(i => i.reorder && i.on <= i.reorder).map(i => ({ ...i, buy: Math.max(i.reorder * 2 - i.on, i.reorder) }));
  const text = `🛒 ${M.config().business} shopping list (${dLabel(today())})\n` + list.map(i => `• ${i.name}: ${qty(i.buy, i.unit)} (have ${qty(Math.max(0, i.on), i.unit)})`).join("\n");
  openSheet({ kind: "shop", text, redraw: shoppingSheet }, `<div class="sh-head"><h2 class="h">Shopping list</h2><button class="x" data-close aria-label="Close">×</button></div>
  ${list.length ? `<p class="hint" style="margin-top:0">Items at or below their reorder level; the quantity brings each back to twice its reorder level.</p>
  <div class="kv">${list.map(i => `<div><span><b>${esc(i.name)}</b><small class="mut" style="display:block">have ${qty(Math.max(0, i.on), i.unit)}</small></span><b>${qty(i.buy, i.unit)}</b></div>`).join("")}</div>
  <div class="btnrow"><a class="btn btn-wa" href="${esc(waHref("", text))}" target="_blank" rel="noopener">${ICON.wa}Share</a><button class="btn btn-ghost" data-inv="copyShop">Copy list</button></div>`
  : `<div class="empty" style="margin:0"><strong>Nothing to buy</strong>Every ingredient with a reorder level is above it.</div>`}`);
}

/* ---------- menu, prices, recipes ---------- */
export function menuSheet() {
  const mm = M.menu(); const edit = R.can("menu.edit");
  openSheet({ kind: "menu", redraw: menuSheet }, `<div class="sh-head"><h2 class="h">Menu & recipes</h2><button class="x" data-close aria-label="Close">×</button></div>
  <p class="hint" style="margin-top:-6px">Switched-off items stay in past orders but don’t show for new ones. Recipes drive stock and margin; short names help read WhatsApp orders.</p>
  <div class="kv">${mm.map(m => { const rc = M.recipeCost(m); return `<div style="align-items:center"><button class="who" data-menuitem="${esc(m.id)}"><div class="nm">${esc(m.name)}</div><div class="subl">${rs(m.price)}${m.category ? " · " + esc(m.category) : ""}${m.par ? " · keep " + m.par + " ready" : ""} · ${rc.lines ? `cost ${rs2(rc.cost)} · margin ${m.price ? Math.round((1 - rc.cost / m.price) * 100) : 0}%${rc.missing ? " (prices missing)" : ""}` : "no recipe"}</div></button>${edit ? `<button class="swt" role="switch" aria-checked="${m.active !== false}" data-togm="${esc(m.id)}" aria-label="On sale: ${esc(m.name)}"></button>` : ""}</div>`; }).join("") || `<div>No items yet</div>`}</div>
  ${edit ? `<button class="btn btn-primary" data-inv="newItem">${ICON.plus}Add menu item</button>` : ""}`);
}
A.menu = () => menuSheet();
function itemSheet(m) {
  if (!guard("menu.edit")) return;
  const isNew = !m; const x = m ? JSON.parse(JSON.stringify(m)) : { id: uid("m"), name: "", price: 0, category: "", active: true, sort: M.menu().length + 1, recipe: [], aliases: "", par: 0 };
  x.recipe = x.recipe || []; const st = { kind: "item", x, isNew }; st.redraw = () => drawItem(st); drawItem(st);
}
function drawItem(st) {
  const x = st.x; const ings = M.ingredients(); const cats = [...new Set(M.menu().map(i => i.category).filter(Boolean))]; const rc = M.recipeCost(x); const prices = R.can("prices");
  openSheet(st, `<div class="sh-head"><h2 class="h">${st.isNew ? "New item" : "Edit item"}</h2><button class="x" data-close aria-label="Close">×</button></div>
  <label class="f" for="iName">Item name</label><input class="in" id="iName" value="${esc(x.name)}" placeholder="e.g. Biscoff Crackle">
  <div class="two"><div><label class="f" for="iPrice">Price ₹</label><input class="in" id="iPrice" inputmode="numeric" value="${x.price || ""}" ${prices ? "" : "disabled"}></div>
  <div><label class="f" for="iCat">Category</label><input class="in" id="iCat" list="catlist" value="${esc(x.category || "")}" placeholder="Fresh bake"><datalist id="catlist">${cats.map(c => `<option value="${esc(c)}">`).join("")}</datalist></div></div>
  <label class="f" for="iAlias">Short names customers use <small class="mut">(comma separated)</small></label><input class="in" id="iAlias" value="${esc(x.aliases || "")}" placeholder="e.g. strudel, ps">
  <label class="f" for="iPar">Keep ready each day for walk-in and aggregator sales</label><input class="in" id="iPar" inputmode="numeric" value="${x.par || ""}" placeholder="0">
  <label class="f">Recipe · per piece</label>
  ${ings.length ? `<div class="kv">${x.recipe.map((r, ix) => { const ing = ings.find(i => i.id === r.ingId); return `<div style="align-items:center;gap:8px"><select class="in" data-rping="${ix}" style="flex:1">${ings.map(i => `<option value="${esc(i.id)}" ${i.id === r.ingId ? "selected" : ""}>${esc(i.name)}</option>`).join("")}</select><input class="rate" data-rpqty="${ix}" inputmode="decimal" value="${r.qty || ""}" placeholder="0"><span class="unitlbl">${ing ? ing.unit : ""}</span><button class="rm" data-rprm="${ix}" aria-label="Remove ingredient">×</button></div>`; }).join("") || `<div class="mut">No ingredients yet</div>`}</div>
  <button class="add-line" data-inv="addRecipeLine">+ Add ingredient</button>
  <div class="kv" style="margin-top:10px"><div><span>Cost per piece</span><b id="rcCost">${rs2(rc.cost)}</b></div><div><span>Margin at ${rs(x.price)}</span><b id="rcMargin">${x.price ? Math.round((1 - rc.cost / x.price) * 100) + "%" : "–"}</b></div></div>
  ${rc.missing ? `<p class="hint">Some ingredients have no price yet.</p>` : ""}` : `<p class="hint">Add ingredients on the Stock tab first, then build the recipe here.</p>`}
  <button class="btn btn-primary" data-inv="saveItem">${st.isNew ? "Add item" : "Save item"}</button>
  ${!st.isNew && R.isAdmin() ? `<button class="btn btn-danger" data-inv="deleteItem">Remove from menu</button>` : ""}`);
}
function syncItem() { const x = ui.sheet.x; x.name = $("#iName").value.trim(); if (R.can("prices")) x.price = num($("#iPrice").value); x.category = $("#iCat").value.trim(); x.aliases = $("#iAlias").value.trim(); x.par = num($("#iPar").value); }

/* ---------- actions ---------- */
const I = {
  shopping: shoppingSheet,
  copyShop: async () => toast(await copyText(ui.sheet.text) ? "List copied" : "Couldn’t copy here"),
  newIng: () => ingEdit(null),
  editIng: () => ingEdit(M.ingredients().find(i => i.id === ui.sheet.id)),
  buyThis: () => purchaseSheet(ui.sheet.id),
  wasteThis: () => moveSheet("waste", ui.sheet.id),
  countThis: () => moveSheet("count", ui.sheet.id),
  saveIng: async () => { syncIng(); const st = ui.sheet, x = st.x; x.name = x.name.trim();
    if (!x.name) { toast("Add the ingredient name"); return; }
    if (M.ingredients().some(i => i.id !== x.id && i.name.toLowerCase() === x.name.toLowerCase())) { toast("That ingredient already exists"); return; }
    const { _at, _by, ...rec } = x; await ev.put("ingredients", rec); if (st.isNew && st.open) await putMove({ ingId: x.id, type: "count", qty: st.open, note: "Opening stock" });
    sync.soon(); toast(st.isNew ? "Ingredient added" : "Saved"); ingSheet(x.id); },
  deleteIng: async () => { const x = ui.sheet.x;
    if (!await yesNo(`<p class="cq">Delete ${esc(x.name)}?</p><div class="cdetail">Recipes using it lose this line. History stays in exports.</div>`, "Delete", "btn-danger-solid")) return;
    await ev.del("ingredients", x.id); sync.soon(); closeSheet(); toast("Ingredient deleted"); },
  saveMove: async () => { const st = ui.sheet; const i = M.ingredients().find(x => x.id === st.ingId); const q = num($("#mQty").value) * st.f;
    if (!q && st.type !== "count") { toast("Enter the quantity"); return; }
    const date = $("#mDate").value || today(); const note = $("#mNote").value.trim();
    if (st.type === "purchase") { const amt = num($("#mAmt").value); await putMove({ ingId: i.id, type: "purchase", qty: q, amount: amt, date, note }); toast(`Added ${qty(q, i.unit)} ${i.name}`); }
    if (st.type === "waste") { if (!await yesNo(`<p class="cq">Record wastage?</p><div class="cdetail">${qty(q, i.unit)} of ${esc(i.name)} will be removed from stock.</div>`, "Record")) return; await putMove({ ingId: i.id, type: "waste", qty: -q, date, note }); toast("Wastage recorded"); }
    if (st.type === "count") { const on = M.stockLevel(i).on; const d = q - on; if (!await yesNo(`<p class="cq">Set stock to ${qty(q, i.unit)}?</p><div class="cdetail">${esc(i.name)} shows ${qty(on, i.unit)} now. This ${d >= 0 ? "adds" : "removes"} ${qty(Math.abs(d), i.unit)}.</div>`, "Save count")) return; await putMove({ ingId: i.id, type: "count", qty: d, date, note: note || "Stock count" }); toast("Stock count saved"); }
    ingSheet(i.id); },
  bake: el => bakeSheet(el.dataset.date),
  saveBake: async () => { const st = ui.sheet; const lines = st.lines.filter(l => l.qty > 0); const { need } = M.requirement(lines); const ings = Object.fromEntries(M.ingredients().map(i => [i.id, i]));
    const ids = Object.keys(need).filter(id => ings[id]);
    if (!await yesNo(`<p class="cq">Save this bake?</p><div class="cdetail">${lines.map(l => esc(l.item) + " × " + l.qty).join("<br>")}${ids.length ? "<br><br>Stock used: " + ids.map(id => esc(ings[id].name) + " " + qty(need[id], ings[id].unit)).join(", ") : ""}</div>`, "Save bake", "btn-ok")) return;
    const bakeId = uid("b"); for (const id of ids) await putMove({ ingId: id, type: "bake", qty: -need[id], date: st.date, note: "Bake " + dLabel(st.date), ref: bakeId });
    await ev.put("bakes", { id: bakeId, date: st.date, lines, at: new Date().toISOString(), outletId: M.config().outletId }); sync.soon(); closeSheet(); toast("Bake saved"); },
  newItem: () => itemSheet(null),
  addRecipeLine: () => { syncItem(); const ings = M.ingredients(); ui.sheet.x.recipe.push({ ingId: ings[0].id, qty: 0 }); drawItem(ui.sheet); },
  saveItem: async () => { syncItem(); const st = ui.sheet, x = st.x; if (!x.name) { toast("Add the item name"); return; }
    if (M.menu().some(m => m.id !== x.id && m.name.toLowerCase() === x.name.toLowerCase())) { toast("That item is already on the menu"); return; }
    x.recipe = x.recipe.filter(r => r.ingId && +r.qty > 0); const { _at, _by, ...rec } = x; await ev.put("menu", rec); sync.soon(); toast(st.isNew ? "Item added" : "Item saved"); menuSheet(); },
  deleteItem: async () => { const x = ui.sheet.x; if (!await yesNo(`<p class="cq">Remove ${esc(x.name)}?</p><div class="cdetail">Past orders keep it. To pause it, switch it off on the menu instead.</div>`, "Remove", "btn-danger-solid")) return;
    await ev.del("menu", x.id); sync.soon(); toast("Item removed"); menuSheet(); }
};
H.click.push(async T => {
  const st = ui.sheet;
  const a = T.closest("[data-inv]"); if (a && I[a.dataset.inv]) { await I[a.dataset.inv](a); return true; }
  const bd = T.closest("[data-bakedate]"); if (bd) { S.bakeDate = bd.dataset.bakedate; H.render(); return true; }
  const ub = T.closest("[data-undobake]"); if (ub) { if (!guard("bake.record")) return true;
    if (await yesNo(`<p class="cq">Undo this bake?</p><div class="cdetail">The stock it used goes back on the shelf.</div>`, "Undo bake", "btn-danger-solid")) {
      for (const m of ev.all("moves").filter(m => m.ref === ub.dataset.undobake)) await putMove({ ingId: m.ingId, type: "adjust", qty: -m.qty, note: "Bake undone", ref: m.ref + ":undo" });
      await ev.del("bakes", ub.dataset.undobake); sync.soon(); toast("Bake undone"); } return true; }
  const ig = T.closest("[data-ing]"); if (ig) { ingSheet(ig.dataset.ing); return true; }
  const mi = T.closest("[data-menuitem]"); if (mi) { if (R.can("menu.edit")) itemSheet(M.menu().find(m => m.id === mi.dataset.menuitem)); return true; }
  const tg = T.closest("[data-togm]"); if (tg) { if (!guard("menu.edit")) return true; const m = M.menu().find(x => x.id === tg.dataset.togm); if (m) { const { _at, _by, ...rec } = m; await ev.put("menu", { ...rec, active: m.active === false }); sync.soon(); menuSheet(); } return true; }
  const dm = T.closest("[data-delmove]"); if (dm) { const m = ev.get("moves", dm.dataset.delmove);
    if (m && await yesNo(`<p class="cq">Reverse this entry?</p><div class="cdetail">A correcting entry is added; the original stays in history.</div>`, "Reverse")) { await putMove({ ingId: m.ingId, type: "adjust", qty: -m.qty, note: "Reversal", ref: m.id }); ingSheet(st.id); } return true; }
  if (!st) return false;
  if (st.kind === "ingEdit") { const u = T.closest("[data-gunit]"); if (u) { syncIng(); st.x.unit = u.dataset.gunit; st.rf = 1; drawIngEdit(st); return true; } const r = T.closest("[data-grf]"); if (r) { syncIng(); st.rf = +r.dataset.grf; drawIngEdit(st); return true; } }
  if (st.kind === "move") { const f = T.closest("[data-mf]"); if (f) { const v = $("#mQty").value, a2 = $("#mAmt") && $("#mAmt").value, n = $("#mNote").value, d = $("#mDate").value; st.f = +f.dataset.mf; drawMove(st); $("#mQty").value = v; if (a2 && $("#mAmt")) $("#mAmt").value = a2; $("#mNote").value = n; $("#mDate").value = d; return true; } }
  if (st.kind === "bake") { const b = T.closest("[data-bstep]"); if (b) { const [ix, d] = b.dataset.bstep.split(":").map(Number); st.lines[ix].qty = Math.max(0, st.lines[ix].qty + d); drawBake(st); return true; } }
  if (st.kind === "item") { const rm = T.closest("[data-rprm]"); if (rm) { syncItem(); st.x.recipe.splice(+rm.dataset.rprm, 1); drawItem(st); return true; } }
  return false;
});
H.input.push(T => {
  const st = ui.sheet; if (!st || st.kind !== "item") return false;
  if (T.dataset.rpqty != null) st.x.recipe[+T.dataset.rpqty].qty = num(T.value);
  if (T.id === "iPrice") st.x.price = num(T.value);
  if (T.dataset.rpqty != null || T.id === "iPrice") { const rc = M.recipeCost(st.x); $("#rcCost") && ($("#rcCost").textContent = rs2(rc.cost)); $("#rcMargin") && ($("#rcMargin").textContent = st.x.price ? Math.round((1 - rc.cost / st.x.price) * 100) + "%" : "–"); return true; }
  return false;
});
H.change.push(T => {
  const st = ui.sheet; if (!st) return false;
  if (st.kind === "move" && T.id === "mIng") { st.ingId = T.value; st.f = 1; drawMove(st); return true; }
  if (st.kind === "item" && T.dataset.rping != null) { syncItem(); st.x.recipe[+T.dataset.rping].ingId = T.value; drawItem(st); return true; }
  return false;
});
