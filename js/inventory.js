// Inventory and production: Stock tab, ingredients, purchases, wastage, counts, recipes, the bake board and shopping list.
import * as ev from "./events.js";
import * as sync from "./sync.js";
import * as M from "./model.js";
import * as R from "./roles.js";
import { S, A, V, H, guard, chipBar, searchBox, band, toran, clean } from "./core.js";
import { $, esc, rs, rs2, num, uid, today, addDays, dLong, dLabel, qty, UNITS, ICON, copyText, waHref } from "./util.js";
import { ui, toast, openSheet, closeSheet, ask, yesNo } from "./ui.js";

const big = u => UNITS[u] || null;
const unitChips = (u, sel, attr) => big(u) ? `<div class="chips unitchips">${[[u, 1], [big(u).big, big(u).f]].map(([n, f]) => `<button class="chip" data-${attr}="${f}" aria-pressed="${sel === f}">${n}</button>`).join("")}</div>` : `<span class="unitlbl">pcs</span>`;
export const putMove = m => ev.put("moves", { id: uid("v"), date: today(), businessId: M.config().businessId, outletId: M.here(), ...m }).then(() => sync.soon());
const typeTag = i => `<span class="tag t-${i.type}">${{ rm: "RM", pm: "PM", sf: "Semi" }[i.type] || "RM"}</span>`;
const perBig = (i, v) => rs2(v * (big(i.unit) ? big(i.unit).f : 1)) + "/" + (big(i.unit) ? big(i.unit).big : i.unit);
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
  h += `<ul class="list">${rows.map(r => `<li class="row board${r.toBake ? "" : " done"}"><div class="who"><div class="nm big">${esc(r.item)}</div><div class="subl">${r.committed} pre-ordered${r.par ? ` · ${r.par} kept ready` : ""}${r.sold ? ` · ${r.sold} sold at counter` : ""}${r.baked ? ` · ${r.baked} baked` : ""}${r.spoiled ? ` · ${r.spoiled} spoiled` : ""}${r.baked ? ` · ${Math.max(0, r.left)} left` : ""}</div></div>
    <div class="side"><div class="bignum">${r.toBake}</div><small class="mut">to bake</small></div></li>`).join("")}</ul>
  <div class="boardfoot">${R.can("bake.record") ? `<button class="btn btn-primary" data-inv="bake" data-date="${d}">${ICON.oven}Record a batch</button>` : ""}
  ${baked.length ? `<label class="f">Batches for ${d === t ? "today" : esc(dLong(d))}</label><div class="kv">${baked.map(b => `<div style="align-items:center"><button class="who" data-batch="${esc(b.id)}"><div class="nm" style="font-size:15px">${b.no ? "#" + esc(b.no) + " · " : ""}${new Date(b.at || b._at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}</div><div class="subl">${esc(M.batchText(b))}</div></button><span class="chev">${ICON.chev}</span></div>`).join("")}</div>` : ""}
  <button class="btn btn-ghost" data-go="batches">${ICON.batch}All batches</button></div>`;
  return h;
};
// opts.prep: { [semi-finished id]: runs } to open the sheet as a prep-only batch.
export function bakeSheet(date, opts = {}) {
  if (!guard("bake.record")) return;
  const erp = R.mode() === "erp" && H.prodLines; const loc = erp ? H.prodKitchen() : M.here();
  const lines = opts.prep ? [] : erp ? H.prodLines(date) : M.board(date).filter(r => r.toBake > 0).map(r => ({ item: r.item, qty: r.toBake }));
  M.menuActive().forEach(m => { if (!lines.some(l => l.item === m.name)) lines.push({ item: m.name, qty: 0 }); });
  const make = opts.prep || M.explode(lines.filter(l => l.qty > 0)).make;
  const prep = M.ingredients().filter(i => i.type === "sf" && i.yield > 0 && i.recipe.length).map(i => ({ ingId: i.id, runs: make[i.id] || 0 }));
  const st = { kind: "bake", date, lines, prep, notes: "", loc }; st.redraw = () => drawBake(st); drawBake(st);
}
function drawBake(st) {
  const ings = Object.fromEntries(M.ingredients().map(i => [i.id, i])); const sm = M.stockMap(M.erpOn() ? st.loc : null);
  const { need, made, unknown } = M.batchNeed(st.lines, st.prep); const ids = Object.keys(need).filter(id => ings[id]);
  const have = id => (sm[id] || 0) + (made[id] || 0); const short = ids.filter(id => have(id) < need[id]);
  const me = R.me();
  openSheet(st, `<div class="sh-head"><h2 class="h">New batch</h2><button class="x" data-close aria-label="Close">×</button></div>
  <p class="hint" style="margin-top:-4px">Batch #${esc(M.nextBatchNo((me && me.prefix) || ""))} · ${esc(dLong(st.date))}${M.locations().length > 1 ? " · at " + esc(M.locName(st.loc)) : ""} · pieces you are baking now</p>
  <label class="f">Finished pieces</label><div class="kv">${st.lines.map((l, ix) => `<div style="align-items:center"><span>${esc(l.item)}</span><div class="stepper"><button data-bstep="${ix}:-1" aria-label="One less">−</button><span>${l.qty}</span><button data-bstep="${ix}:1" aria-label="One more">+</button></div></div>`).join("")}</div>
  ${st.prep.length ? `<label class="f" style="margin-top:14px">Semi-finished to prepare <small class="mut">(recipe runs · suggested from what’s short)</small></label><div class="kv">${st.prep.map((p, ix) => { const i = ings[p.ingId];
    return `<div style="align-items:center"><span>${esc(i.name)}<small class="mut" style="display:block">${qty(i.yield, i.unit)} per run · have ${qty(Math.max(0, sm[i.id] || 0), i.unit)}</small></span><div class="stepper"><button data-pstep="${ix}:-1" aria-label="One run less">−</button><span>${p.runs}</span><button data-pstep="${ix}:1" aria-label="One run more">+</button></div></div>`; }).join("")}</div>` : ""}
  <label class="f" style="margin-top:14px">Stock this batch uses</label>
  ${ids.length ? `<div class="kv">${ids.map(id => { const i = ings[id]; const h = have(id); const s = h < need[id];
    return `<div><span>${esc(i.name)} ${typeTag(i)}${s ? ` <span class="tag t-due">short ${qty(need[id] - h, i.unit)}</span>` : ""}</span><span>${qty(need[id], i.unit)} <small class="mut">/ ${qty(h, i.unit)}</small></span></div>`; }).join("")}</div>`
  : `<p class="hint">No recipe for these items yet, so stock won’t change. The batch still counts on the board.</p>`}
  ${Object.keys(made).length ? `<p class="hint">Adds to stock: ${Object.keys(made).map(id => esc(ings[id].name) + " " + qty(made[id], ings[id].unit)).join(", ")}</p>` : ""}
  ${unknown.length && ids.length ? `<p class="hint">No recipe yet for ${unknown.map(esc).join(", ")}.</p>` : ""}
  <label class="f" for="bNotes">Note <small class="mut">(optional · oven, tray, flavour, who baked)</small></label><input class="in" id="bNotes" value="${esc(st.notes)}" placeholder="Optional">
  <button class="btn btn-primary" data-inv="saveBake" ${st.lines.some(l => l.qty > 0) || st.prep.some(p => p.runs > 0) ? "" : "disabled"}>${ICON.oven}Save batch</button>
  ${short.length ? `<p class="hint" style="color:var(--due)">${short.length} ingredient${short.length > 1 ? "s" : ""} will go below zero. Record purchases first, or save and fix with a stock count.</p>` : ""}`);
}

/* ---------- Stock (RM / PM / semi-finished) ---------- */
V.stock = () => {
  S.filter.stock = S.filter.stock || "all"; S.filter.stype = S.filter.stype || "all";
  const money = R.can("money") && R.role() !== "kitchen";
  const multi = M.erpOn() && M.locations().length > 1; if (multi && !S.filter.sloc) S.filter.sloc = M.here();
  const loc = multi && S.filter.sloc !== "all" ? S.filter.sloc : null;
  const sm = M.stockMap(loc); const all = M.ingredients().map(i => ({ ...i, lv: M.stockLevel(i, sm), uc: M.unitCost(i) }));
  const ings = all.filter(i => S.filter.stype === "all" || i.type === S.filter.stype);
  const low = ings.filter(i => i.lv.state !== "ok"); const value = ings.reduce((s, i) => s + Math.max(0, i.lv.on) * i.uc, 0);
  const m0 = today().slice(0, 8) + "01"; const spent = M.moves().filter(m => m.type === "purchase" && m.date >= m0).reduce((s, m) => s + (+m.amount || 0), 0);
  let h = band(loc ? `Stock · ${esc(M.locName(loc))}` : "Stock", `${R.can("stock.buy") ? `<button class="pillbtn" data-inv="shopping">${ICON.cart}Shopping list</button>` : ""}<button class="pillbtn" data-go="bom">${ICON.tree}BOM</button>`,
    `<div class="stats"><div class="st"><b>${low.length}</b><span>low or out</span></div>${money ? `<div class="st"><b>${rs(value)}</b><span>stock value</span></div><div class="st"><b>${rs(spent)}</b><span>bought this month</span></div>` : `<div class="st"><b>${ings.length}</b><span>materials</span></div>`}</div>`);
  const q = (S.query.stock || "").toLowerCase().trim();
  const rows = ings.filter(i => !q || (i.name + " " + (i.barcode || "") + " " + (i.supplier || "")).toLowerCase().includes(q)).filter(i => S.filter.stock === "all" || (S.filter.stock === "low" ? i.lv.state !== "ok" : i.lv.state === "out"));
  h += `<div class="tools">${searchBox("stock", "Search, scan a barcode or supplier")}${chipBar("stype", [["all", "All", all.length], ...Object.entries(M.ING_TYPES).map(([k, l]) => [k, l, all.filter(i => i.type === k).length])])}</div>
  ${multi ? `<div class="tools" style="padding-top:2px">${chipBar("sloc", [["all", "All locations"], ...M.locations().map(l => [l.id, l.name])])}</div>` : ""}
  <div class="tools" style="padding-top:2px">${chipBar("stock", [["all", "Any level", ings.length], ["low", "Low", low.length], ["out", "Out", ings.filter(i => i.lv.state === "out").length]])}</div>`;
  if (!all.length) return h + `<div class="empty"><strong>Add your materials</strong>Raw materials and packing you buy, with a reorder level, and semi-finished items you make (dough, fillings, glazes) with their own recipe. Purchases and prep add stock; batches use it up.${R.can("stock.edit") ? `<button class="btn btn-primary" data-inv="newIng" style="margin-top:14px">${ICON.plus}Add material</button>` : ""}</div>`;
  if (!rows.length) return h + `<div class="empty"><strong>Nothing matches</strong>Try another search or filter.</div>`;
  h += `<ul class="list">${rows.map(i => { const pct = i.reorder ? Math.min(100, Math.max(0, i.lv.on / (i.reorder * 2) * 100)) : (i.lv.on > 0 ? 100 : 0);
    return `<li class="row${i.lv.state === "out" ? " warn" : ""}"><button class="who" data-ing="${esc(i.id)}"><div class="nm">${esc(i.name)}</div>
    <div class="subl">${typeTag(i)} ${stateTag(i.lv.state)} ${i.reorder ? (i.type === "sf" ? "make at " : "reorder at ") + qty(i.reorder, i.unit) : "no reorder level"}${money && i.uc ? " · " + perBig(i, i.uc) : ""}</div>
    <div class="lvl"><i class="${i.lv.state}" style="width:${pct}%"></i></div></button><div class="amt">${qty(i.lv.on, i.unit)}</div></li>`; }).join("")}</ul>
  ${R.can("stock.edit") ? `<div class="boardfoot" style="padding-bottom:20px"><button class="btn btn-ghost" data-inv="newIng">${ICON.plus}Add material</button></div>` : ""}`;
  return h;
};

export function ingSheet(id) {
  const i = M.ingredients().find(x => x.id === id); if (!i) { closeSheet(); return; }
  const money = R.can("money") && R.role() !== "kitchen"; const ings = M.ingMap(); const sf = i.type === "sf";
  const lv = M.stockLevel(i); const uc = M.unitCost(i); const hist = M.moves().filter(m => m.ingId === id).slice(0, 40);
  const usedIn = [...M.menu().filter(m => (m.recipe || []).some(r => r.ingId === id)).map(m => esc(m.name)), ...M.ingredients().filter(x => x.type === "sf" && x.recipe.some(r => r.ingId === id)).map(x => esc(x.name) + " <small class='mut'>(semi)</small>")];
  const label = { purchase: "Bought", transfer: "Transfer", bake: "Used in batch", make: "Made in batch", waste: "Wasted", count: "Stock count", adjust: "Adjusted" };
  openSheet({ kind: "ing", id, redraw: () => ingSheet(id) }, `<div class="sh-head"><h2 class="h">${esc(i.name)}</h2><button class="x" data-close aria-label="Close">×</button></div>
  <div class="subl" style="margin:-4px 0 10px">${typeTag(i)} ${esc(M.ING_TYPES[i.type])}${i.supplier ? " · " + esc(i.supplier) : ""}</div>
  <div class="kpis" style="padding:0;margin-bottom:10px"><div class="kpi"><b>${qty(lv.on, i.unit)}</b><span>on hand ${stateTag(lv.state)}</span></div>${money ? `<div class="kpi"><b>${uc ? perBig(i, uc) : "–"}</b><span>${sf ? "rolled-up recipe cost" : "last price"}${uc ? " · value " + rs(Math.max(0, lv.on) * uc) : ""}</span></div>` : ""}</div>
  <div class="btnrow3">${sf ? (R.can("bake.record") ? `<button class="btn btn-ok" data-inv="makeThis">Make</button>` : "") : (R.can("stock.buy") ? `<button class="btn btn-ok" data-inv="buyThis">Bought</button>` : "")}${R.can("stock.waste") ? `<button class="btn btn-ghost" data-inv="wasteThis">Wasted</button>` : ""}${R.can("stock.count") ? `<button class="btn btn-ghost" data-inv="countThis">Count</button>` : ""}</div>
  ${sf ? `<label class="f" style="margin-top:12px">Recipe · makes ${qty(i.yield, i.unit)} per run</label><div class="kv">${i.recipe.map(r => { const c = ings[r.ingId]; return `<div><span>${esc(c ? c.name : "Removed material")} ${c ? typeTag(c) : ""}</span><span>${c ? qty(r.qty, c.unit) : r.qty}${money && c ? ` <small class="mut">${rs2(M.unitCost(c) * r.qty)}</small>` : ""}</span></div>`; }).join("") || "<div>No recipe yet</div>"}</div>` : ""}
  <div class="kv" style="margin-top:12px">${M.erpOn() && M.locations().length > 1 ? `<div><span>By location</span><span style="text-align:right">${M.locations().map(l => `${esc(l.name)} ${qty(M.stockMap(l.id)[i.id] || 0, i.unit)}`).join(" · ")}</span></div>` : ""}<div><span>${sf ? "Make when below" : "Reorder level"}</span><span>${i.reorder ? qty(i.reorder, i.unit) : "Not set"}</span></div>${i.barcode ? `<div><span>Barcode</span><span>${esc(i.barcode)}</span></div>` : ""}<div><span>Used in</span><span style="text-align:right">${usedIn.length ? usedIn.join(", ") : "No recipes yet"}</span></div></div>
  ${R.can("stock.edit") ? `<button class="btn btn-ghost" data-inv="editIng">Edit material</button>` : ""}
  <label class="f" style="margin-top:16px">History</label>
  <div class="kv">${hist.map(m => `<div><span><b>${label[m.type] || m.type}</b><small class="mut" style="display:block">${esc(dLong(m.date))}${m.note ? " · " + esc(m.note) : ""}</small></span><span class="side"><b style="color:${m.qty < 0 ? "var(--due)" : "var(--ok)"}">${m.qty > 0 ? "+" : ""}${qty(m.qty, i.unit)}</b>${money && m.amount ? `<small class="mut">${rs(m.amount)}</small>` : ""}${R.isAdmin() && m.type !== "bake" && m.type !== "make" ? `<button class="linkbtn" data-delmove="${esc(m.id)}">Reverse</button>` : ""}</span></div>`).join("") || `<div>No movements yet.</div>`}</div>`);
}
// Recipe lines for a menu item (per piece) or a semi-finished material (per run); materials grouped by type.
function recipeRows(st) {
  const x = st.x; const ings = M.ingredients().filter(i => i.id !== x.id);
  const opts = sel => Object.entries(M.ING_TYPES).map(([t, l]) => { const g = ings.filter(i => i.type === t); return g.length ? `<optgroup label="${l}">${g.map(i => `<option value="${esc(i.id)}" ${i.id === sel ? "selected" : ""}>${esc(i.name)}</option>`).join("")}</optgroup>` : ""; }).join("");
  if (!ings.length) return `<p class="hint">Add materials on the Stock screen first, then build the recipe here.</p>`;
  return `<div class="kv">${x.recipe.map((r, ix) => { const ing = ings.find(i => i.id === r.ingId); return `<div style="align-items:center;gap:8px"><select class="in" data-rping="${ix}" style="flex:1;min-width:0">${opts(r.ingId)}</select><input class="rate" data-rpqty="${ix}" inputmode="decimal" value="${r.qty || ""}" placeholder="0" aria-label="Quantity"><span class="unitlbl">${ing ? ing.unit : ""}</span><button class="rm" data-rprm="${ix}" aria-label="Remove line">×</button></div>`; }).join("") || `<div class="mut">No lines yet</div>`}</div>
  <button class="add-line" data-inv="addRecipeLine">+ Add material</button>`;
}
function ingEdit(i) {
  if (!guard("stock.edit")) return;
  const isNew = !i; const x = i ? JSON.parse(JSON.stringify(i)) : { id: uid("i"), name: "", unit: "g", reorder: 0, cost: 0, barcode: "", type: S.filter.stype && S.filter.stype !== "all" ? S.filter.stype : "rm", supplier: "", recipe: [], yield: 0 };
  x.recipe = x.recipe || [];
  const st = { kind: "ingEdit", x, isNew, rf: big(x.unit) ? big(x.unit).f : 1 }; st.redraw = () => drawIngEdit(st); drawIngEdit(st);
}
const sfUnitCost = x => x.yield > 0 ? M.recipeCost(x).cost / x.yield : 0;
function drawIngEdit(st) {
  const x = st.x; const b = big(x.unit); const sf = x.type === "sf"; const money = R.can("money") && R.role() !== "kitchen";
  openSheet(st, `<div class="sh-head"><h2 class="h">${st.isNew ? "New material" : "Edit material"}</h2><button class="x" data-close aria-label="Close">×</button></div>
  <label class="f">Type</label><div class="chips">${Object.entries(M.ING_TYPES).map(([k, l]) => `<button class="chip" data-gtype="${k}" aria-pressed="${x.type === k}">${l}</button>`).join("")}</div>
  <p class="hint">${{ rm: "Bought and used in recipes: flour, butter, paneer.", pm: "Bought and used per piece or order: boxes, bags, labels.", sf: "Made in-house from its own recipe and kept in stock: dough, fillings, glazes. Can itself use other semi-finished items." }[x.type]}</p>
  <label class="f" for="gName">Name</label><input class="in" id="gName" value="${esc(x.name)}" placeholder="${sf ? "e.g. Strudel dough" : x.type === "pm" ? "e.g. 6-piece box" : "e.g. Paneer"}">
  <label class="f">Measured in</label><div class="chips">${[["g", "Weight (g, kg)"], ["ml", "Volume (ml, L)"], ["pcs", "Pieces"]].map(([u, l]) => `<button class="chip" data-gunit="${u}" aria-pressed="${x.unit === u}">${l}</button>`).join("")}</div>
  ${sf ? `<label class="f" for="gYield">One run of the recipe makes</label><div class="two"><input class="in" id="gYield" inputmode="decimal" value="${x.yield ? +(x.yield / st.rf).toFixed(3) : ""}" placeholder="e.g. 1.2">${unitChips(x.unit, st.rf, "grf")}</div>
    <label class="f">Recipe for one run</label>${recipeRows(st)}
    ${money ? `<div class="kv" style="margin-top:10px"><div><span>Cost per ${b ? b.big : x.unit}</span><b id="sfCost">${x.yield ? rs2(sfUnitCost(x) * (b ? b.f : 1)) : "–"}</b></div></div>` : ""}` : ""}
  <label class="f" for="gReorder">${sf ? "Make more when below" : "Reorder when below"}</label><div class="two"><input class="in" id="gReorder" inputmode="decimal" value="${x.reorder ? +(x.reorder / st.rf).toFixed(3) : ""}" placeholder="0">${unitChips(x.unit, st.rf, "grf")}</div>
  ${sf ? "" : `<div class="two"><div><label class="f" for="gCost">Price per ${b ? b.big : x.unit} ₹ <small class="mut">(until a purchase)</small></label><input class="in" id="gCost" inputmode="decimal" value="${x.cost ? +(x.cost * (b ? b.f : 1)).toFixed(2) : ""}" placeholder="Optional"></div>
    <div><label class="f" for="gSupp">Usual supplier</label><input class="in" id="gSupp" value="${esc(x.supplier || "")}" placeholder="Optional"></div></div>
  ${M.taxCfg().on ? `<label class="f" for="gTax">${esc(M.taxCfg().name)} % on purchases <small class="mut">(blank = ${M.taxCfg().rate}%)</small></label><input class="in" id="gTax" inputmode="decimal" value="${x.taxPct ?? ""}" placeholder="${M.taxCfg().rate}">
    <label class="f">Purchase tax ${R.isAdmin() ? "" : `<small class="mut">(set by the admin)</small>`}</label><div class="chips">${[[false, "Recoverable · keep out of cost"], [true, "Not recoverable · add to cost"]].map(([v, l]) => `<button class="chip" data-gtic="${v ? 1 : 0}" aria-pressed="${!!x.taxInCost === v}" ${R.isAdmin() ? "" : "disabled"}>${l}</button>`).join("")}</div>
    <p class="hint">Decides whether ${esc(M.taxCfg().name)} paid on this material counts in recipe and batch costs.</p>` : ""}
  <label class="f" for="gCode">Barcode <small class="mut">(optional · scan or type)</small></label><input class="in" id="gCode" value="${esc(x.barcode || "")}" autocapitalize="off">`}
  ${st.isNew ? `<label class="f" for="gOpen">Stock on hand now</label><div class="two"><input class="in" id="gOpen" inputmode="decimal" placeholder="0">${unitChips(x.unit, st.rf, "grf")}</div>` : ""}
  <button class="btn btn-primary" data-inv="saveIng">${st.isNew ? "Add material" : "Save"}</button>
  ${!st.isNew && R.isAdmin() ? `<button class="btn btn-danger" data-inv="deleteIng">Delete material</button>` : ""}`);
}
function syncIng() { const st = ui.sheet, x = st.x; const b = big(x.unit); const g = id => document.getElementById(id);
  x.name = g("gName").value; x.reorder = num(g("gReorder").value) * st.rf;
  if (g("gCost")) x.cost = num(g("gCost").value) / (b ? b.f : 1); if (g("gCode")) x.barcode = g("gCode").value.trim(); if (g("gSupp")) x.supplier = g("gSupp").value.trim(); if (g("gTax")) x.taxPct = g("gTax").value.trim() === "" ? null : num(g("gTax").value);
  if (g("gYield")) x.yield = num(g("gYield").value) * st.rf; if (g("gOpen")) st.open = num(g("gOpen").value) * st.rf; }
const syncHost = () => ui.sheet.kind === "item" ? syncItem() : syncIng();
const drawHost = st => st.kind === "item" ? drawItem(st) : drawIngEdit(st);

export function purchaseSheet(ingId) {
  if (!guard("stock.buy")) return;
  if (R.mode() === "erp" && H.grnSheet) { H.grnSheet({ ingId }); return; }   // in ERP every purchase is a GRN
  const ings = M.ingredients().filter(i => i.type !== "sf"); if (!ings.length) { if (R.can("stock.edit")) ingEdit(null); toast("Add the material first"); return; }
  const i = ings.find(x => x.id === ingId) || ings[0];
  const st = { kind: "move", type: "purchase", ingId: i.id, f: big(i.unit) ? big(i.unit).f : 1 }; st.redraw = () => drawMove(st); drawMove(st);
}
H.purchaseSheet = purchaseSheet;
function moveSheet(type, ingId) { if (!guard(type === "waste" ? "stock.waste" : "stock.count")) return; const i = M.ingredients().find(x => x.id === ingId); const st = { kind: "move", type, ingId, f: big(i.unit) && type === "count" ? big(i.unit).f : 1 }; st.redraw = () => drawMove(st); drawMove(st); }
function drawMove(st) {
  const ings = M.ingredients().filter(x => st.type !== "purchase" || x.type !== "sf"); const i = ings.find(x => x.id === st.ingId) || ings[0]; const on = M.stockLevel(i).on;
  const T = { purchase: ["Add stock", "Quantity bought", "Save purchase", "btn-ok"], waste: ["Record wastage", "Quantity wasted", "Save wastage", "btn-primary"], count: ["Stock count", "Actual quantity on the shelf", "Save count", "btn-primary"] }[st.type];
  openSheet(st, `<div class="sh-head"><h2 class="h">${T[0]}</h2><button class="x" data-close aria-label="Close">×</button></div>
  <label class="f" for="mIng">Material</label><select class="in" id="mIng">${ings.map(x => `<option value="${esc(x.id)}" ${x.id === i.id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select>
  <p class="hint">On hand now: <b>${qty(on, i.unit)}</b></p>
  <label class="f" for="mQty">${T[1]}</label><div class="two"><input class="in" id="mQty" inputmode="decimal" placeholder="0">${unitChips(i.unit, st.f, "mf")}</div>
  ${st.type === "purchase" ? `<label class="f" for="mAmt">Amount paid ₹</label><input class="in" id="mAmt" inputmode="decimal" placeholder="Total bill for this item">` : ""}
  <div class="two"><div><label class="f" for="mDate">Date</label><input class="in" id="mDate" type="date" value="${today()}"></div><div><label class="f" for="mNote">${st.type === "purchase" ? "Supplier" : "Note"}</label><input class="in" id="mNote" placeholder="Optional"></div></div>
  <button class="btn ${T[3]}" data-inv="saveMove">${T[2]}</button>`);
}
function shoppingSheet() {
  const sm = M.stockMap(); const list = M.ingredients().filter(i => i.type !== "sf").map(i => ({ ...i, on: sm[i.id] || 0 })).filter(i => i.reorder && i.on <= i.reorder).map(i => ({ ...i, buy: Math.max(i.reorder * 2 - i.on, i.reorder) }));
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
export function itemSheet(m) {
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
  <div class="two"><div><label class="f" for="iPar">Keep ready each day${M.sellingLocs().length > 1 ? " (per outlet)" : ""}</label><input class="in" id="iPar" inputmode="numeric" value="${x.par || ""}" placeholder="0"></div>
  ${M.taxCfg().on ? `<div><label class="f" for="iTax">${esc(M.taxCfg().name)} % <small class="mut">(blank = ${M.taxCfg().rate}%)</small></label><input class="in" id="iTax" inputmode="decimal" value="${x.taxPct ?? ""}" placeholder="${M.taxCfg().rate}"></div>` : "<div></div>"}</div>
  <label class="f">BOM · per piece <small class="mut">(raw, packing and semi-finished materials)</small></label>
  ${recipeRows(st)}
  ${ings.length ? `<div class="kv" style="margin-top:10px"><div><span>Cost per piece</span><b id="rcCost">${rs2(rc.cost)}</b></div><div><span>Margin at ${rs(x.price)}</span><b id="rcMargin">${x.price ? Math.round((1 - rc.cost / x.price) * 100) + "%" : "–"}</b></div></div>
  ${rc.missing ? `<p class="hint">Some materials have no price yet.</p>` : ""}` : ""}
  <button class="btn btn-primary" data-inv="saveItem">${st.isNew ? "Add item" : "Save item"}</button>
  ${!st.isNew && R.isAdmin() ? `<button class="btn btn-danger" data-inv="deleteItem">Remove from menu</button>` : ""}`);
}
function syncItem() { const x = ui.sheet.x; x.name = $("#iName").value.trim(); if (R.can("prices")) x.price = num($("#iPrice").value); x.category = $("#iCat").value.trim(); x.aliases = $("#iAlias").value.trim(); x.par = num($("#iPar").value); if ($("#iTax")) x.taxPct = $("#iTax").value.trim() === "" ? null : num($("#iTax").value); }

// Undoing keeps the batch in the register, marked undone; it leaves the bake board and its stock moves are reversed.
export async function undoBatch(id) {
  if (!guard("bake.record")) return false;
  if (!await yesNo(`<p class="cq">Undo this batch?</p><div class="cdetail">It comes off the bake board, the stock it used goes back and anything it made comes off. It stays in the register marked undone.</div>`, "Undo batch", "btn-danger-solid")) return false;
  for (const m of ev.all("moves").filter(m => m.ref === id)) await putMove({ ingId: m.ingId, type: "adjust", qty: -m.qty, note: "Batch undone", ref: m.ref + ":undo", outletId: m.outletId });
  const b = ev.get("bakes", id); await ev.put("bakes", clean({ ...b, void: true, voidAt: new Date().toISOString() })); sync.soon(); toast("Batch undone"); return true;
}

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
    if (!x.name) { toast("Add the material name"); return; }
    if (M.ingredients().some(i => i.id !== x.id && i.name.toLowerCase() === x.name.toLowerCase())) { toast("That material already exists"); return; }
    if (x.type === "sf") { x.recipe = x.recipe.filter(r => r.ingId && +r.qty > 0); x.cost = 0; x.barcode = ""; x.supplier = "";
      if (x.recipe.length && !(x.yield > 0)) { toast("Enter how much one run makes"); return; }
      if (M.makesCycle(x.id, x.recipe)) { toast("That recipe would use itself through another semi-finished item"); return; } }
    else { x.recipe = []; x.yield = 0; }
    const { _at, _by, ...rec } = x; await ev.put("ingredients", rec); if (st.isNew && st.open) await putMove({ ingId: x.id, type: "count", qty: st.open, note: "Opening stock" });
    sync.soon(); toast(st.isNew ? "Material added" : "Saved"); ingSheet(x.id); },
  deleteIng: async () => { const x = ui.sheet.x;
    const users = [...M.menu().filter(m => (m.recipe || []).some(r => r.ingId === x.id)), ...M.ingredients().filter(i => i.recipe.some(r => r.ingId === x.id))].map(m => m.name);
    if (!await yesNo(`<p class="cq">Delete ${esc(x.name)}?</p><div class="cdetail">${users.length ? "Used in " + users.map(esc).join(", ") + "; those BOM lines stop counting. " : ""}History stays in exports.</div>`, "Delete", "btn-danger-solid")) return;
    await ev.del("ingredients", x.id); sync.soon(); closeSheet(); toast("Material deleted"); },
  saveMove: async () => { const st = ui.sheet; const i = M.ingredients().find(x => x.id === st.ingId); const q = num($("#mQty").value) * st.f;
    if (!q && st.type !== "count") { toast("Enter the quantity"); return; }
    const date = $("#mDate").value || today(); const note = $("#mNote").value.trim();
    if (st.type === "purchase") { const amt = num($("#mAmt").value); await putMove({ ingId: i.id, type: "purchase", qty: q, amount: amt, date, note }); toast(`Added ${qty(q, i.unit)} ${i.name}`); }
    if (st.type === "waste") { if (!await yesNo(`<p class="cq">Record wastage?</p><div class="cdetail">${qty(q, i.unit)} of ${esc(i.name)} will be removed from stock.</div>`, "Record")) return; await putMove({ ingId: i.id, type: "waste", qty: -q, date, note }); toast("Wastage recorded"); }
    if (st.type === "count") { const on = M.stockLevel(i).on; const d = q - on; if (!await yesNo(`<p class="cq">Set stock to ${qty(q, i.unit)}?</p><div class="cdetail">${esc(i.name)} shows ${qty(on, i.unit)} now. This ${d >= 0 ? "adds" : "removes"} ${qty(Math.abs(d), i.unit)}.</div>`, "Save count")) return; await putMove({ ingId: i.id, type: "count", qty: d, date, note: note || "Stock count" }); toast("Stock count saved"); }
    ingSheet(i.id); },
  bake: el => bakeSheet(el.dataset.date),
  saveBake: async () => { const st = ui.sheet; const lines = st.lines.filter(l => l.qty > 0).map(l => ({ item: l.item, qty: l.qty })); const ings = M.ingMap();
    const prep = st.prep.filter(p => p.runs > 0 && ings[p.ingId]).map(p => ({ ingId: p.ingId, runs: p.runs, qty: ings[p.ingId].yield * p.runs }));
    const { need, made } = M.batchNeed(lines, prep); const ids = Object.keys(need).filter(id => ings[id]); const me = R.me(); const no = M.nextBatchNo((me && me.prefix) || "");
    const what = [...lines.map(l => esc(l.item) + " × " + l.qty), ...prep.map(p => esc(ings[p.ingId].name) + " × " + p.runs + " run" + (p.runs > 1 ? "s" : "") + " (" + qty(p.qty, ings[p.ingId].unit) + ")")];
    if (!await yesNo(`<p class="cq">Save batch #${esc(no)}?</p><div class="cdetail">${what.join("<br>")}${ids.length ? "<br><br>Stock used: " + ids.map(id => esc(ings[id].name) + " " + qty(need[id], ings[id].unit)).join(", ") : ""}</div>`, "Save batch", "btn-ok")) return;
    const bakeId = uid("b"); const r2 = v => Math.round(v * 100) / 100;
    // Price everything before the moves change stock, so costs are as of this moment.
    const stock = ids.map(id => ({ ingId: id, qty: need[id], cost: r2(M.unitCost(ings[id]) * need[id]) }));
    const madeList = Object.keys(made).map(id => ({ ingId: id, qty: made[id], cost: r2(M.unitCost(ings[id]) * made[id]) }));
    const loc = st.loc || M.here();
    for (const id of ids) await putMove({ ingId: id, type: "bake", qty: -need[id], date: st.date, note: `Batch #${no}`, ref: bakeId, outletId: loc });
    for (const x of madeList) await putMove({ ingId: x.ingId, type: "make", qty: x.qty, date: st.date, note: `Batch #${no}`, ref: bakeId, outletId: loc });
    const net = stock.reduce((s, x) => s + x.cost, 0) - madeList.reduce((s, x) => s + x.cost, 0);
    await ev.put("bakes", { id: bakeId, no, date: st.date, lines, prep, notes: (st.notes || "").trim(), stock, made: madeList, cost: r2(Math.max(0, net)), madeBy: me ? me.id : "", at: new Date().toISOString(), outletId: loc });
    sync.soon(); closeSheet(); toast(`Batch #${no} saved`, `<button data-batch="${esc(bakeId)}">View</button>`); },
  newItem: () => itemSheet(null),
  addRecipeLine: () => { syncHost(); const st = ui.sheet; const ings = M.ingredients().filter(i => i.id !== st.x.id); if (ings.length) st.x.recipe.push({ ingId: ings[0].id, qty: 0 }); drawHost(st); },
  makeThis: () => { const id = ui.sheet.id; closeSheet(); bakeSheet(today(), { prep: { [id]: 1 } }); },
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
  const ig = T.closest("[data-ing]"); if (ig) { ingSheet(ig.dataset.ing); return true; }
  const mi = T.closest("[data-menuitem]"); if (mi) { if (R.can("menu.edit")) itemSheet(M.menu().find(m => m.id === mi.dataset.menuitem)); return true; }
  const tg = T.closest("[data-togm]"); if (tg) { if (!guard("menu.edit")) return true; const m = M.menu().find(x => x.id === tg.dataset.togm); if (m) { const { _at, _by, ...rec } = m; await ev.put("menu", { ...rec, active: m.active === false }); sync.soon(); menuSheet(); } return true; }
  const dm = T.closest("[data-delmove]"); if (dm) { const m = ev.get("moves", dm.dataset.delmove);
    if (m && await yesNo(`<p class="cq">Reverse this entry?</p><div class="cdetail">A correcting entry is added; the original stays in history.</div>`, "Reverse")) { await putMove({ ingId: m.ingId, type: "adjust", qty: -m.qty, note: "Reversal", ref: m.id, outletId: m.outletId }); ingSheet(st.id); } return true; }
  if (!st) return false;
  if (st.kind === "ingEdit") { const u = T.closest("[data-gunit]"); if (u) { syncIng(); st.x.unit = u.dataset.gunit; st.rf = 1; drawIngEdit(st); return true; } const r = T.closest("[data-grf]"); if (r) { syncIng(); st.rf = +r.dataset.grf; drawIngEdit(st); return true; }
    const tc = T.closest("[data-gtic]"); if (tc) { if (!R.isAdmin()) return true; syncIng(); st.x.taxInCost = tc.dataset.gtic === "1"; drawIngEdit(st); return true; }
    const ty = T.closest("[data-gtype]"); if (ty) { syncIng(); st.x.type = ty.dataset.gtype; drawIngEdit(st); return true; } }
  if (st.kind === "move") { const f = T.closest("[data-mf]"); if (f) { const v = $("#mQty").value, a2 = $("#mAmt") && $("#mAmt").value, n = $("#mNote").value, d = $("#mDate").value; st.f = +f.dataset.mf; drawMove(st); $("#mQty").value = v; if (a2 && $("#mAmt")) $("#mAmt").value = a2; $("#mNote").value = n; $("#mDate").value = d; return true; } }
  if (st.kind === "bake") { const b = T.closest("[data-bstep]"); if (b) { const [ix, d] = b.dataset.bstep.split(":").map(Number); st.lines[ix].qty = Math.max(0, st.lines[ix].qty + d); drawBake(st); return true; }
    const pb = T.closest("[data-pstep]"); if (pb) { const [ix, d] = pb.dataset.pstep.split(":").map(Number); st.prep[ix].runs = Math.max(0, st.prep[ix].runs + d); drawBake(st); return true; } }
  if (st.kind === "item" || st.kind === "ingEdit") { const rm = T.closest("[data-rprm]"); if (rm) { syncHost(); st.x.recipe.splice(+rm.dataset.rprm, 1); drawHost(st); return true; } }
  return false;
});
H.input.push(T => {
  const st = ui.sheet; if (st && st.kind === "bake" && T.id === "bNotes") { st.notes = T.value; return true; }
  if (st && st.kind === "ingEdit" && (T.dataset.rpqty != null || T.id === "gYield")) { if (T.dataset.rpqty != null) st.x.recipe[+T.dataset.rpqty].qty = num(T.value); else st.x.yield = num(T.value) * st.rf;
    const b = big(st.x.unit); const el = $("#sfCost"); if (el) el.textContent = st.x.yield ? rs2(sfUnitCost(st.x) * (b ? b.f : 1)) : "–"; return true; }
  if (!st || st.kind !== "item") return false;
  if (T.dataset.rpqty != null) st.x.recipe[+T.dataset.rpqty].qty = num(T.value);
  if (T.id === "iPrice") st.x.price = num(T.value);
  if (T.dataset.rpqty != null || T.id === "iPrice") { const rc = M.recipeCost(st.x); $("#rcCost") && ($("#rcCost").textContent = rs2(rc.cost)); $("#rcMargin") && ($("#rcMargin").textContent = st.x.price ? Math.round((1 - rc.cost / st.x.price) * 100) + "%" : "–"); return true; }
  return false;
});
H.change.push(T => {
  const st = ui.sheet; if (!st) return false;
  if (st.kind === "move" && T.id === "mIng") { st.ingId = T.value; st.f = 1; drawMove(st); return true; }
  if ((st.kind === "item" || st.kind === "ingEdit") && T.dataset.rping != null) { syncHost(); st.x.recipe[+T.dataset.rping].ingId = T.value; drawHost(st); return true; }
  return false;
});
