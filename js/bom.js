// BOM: multilevel bills of materials for finished items and semi-finished materials, and a plan that explodes a day's bake into what to make and buy.
import * as M from "./model.js";
import * as R from "./roles.js";
import { S, V, H, chipBar, searchBox, band } from "./core.js";
import { bakeSheet } from "./inventory.js";
import { esc, rs, rs2, today, addDays, dLong, qty, ICON, copyText, waHref } from "./util.js";
import { toast } from "./ui.js";

const TAGS = { rm: "RM", pm: "PM", sf: "Semi" };
const typeTag = i => `<span class="tag t-${i.type}">${TAGS[i.type] || "RM"}</span>`;
const money = () => R.can("money") && R.role() !== "kitchen";

// Rows for one recipe level; semi-finished lines open into their own recipe scaled to the quantity used. `seen` stops a loop.
function tree(recipe, mult, depth, ings, seen) {
  return (recipe || []).map(r => {
    const i = ings[r.ingId]; const q = (+r.qty || 0) * mult;
    if (!i) return `<div class="bt" style="--d:${depth}"><span class="bn mut">Removed material</span><span></span><span></span></div>`;
    const c = M.unitCost(i) * q; const open = i.type === "sf" && i.yield > 0 && i.recipe.length && !seen.has(i.id);
    return `<div class="bt${open ? " sfrow" : ""}" style="--d:${depth}"><button class="bn" data-ing="${esc(i.id)}">${esc(i.name)} ${typeTag(i)}</button><span>${qty(q, i.unit)}</span><span>${money() ? (c ? rs2(c) : `<span class="tag t-part">no price</span>`) : ""}</span></div>`
      + (open ? tree(i.recipe, q / i.yield, depth + 1, ings, new Set(seen).add(i.id)) : "");
  }).join("");
}
const depthOf = (recipe, ings, seen = new Set()) => Math.max(0, ...(recipe || []).map(r => { const i = ings[r.ingId]; return i && i.type === "sf" && !seen.has(i.id) ? 1 + depthOf(i.recipe, ings, new Set(seen).add(i.id)) : 1; }));

V.bom = () => {
  S.filter.bom = S.filter.bom || "fg";
  const ings = M.ingMap(); const mm = M.menu(); const sfs = M.ingredients().filter(i => i.type === "sf");
  const q = (S.query.bom || "").toLowerCase().trim(); const k = S.filter.bom;
  const noBom = mm.filter(m => m.active !== false && !(m.recipe || []).length).length;
  let h = band("BOM", R.can("menu.edit") ? `<button class="pillbtn" data-act="menu">${ICON.menu}Menu</button>` : "",
    `<div class="stats"><div class="st"><b>${mm.length - mm.filter(m => !(m.recipe || []).length).length}/${mm.length}</b><span>menu items with a BOM</span></div><div class="st"><b>${sfs.length}</b><span>semi-finished</span></div><div class="st"><b>${Math.max(0, ...mm.map(m => depthOf(m.recipe, ings)))}</b><span>deepest level</span></div></div>`);
  h += `<div class="tools">${k === "plan" ? "" : searchBox("bom", "Search item or material")}${chipBar("bom", [["fg", "Finished items", mm.length], ["sf", "Semi-finished", sfs.length], ["plan", "Plan & explode"]])}</div>`;
  if (k === "plan") return h + planView(ings);
  if (k === "sf") {
    const list = sfs.filter(i => !q || (i.name + " " + i.recipe.map(r => (ings[r.ingId] || {}).name).join(" ")).toLowerCase().includes(q));
    if (!sfs.length) return h + `<div class="empty"><strong>No semi-finished materials yet</strong>Dough, fillings and glazes you make in-house. Add one on Stock with type Semi-finished, give it a recipe and what one run makes, then use it in menu BOMs.</div>`;
    return h + `<div class="bomlist">${list.map(i => { const uc = M.unitCost(i); const used = [...mm.filter(m => (m.recipe || []).some(r => r.ingId === i.id)), ...sfs.filter(x => x.recipe.some(r => r.ingId === i.id))];
      return `<details class="bakecard bomcard"><summary><span class="grow">${esc(i.name)}<small class="mut" style="display:block;font-weight:600">makes ${qty(i.yield, i.unit)} per run${money() && uc ? " · " + rs2(uc * (i.unit === "pcs" ? 1 : 1000)) + "/" + (i.unit === "pcs" ? "pc" : i.unit === "g" ? "kg" : "L") : ""} · used in ${used.length ? used.map(x => esc(x.name)).join(", ") : "nothing yet"}</small></span><span class="cnt">${depthOf(i.recipe, ings)} level${depthOf(i.recipe, ings) === 1 ? "" : "s"}</span>${ICON.down}</summary>
        <div class="bthead"><span>Material · for one run</span><span>Qty</span><span>${money() ? "Cost" : ""}</span></div>${tree(i.recipe, 1, 0, ings, new Set([i.id])) || `<div class="bt"><span class="mut">No recipe yet</span></div>`}</details>`; }).join("") || `<div class="empty"><strong>Nothing matches</strong></div>`}</div>`;
  }
  const list = mm.filter(m => !q || (m.name + " " + (m.recipe || []).map(r => (ings[r.ingId] || {}).name).join(" ")).toLowerCase().includes(q));
  if (!mm.length) return h + `<div class="empty"><strong>No menu items yet</strong>Add items in Menu & recipes, then give each a BOM.</div>`;
  return h + (noBom ? `<p class="hint" style="padding:0 4px">${noBom} item${noBom === 1 ? " has" : "s have"} no BOM yet, so batches of ${noBom === 1 ? "it" : "them"} don’t touch stock or cost.</p>` : "")
    + `<div class="bomlist">${list.map(m => { const rc = M.recipeCost(m); const d = depthOf(m.recipe, ings);
      return `<details class="bakecard bomcard"${list.length === 1 ? " open" : ""}><summary><span class="grow">${esc(m.name)}${m.active === false ? ` <span class="tag t-camp">off sale</span>` : ""}<small class="mut" style="display:block;font-weight:600">${money() ? `${rs(m.price)} · cost ${rc.lines ? rs2(rc.cost) : "–"}${rc.lines && m.price ? ` · margin ${Math.round((1 - rc.cost / m.price) * 100)}%` : ""}${rc.missing ? " · prices missing" : ""}` : `${(m.recipe || []).length} lines`}</small></span><span class="cnt">${(m.recipe || []).length ? d + " level" + (d === 1 ? "" : "s") : "no BOM"}</span>${ICON.down}</summary>
        <div class="bthead"><span>Material · per piece</span><span>Qty</span><span>${money() ? "Cost" : ""}</span></div>${tree(m.recipe, 1, 0, ings, new Set()) || `<div class="bt"><span class="mut">No BOM yet</span></div>`}
        ${R.can("menu.edit") ? `<div class="bt"><button class="linkbtn" data-menuitem="${esc(m.id)}">Edit BOM</button></div>` : ""}</details>`; }).join("") || `<div class="empty"><strong>Nothing matches</strong></div>`}</div>`;
};

/* ---------- plan: explode a day's bake through every level ---------- */
function planView(ings) {
  const t = today(); const d = S.planDate || t;
  const lines = M.board(d).filter(r => r.toBake > 0).map(r => ({ item: r.item, qty: r.toBake }));
  const ex = M.explode(lines); const sm = ex.onHand;
  const ids = Object.keys(ex.need).filter(id => ings[id]);
  const bought = ids.filter(id => ings[id].type !== "sf").sort((a, b) => (ings[a].type + ings[a].name).localeCompare(ings[b].type + ings[b].name));
  const short = bought.filter(id => (sm[id] || 0) < ex.need[id]);
  const makeIds = Object.keys(ex.make).filter(id => ings[id]).sort((a, b) => (ex.level[a] || 0) - (ex.level[b] || 0));
  S.planText = `🛒 ${M.config().business} to buy for ${dLong(d)}\n` + short.map(id => `• ${ings[id].name}: ${qty(ex.need[id] - Math.max(0, sm[id] || 0), ings[id].unit)}`).join("\n");
  let h = `<div class="tools" style="padding-top:2px"><div class="chips">${[t, addDays(t, 1), addDays(t, 2)].map((x, i) => `<button class="chip" data-plandate="${x}" aria-pressed="${d === x}">${["Today", "Tomorrow", esc(dLong(x))][i]}</button>`).join("")}</div></div>`;
  if (!lines.length) return h + `<div class="empty"><strong>Nothing to bake for ${esc(dLong(d))}</strong>The plan uses the bake board: pre-orders plus kept-ready levels, less what’s already baked.</div>`;
  h += `<div class="plan"><div class="card"><h3>1 · Bake ${lines.reduce((s, l) => s + l.qty, 0)} pieces</h3><table><tbody>${lines.map(l => `<tr><td>${esc(l.item)}${ex.unknown.includes(l.item) ? ` <span class="tag t-part">no BOM</span>` : ""}</td><td>${l.qty}</td></tr>`).join("")}</tbody></table></div>
  <div class="card"><h3>2 · Prepare semi-finished</h3><table><thead><tr><th>Material</th><th>Need</th><th>Have</th><th>Make</th></tr></thead><tbody>${makeIds.map(id => { const i = ings[id];
    return `<tr><td>${esc(i.name)} <small class="mut">level ${(ex.level[id] || 0) + 1}</small></td><td>${qty(ex.need[id], i.unit)}</td><td>${qty(Math.max(0, sm[id] || 0), i.unit)}</td><td><b>${ex.make[id]} run${ex.make[id] === 1 ? "" : "s"}</b><small class="mut" style="display:block">${qty(ex.make[id] * i.yield, i.unit)}</small></td></tr>`; }).join("") || `<tr><td colspan="4">Nothing to prepare: semi-finished stock covers it, or no BOM uses one.</td></tr>`}</tbody></table></div>
  <div class="card"><h3>3 · Raw & packing materials ${short.length ? `<span class="tag t-due">${short.length} short</span>` : `<span class="tag t-paid">${ICON.check}all in stock</span>`}</h3><table><thead><tr><th>Material</th><th>Need</th><th>Have</th><th>Short</th></tr></thead><tbody>${bought.map(id => { const i = ings[id]; const have = Math.max(0, sm[id] || 0); const sh = ex.need[id] - have;
    return `<tr${sh > 0 ? ` class="shortrow"` : ""}><td>${esc(i.name)} ${typeTag(i)}</td><td>${qty(ex.need[id], i.unit)}</td><td>${qty(have, i.unit)}</td><td>${sh > 0 ? `<b class="due">${qty(sh, i.unit)}</b>` : "–"}</td></tr>`; }).join("") || `<tr><td colspan="4">No BOM lines for these items yet.</td></tr>`}</tbody></table></div></div>
  <div class="boardfoot">${R.can("bake.record") ? `<button class="btn btn-primary" data-planbake="${d}">${ICON.oven}Record this as a batch</button>` : ""}
  ${short.length && R.can("stock.buy") ? `<div class="btnrow"><a class="btn btn-wa" href="${esc(waHref("", S.planText))}" target="_blank" rel="noopener">${ICON.wa}Share buy list</a><button class="btn btn-ghost" data-plancopy>Copy buy list</button></div>` : ""}
  <p class="hint">Semi-finished stock on hand is used first; only the shortfall is made, in whole recipe runs, and that is exploded into its own materials. Quantities include every level.</p></div>`;
  return h;
}
H.click.push(async T => {
  const pd = T.closest("[data-plandate]"); if (pd) { S.planDate = pd.dataset.plandate; H.render(); return true; }
  const pb = T.closest("[data-planbake]"); if (pb) { bakeSheet(pb.dataset.planbake); return true; }
  if (T.closest("[data-plancopy]")) { toast(await copyText(S.planText || "") ? "Buy list copied" : "Couldn’t copy here"); return true; }
  return false;
});
