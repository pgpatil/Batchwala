// Planning: for a day, the finished goods to make, the semi-finished to prepare and the indent of materials; batch cards scaled to any batch size.
import * as ev from "./events.js";
import * as sync from "./sync.js";
import * as M from "./model.js";
import * as R from "./roles.js";
import { asLines, layoutSwitch } from "./table.js";
import { S, V, H, chipBar, band } from "./core.js";
import { bakeSheet } from "./inventory.js";
import { esc, rs, rs2, num, today, addDays, dLong, qty, UNITS, ICON, copyText, waHref } from "./util.js";
import { toast } from "./ui.js";

const TAGS = { rm: "RM", pm: "PM", sf: "Semi" };
const typeTag = i => `<span class="tag t-${i.type}">${TAGS[i.type] || "RM"}</span>`;
const money = () => R.can("money") && R.role() !== "kitchen";
const canPlan = () => R.can("bake.record") || R.can("orders.edit") || R.can("menu.edit");
const erp = () => R.mode() === "erp" && !!H.prodLines;
const planLoc = () => erp() ? H.prodKitchen() : "";
const stockLoc = () => M.erpOn() ? (erp() ? H.prodKitchen() : M.here()) : null;   // whose shelves the plan draws on
const r2 = v => Math.round(v * 100) / 100;
const runsTxt = n => `${+(+n).toFixed(2)} run${+(+n).toFixed(2) === 1 ? "" : "s"}`;

/* ---------- what to make ---------- */
// Suggested pieces: the bake board (pre-orders + kept ready − baked), or in ERP what the outlets need less what the kitchen holds.
function suggested(d) {
  if (erp()) return M.production(d, H.prodKitchen()).map(r => ({ item: r.item, qty: r.toBake, why: `outlets need ${r.need}${r.atKitchen ? ` · ${r.atKitchen} at kitchen` : ""}` }));
  return M.board(d).map(r => ({ item: r.item, qty: r.toBake, why: [r.committed && `${r.committed} pre-ordered`, r.par && `keep ${r.par} ready`, r.baked && `${r.baked} baked`].filter(Boolean).join(" · ") }));
}
// The day's plan: the saved one if someone edited it, else the suggestion.
export function planLines(d) {
  const p = M.planOf(d, planLoc());
  return (p ? p.lines : suggested(d)).filter(l => l.qty > 0).map(l => ({ item: l.item, qty: l.qty }));
}
async function savePlan(d, lines) {
  await ev.put("plans", { id: M.planId(d, planLoc()), date: d, loc: planLoc(), lines: lines.filter(l => l.item).map(l => ({ item: l.item, qty: Math.max(0, Math.round(+l.qty || 0)) })) }); sync.soon();
}

/* ---------- indent ---------- */
function indentRows(ex, full) {
  const ings = M.ingMap(); const sm = ex.onHand; const oo = M.onOrder();   // approved POs not yet received count as coming
  return Object.keys(ex.need).filter(id => ings[id] && ings[id].type !== "sf" && ex.need[id] > 0).map(id => { const i = ings[id]; const have = Math.max(0, sm[id] || 0); const ord = oo[id] || 0;
    return { i, need: ex.need[id], have, ord, ind: full ? ex.need[id] : Math.max(0, ex.need[id] - have - ord) }; })
    .sort((a, b) => (a.i.type + (a.i.category || "~") + a.i.name).localeCompare(b.i.type + (b.i.category || "~") + b.i.name));
}
const indentText = (d, rows, full) => `📋 ${M.config().business} ${full ? "store issue" : "purchase indent"} · ${dLong(d)}\n` + rows.filter(r => r.ind > 0).map(r => `• ${r.i.name}: ${qty(r.ind, r.i.unit)}`).join("\n");

/* ---------- batch card ---------- */
function cardRef() {
  const c = S.card || (S.card = { ref: "", qty: 0, scratch: true });
  const fgs = M.menu().filter(m => (m.recipe || []).length), sfs = M.ingredients().filter(i => i.type === "sf" && i.yield > 0 && i.recipe.length);
  let rec = c.ref.startsWith("m:") ? fgs.find(m => m.id === c.ref.slice(2)) : c.ref.startsWith("i:") ? sfs.find(i => i.id === c.ref.slice(2)) : null;
  if (!rec && (fgs[0] || sfs[0])) { rec = fgs[0] || sfs[0]; c.ref = (fgs[0] ? "m:" : "i:") + rec.id; c.qty = 0; }
  if (rec && !(c.qty > 0)) c.qty = rec.type === "sf" ? rec.yield : 10;
  return { c, rec, fgs, sfs };
}
function cardHtml(rec, c, d, forPrint) {
  const sf = rec.type === "sf"; const card = M.batchCard(rec, c.qty, c.scratch); const sm = M.stockMap(stockLoc()); const me = R.me();
  const head = sf ? `${esc(rec.name)} · ${qty(c.qty, rec.unit)} <small class="mut">(${runsTxt(c.qty / rec.yield)})</small>` : `${esc(rec.name)} × ${c.qty}`;
  const box = forPrint ? `<td class="tick">☐</td>` : "";
  return `<div class="bcard"><div class="bc-head"><div><small class="mut">${esc(M.config().business)} · Batch card</small><h3>${head}</h3></div>
    <div class="bc-meta"><span>Batch <b>#${esc(M.nextBatchNo((me && me.prefix) || ""))}</b></span><span>${esc(dLong(d))}</span></div></div>
    ${card.steps.map((s, n) => `<div class="bc-step"><h4>Step ${n + 1} · ${s.made ? `Make ${esc(s.made.ing.name)} · ${qty(s.made.qty, s.made.ing.unit)} <small class="mut">(${runsTxt(s.made.runs)})</small>` : `${esc(rec.name)}${sf ? "" : ` × ${c.qty}`}`}</h4>
      <table><tbody>${s.lines.map(l => `<tr><td>${esc(l.ing.name)} ${typeTag(l.ing)}</td><td class="num">${qty(l.qty, l.ing.unit)}</td>${box}</tr>`).join("")}</tbody></table></div>`).join("")}
    <div class="bc-step"><h4>All materials for this batch</h4><table><thead><tr><th>Material</th><th class="num">Qty</th>${forPrint ? `<th>Issued</th>` : `<th class="num">In stock</th>`}</tr></thead><tbody>${card.total.map(t => { const have = Math.max(0, sm[t.ing.id] || 0); const short = have < t.qty;
      return `<tr${!forPrint && short ? ` class="shortrow"` : ""}><td>${esc(t.ing.name)} ${typeTag(t.ing)}</td><td class="num">${qty(t.qty, t.ing.unit)}</td>${forPrint ? box : `<td class="num">${short ? `<b class="due">${qty(have, t.ing.unit)}</b>` : qty(have, t.ing.unit)}</td>`}</tr>`; }).join("") || `<tr><td colspan="3">No materials in this BOM yet.</td></tr>`}</tbody></table></div>
    ${money() ? `<p class="hint">Material cost ${rs2(card.cost)}${sf ? ` · ${rs2(card.cost / (c.qty / (rec.unit === "pcs" ? 1 : 1000)))}/${rec.unit === "pcs" ? "pc" : UNITS[rec.unit].big}` : ` · ${rs2(card.cost / c.qty)} per piece`}</p>` : ""}
    ${forPrint ? `<div class="bc-sign"><span>Made by ________</span><span>Start __:__</span><span>End __:__</span><span>Made ______</span><span>Spoiled ______</span><span>Checked by ________</span></div>` : ""}</div>`;
}
function cardText(rec, c, d) {
  const card = M.batchCard(rec, c.qty, c.scratch); const sf = rec.type === "sf";
  return `🧾 ${M.config().business} batch card · ${rec.name} ${sf ? qty(c.qty, rec.unit) : "× " + c.qty} · ${dLong(d)}\n`
    + card.steps.map((s, n) => `\nStep ${n + 1} · ${s.made ? `Make ${s.made.ing.name} ${qty(s.made.qty, s.made.ing.unit)} (${runsTxt(s.made.runs)})` : `${rec.name}${sf ? "" : " × " + c.qty}`}\n` + s.lines.map(l => `• ${l.ing.name}: ${qty(l.qty, l.ing.unit)}`).join("\n")).join("\n");
}

/* ---------- printing ---------- */
export function printHtml(title, html) {
  let el = document.getElementById("printArea"); if (!el) { el = document.createElement("div"); el.id = "printArea"; document.body.appendChild(el); }
  el.innerHTML = `<h2>${esc(title)}</h2>` + html; document.body.classList.add("printing");
  const done = () => { document.body.classList.remove("printing"); window.removeEventListener("afterprint", done); };
  window.addEventListener("afterprint", done); window.print(); setTimeout(done, 1500);
}

/* ---------- screen ---------- */
V.plan = () => {
  S.filter.plan = S.filter.plan || "fg"; S.filter.indent = S.filter.indent || "short"; const k = S.filter.plan;
  const t = today(); const d = S.planDate || t; const ings = M.ingMap();
  const lines = planLines(d); const ex = M.explode(lines, stockLoc()); const saved = !!M.planOf(d, planLoc());
  const sfIds = Object.keys(ex.need).filter(id => ings[id] && ings[id].type === "sf").sort((a, b) => (ex.level[a] || 0) - (ex.level[b] || 0) || ings[a].name.localeCompare(ings[b].name));
  const short = indentRows(ex, false).filter(r => r.ind > 0);
  const pcs = lines.reduce((s, l) => s + l.qty, 0); const runs = Object.values(ex.make).reduce((s, n) => s + n, 0);
  let h = band(erp() ? `Planning · ${esc(M.locName(H.prodKitchen()))}` : "Planning", `${lines.length ? `<button class="pillbtn" data-planprint>${ICON.print}Print plan</button>` : ""}`,
    `<div class="stats"><div class="st"><b>${pcs}</b><span>pieces to make</span></div><div class="st"><b>${runs}</b><span>semi-finished runs</span></div><div class="st"><b>${short.length}</b><span>materials to buy</span></div></div>`);
  h += `<div class="tools"><div class="chips">${[t, addDays(t, 1), addDays(t, 2)].map((x, i) => `<button class="chip" data-plandate="${x}" aria-pressed="${d === x}">${["Today", "Tomorrow", esc(dLong(x))][i]}</button>`).join("")}<label class="chip datechip">${[t, addDays(t, 1), addDays(t, 2)].includes(d) ? "Other date" : esc(dLong(d))}<input type="date" data-plandatein value="${d}"></label></div></div>
    <div class="tools" style="padding-top:0">${layoutSwitch("plan")}${chipBar("plan", [["fg", "Finished goods", lines.length], ["sf", "Semi-finished", sfIds.length], ["indent", "Indent", short.length || null], ["card", "Batch card"]])}</div>`;
  if (k === "card") return h + cardView(d);
  if (k === "fg") return h + fgView(d, lines, ex, saved);
  if (!lines.length) return h + `<div class="empty"><strong>Nothing planned for ${esc(dLong(d))}</strong>Add finished goods in the Finished goods tab; semi-finished and the indent follow from their BOMs.</div>`;
  if (k === "sf") return h + `<div class="plan"><div class="card"><h3>Semi-finished to make <small class="mut">for ${pcs} pieces</small></h3><table><thead><tr><th>Material</th><th>Needed</th><th>In stock</th><th>To make</th><th></th></tr></thead><tbody>${sfIds.map(id => { const i = ings[id]; const n = ex.make[id] || 0;
      return `<tr><td>${esc(i.name)} <small class="mut">level ${(ex.level[id] || 0) + 1}</small></td><td>${qty(ex.need[id], i.unit)}</td><td>${qty(Math.max(0, ex.onHand[id] || 0), i.unit)}</td><td>${n ? `<b>${qty(n * i.yield, i.unit)}</b><small class="mut" style="display:block">${runsTxt(n)}</small>` : `<span class="tag t-paid">${ICON.check}in stock</span>`}</td><td>${n ? `<button class="linkbtn" data-cardfor="i:${esc(id)}:${n * i.yield}">Batch card</button>` : ""}</td></tr>`; }).join("") || `<tr><td colspan="5">These items use no semi-finished materials.</td></tr>`}</tbody></table></div></div>
    <div class="boardfoot">${R.can("bake.record") && runs ? `<button class="btn btn-primary" data-planprep="${d}">${ICON.oven}Record the semi-finished as a batch</button>` : ""}<p class="hint">Stock on hand is used first; only the shortfall is made, in whole recipe runs, and each run is exploded into its own materials (level 2 and deeper).</p></div>`;
  // indent
  const full = S.filter.indent === "full"; const rows = indentRows(ex, full); S.indentText = indentText(d, rows, full);
  const groups = [...new Set(rows.map(r => r.i.type + "|" + (r.i.category || "Other")))];
  return h + `<div class="tools" style="padding-top:0">${chipBar("indent", [["short", "To buy · shortfall"], ["full", "Store issue · full quantity"]])}</div>
    <div class="plan"><div class="card"><h3>${full ? "Issue from store" : "Purchase indent"} <small class="mut">for ${esc(dLong(d))}</small></h3><table><thead><tr><th>Material</th><th>Required</th><th>In stock</th>${full ? "" : "<th>On order</th>"}<th>${full ? "Issue" : "To buy"}</th></tr></thead><tbody>
    ${groups.map(g => { const [ty, cat] = g.split("|"); return `<tr class="grp"><td colspan="${full ? 4 : 5}">${esc(M.ING_TYPES[ty])} · ${esc(cat)}</td></tr>` + rows.filter(r => r.i.type + "|" + (r.i.category || "Other") === g).map(r => `<tr${!full && r.ind > 0 ? ` class="shortrow"` : ""}><td>${esc(r.i.name)} ${typeTag(r.i)}</td><td>${qty(r.need, r.i.unit)}</td><td>${qty(r.have, r.i.unit)}</td>${full ? "" : `<td>${r.ord ? qty(r.ord, r.i.unit) : "–"}</td>`}<td>${r.ind > 0 ? `<b${full ? "" : ` class="due"`}>${qty(r.ind, r.i.unit)}</b>` : "–"}</td></tr>`).join(""); }).join("") || `<tr><td colspan="4">No BOM lines for these items yet.</td></tr>`}</tbody></table></div></div>
    <div class="boardfoot">${rows.some(r => r.ind > 0) ? `<div class="btnrow3"><a class="btn btn-wa" href="${esc(waHref("", S.indentText))}" target="_blank" rel="noopener">${ICON.wa}Share</a><button class="btn btn-ghost" data-indentcopy>Copy</button><button class="btn btn-ghost" data-indentprint>${ICON.print}Print</button></div>${!full && R.can("stock.buy") && H.draftPOs ? `<button class="btn btn-primary" data-indentpo>${ICON.inbox}Draft purchase orders</button>` : ""}` : `<p class="hint">${full ? "Nothing to issue." : "Everything is in stock for this plan."}</p>`}
    <p class="hint">Includes every level of the BOM: semi-finished runs to be made add their own materials. ${full ? "Full quantities, for issuing from the store to the kitchen." : "Only what stock on hand doesn’t cover."}</p></div>`;
};
function fgView(d, lines, ex, saved) {
  const sug = suggested(d); const edit = canPlan(); const names = [...new Set([...sug.filter(s => s.qty > 0 || s.why).map(s => s.item), ...lines.map(l => l.item)])];
  const planQ = n => (lines.find(l => l.item === n) || {}).qty || 0; const cur = M.planOf(d, planLoc()); const shown = cur ? [...new Set([...names, ...cur.lines.map(l => l.item)])] : names;
  const left = M.menuActive().filter(m => !shown.includes(m.name));
  return `<div class="plan"><div class="card"><h3>Finished goods to make ${saved ? `<span class="tag t-camp">edited</span>` : `<span class="tag t-paid">suggested</span>`}</h3>
    <table><thead><tr><th>Item</th><th>Suggested</th><th>Plan</th><th></th></tr></thead><tbody>${shown.map(n => { const s = sug.find(x => x.item === n) || { qty: 0, why: "" }; const m = M.menuByName(n);
      return `<tr><td>${esc(n)}${!m || !(m.recipe || []).length ? ` <span class="tag t-part">no BOM</span>` : ""}<small class="mut" style="display:block">${esc(s.why || "added to the plan")}</small></td><td>${s.qty}</td>
      <td>${edit ? `<input class="rate" data-planq="${esc(n)}" inputmode="numeric" value="${planQ(n) || ""}" placeholder="0" aria-label="Plan for ${esc(n)}">` : planQ(n)}</td><td>${m && (m.recipe || []).length && planQ(n) ? `<button class="linkbtn" data-cardfor="m:${esc(m.id)}:${planQ(n)}">Batch card</button>` : ""}</td></tr>`; }).join("") || `<tr><td colspan="4">Nothing suggested for ${esc(dLong(d))}.</td></tr>`}</tbody></table>
    ${edit && left.length ? `<select class="in" data-planadd style="margin-top:10px"><option value="">+ Add an item to the plan</option>${left.map(m => `<option value="${esc(m.name)}">${esc(m.name)}</option>`).join("")}</select>` : ""}</div></div>
  <div class="boardfoot">${R.can("bake.record") && lines.length ? `<button class="btn btn-primary" data-planbake="${d}">${ICON.oven}Record this plan as a batch</button>` : ""}
  ${R.can("bake.record") && lines.length && H.woNew ? `<button class="btn btn-ghost" data-planwo="${d}">Create a work order for this plan</button>` : ""}
  ${edit && saved ? `<button class="btn btn-ghost" data-planreset="${d}">Back to the suggestion</button>` : ""}
  <p class="hint">${erp() ? "Suggested: what the outlets need for the day less finished goods at the kitchen." : "Suggested: pre-orders plus kept-ready levels, less what’s already baked."} Change any quantity to plan your own; the plan is saved for everyone and the semi-finished and indent tabs follow it.</p></div>`;
}
function cardView(d) {
  const { c, rec, fgs, sfs } = cardRef();
  if (!rec) return `<div class="empty"><strong>No BOMs yet</strong>Give a menu item or semi-finished material a BOM, then make a batch card for any quantity here.</div>`;
  const sf = rec.type === "sf"; const b = UNITS[rec.unit]; const hasSf = !sf ? (rec.recipe || []).some(r => { const i = M.ingMap()[r.ingId]; return i && i.type === "sf"; }) : rec.recipe.some(r => { const i = M.ingMap()[r.ingId]; return i && i.type === "sf"; });
  const planned = !sf && (planLines(d).find(l => l.item === rec.name) || {}).qty;
  return `<div class="plan"><div class="card cardform"><div class="two"><div><label class="f" for="cardRef">Product</label><select class="in" id="cardRef" data-cardref>
      ${fgs.length ? `<optgroup label="Finished items">${fgs.map(m => `<option value="m:${esc(m.id)}" ${c.ref === "m:" + m.id ? "selected" : ""}>${esc(m.name)}</option>`).join("")}</optgroup>` : ""}
      ${sfs.length ? `<optgroup label="Semi-finished">${sfs.map(i => `<option value="i:${esc(i.id)}" ${c.ref === "i:" + i.id ? "selected" : ""}>${esc(i.name)}</option>`).join("")}</optgroup>` : ""}</select></div>
    <div><label class="f" for="cardQty">Batch quantity <small class="mut">(${sf ? (b ? b.big : rec.unit) : "pieces"})</small></label><input class="in" id="cardQty" data-cardqty inputmode="decimal" value="${sf && b ? +(c.qty / b.f).toFixed(3) : c.qty}"></div></div>
    <div class="chips" style="margin-top:8px">${sf ? [0.5, 1, 2, 3].map(n => `<button class="chip" data-cardset="${n * rec.yield}" aria-pressed="${Math.abs(c.qty - n * rec.yield) < 1e-6}">${runsTxt(n)}</button>`).join("")
      : [...new Set([planned, 10, 25, 50, 100].filter(Boolean))].map(n => `<button class="chip" data-cardset="${n}" aria-pressed="${c.qty === n}">${n === planned ? `Plan: ${n}` : n}</button>`).join("")}</div>
    ${hasSf ? `<label class="f">Semi-finished in this BOM</label><div class="chips">${[[true, "Make in this batch"], [false, "Take from stock"]].map(([v, l]) => `<button class="chip" data-cardscratch="${v ? 1 : 0}" aria-pressed="${c.scratch === v}">${l}</button>`).join("")}</div>` : ""}</div>
    ${cardHtml(rec, c, d, false)}</div>
  <div class="boardfoot"><div class="btnrow3"><button class="btn btn-primary" data-cardprint>${ICON.print}Print card</button><a class="btn btn-wa" href="${esc(waHref("", cardText(rec, c, d)))}" target="_blank" rel="noopener">${ICON.wa}Share</a><button class="btn btn-ghost" data-cardcopy>Copy</button></div>
  ${R.can("bake.record") ? `<div class="btnrow"><button class="btn btn-ghost" data-cardwo>Create work order</button><button class="btn btn-ok" data-cardbake>${ICON.oven}Record this batch</button></div>` : ""}
  <p class="hint">Change the quantity and every level of the BOM is recalculated. The card lists each step (semi-finished first) and the total of every material, ready to print for the kitchen.</p></div>`;
}

/* ---------- actions ---------- */
H.click.push(async T => {
  if (S.view !== "plan") return false; const d = S.planDate || today();
  const pd = T.closest("[data-plandate]"); if (pd) { S.planDate = pd.dataset.plandate; H.render(); return true; }
  const cf = T.closest("[data-cardfor]"); if (cf) { const [k, id, q] = cf.dataset.cardfor.split(":"); S.card = { ref: k + ":" + id, qty: r2(+q), scratch: true }; S.filter.plan = "card"; H.render(); window.scrollTo({ top: 0 }); return true; }
  if (T.closest("[data-planbake]")) { bakeSheet(d, { lines: planLines(d) }); return true; }
  if (T.closest("[data-planwo]")) { H.woNew({ date: d, lines: planLines(d), prep: M.explode(planLines(d), stockLoc()).make }); return true; }
  if (T.closest("[data-planprep]")) { bakeSheet(d, { prep: M.explode(planLines(d), stockLoc()).make }); return true; }
  if (T.closest("[data-planreset]")) { await ev.del("plans", M.planId(d, planLoc())); sync.soon(); toast("Plan back to the suggestion"); return true; }
  if (T.closest("[data-indentpo]")) { const ex = M.explode(planLines(d), stockLoc()); const made = await H.draftPOs(indentRows(ex, false).filter(r => r.ind > 0).map(r => ({ ingId: r.i.id, qty: r.ind })), `For ${dLong(d)}`);
    if (!made.length) { toast("Everything short is already on order"); return true; } S.filter.po = "draft"; S.view = "po"; H.render(); window.scrollTo({ top: 0 }); toast(`${made.length} draft PO${made.length > 1 ? "s" : ""} made · approve to send`); return true; }
  if (T.closest("[data-indentcopy]")) { toast(await copyText(S.indentText || "") ? "Indent copied" : "Couldn’t copy here"); return true; }
  if (T.closest("[data-indentprint]")) { printHtml(S.filter.indent === "full" ? "Store issue" : "Purchase indent", document.querySelector("#main .plan").innerHTML); return true; }
  if (T.closest("[data-planprint]")) { const lines = planLines(d); const ex = M.explode(lines, stockLoc()); const ings = M.ingMap();
    const sf = Object.keys(ex.make).filter(id => ings[id]).map(id => `<tr><td>${esc(ings[id].name)}</td><td class="num">${qty(ex.make[id] * ings[id].yield, ings[id].unit)} (${runsTxt(ex.make[id])})</td><td class="tick">☐</td></tr>`).join("");
    const ind = indentRows(ex, true).map(r => `<tr><td>${esc(r.i.name)}</td><td class="num">${qty(r.ind, r.i.unit)}</td><td class="num">${qty(r.have, r.i.unit)}</td></tr>`).join("");
    printHtml(`Production plan · ${dLong(d)}`, `<div class="bcard"><div class="bc-step"><h4>Finished goods</h4><table><tbody>${lines.map(l => `<tr><td>${esc(l.item)}</td><td class="num">${l.qty}</td><td class="tick">☐</td></tr>`).join("")}</tbody></table></div>
      ${sf ? `<div class="bc-step"><h4>Semi-finished to make</h4><table><tbody>${sf}</tbody></table></div>` : ""}<div class="bc-step"><h4>Materials (full quantity)</h4><table><thead><tr><th>Material</th><th class="num">Required</th><th class="num">In stock</th></tr></thead><tbody>${ind}</tbody></table></div></div>`); return true; }
  const { c, rec } = cardRef();
  const cs = T.closest("[data-cardset]"); if (cs) { c.qty = r2(+cs.dataset.cardset); H.render(); return true; }
  const sc = T.closest("[data-cardscratch]"); if (sc) { c.scratch = sc.dataset.cardscratch === "1"; H.render(); return true; }
  if (!rec) return false;
  if (T.closest("[data-cardprint]")) { printHtml(`Batch card · ${rec.name}`, cardHtml(rec, c, d, true)); return true; }
  if (T.closest("[data-cardcopy]")) { toast(await copyText(cardText(rec, c, d)) ? "Batch card copied" : "Couldn’t copy here"); return true; }
  if (T.closest("[data-cardwo]")) { const card = M.batchCard(rec, c.qty, c.scratch); const prep = {}; card.steps.forEach(s => { if (s.made) prep[s.made.ing.id] = r2(s.made.runs); });
    H.woNew({ date: d, lines: rec.type === "sf" ? [] : [{ item: rec.name, qty: Math.round(c.qty) }], prep }); return true; }
  if (T.closest("[data-cardbake]")) { const card = M.batchCard(rec, c.qty, c.scratch); const prep = {}; card.steps.forEach(s => { if (s.made) prep[s.made.ing.id] = r2(s.made.runs); });
    bakeSheet(d, rec.type === "sf" ? { prep } : { lines: [{ item: rec.name, qty: Math.round(c.qty) }], prep }); return true; }
  return false;
});
H.change.push(async T => {
  if (S.view !== "plan") return false; const d = S.planDate || today();
  if (T.matches("[data-plandatein]")) { if (T.value) { S.planDate = T.value; H.render(); } return true; }
  if (T.matches("[data-planq]")) { const lines = planLines(d); const n = T.dataset.planq; const q = Math.max(0, Math.round(num(T.value))); const l = lines.find(x => x.item === n);
    if (l) l.qty = q; else lines.push({ item: n, qty: q }); const cur = M.planOf(d, planLoc()); if (cur) cur.lines.filter(x => !x.qty && x.item !== n).forEach(x => lines.push(x));
    await savePlan(d, q ? lines : [...lines, { item: n, qty: 0 }]); return true; }
  if (T.matches("[data-planadd]")) { if (!T.value) return true; const lines = planLines(d); lines.push({ item: T.value, qty: 1 }); await savePlan(d, lines); toast(`${T.value} added to the plan`); return true; }
  if (T.matches("[data-cardref]")) { S.card = { ref: T.value, qty: 0, scratch: true }; H.render(); return true; }
  return false;
});
H.input.push(T => {
  if (S.view !== "plan" || !T.matches("[data-cardqty]")) return false; const { c, rec } = cardRef(); if (!rec) return true;
  const b = rec.type === "sf" ? UNITS[rec.unit] : null; const v = num(T.value); if (!(v > 0) || /[.,]$/.test(T.value)) return true;
  c.qty = r2(v * (b ? b.f : 1)); H.render(); return true;
});
