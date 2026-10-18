// BOM: multilevel bills of materials for finished items and semi-finished materials.
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
  if (!["fg", "sf"].includes(S.filter.bom)) S.filter.bom = "fg";
  const ings = M.ingMap(); const mm = M.menu(); const sfs = M.ingredients().filter(i => i.type === "sf");
  const q = (S.query.bom || "").toLowerCase().trim(); const k = S.filter.bom;
  const noBom = mm.filter(m => m.active !== false && !(m.recipe || []).length).length;
  let h = band("BOM", `${R.isAdmin() ? `<label class="pillbtn">${ICON.inbox}Upload BOM<input type="file" accept=".csv,text/csv,.xlsx" data-imp="bom" hidden></label><button class="pillbtn" data-tpl="bom">Template</button>` : ""}${R.can("menu.edit") ? `<button class="pillbtn" data-act="menu">${ICON.menu}Menu</button>` : ""}<button class="pillbtn" data-goplan>${ICON.plan}Planning</button>`,
    `<div class="stats"><div class="st"><b>${mm.length - mm.filter(m => !(m.recipe || []).length).length}/${mm.length}</b><span>menu items with a BOM</span></div><div class="st"><b>${sfs.length}</b><span>semi-finished</span></div><div class="st"><b>${Math.max(0, ...mm.map(m => depthOf(m.recipe, ings)))}</b><span>deepest level</span></div></div>`);
  h += `<div class="tools">${searchBox("bom", "Search item or material")}${chipBar("bom", [["fg", "Finished items", mm.length], ["sf", "Semi-finished", sfs.length]])}</div>`;
  if (k === "sf") {
    const list = sfs.filter(i => !q || (i.name + " " + i.recipe.map(r => (ings[r.ingId] || {}).name).join(" ")).toLowerCase().includes(q));
    if (!sfs.length) return h + `<div class="empty"><strong>No semi-finished materials yet</strong>Dough, fillings and glazes you make in-house. Add one in Inventory → Semi-finished, give it a recipe and what one run makes, then use it in menu BOMs.</div>`;
    return h + `<div class="bomlist">${list.map(i => { const uc = M.unitCost(i); const used = [...mm.filter(m => (m.recipe || []).some(r => r.ingId === i.id)), ...sfs.filter(x => x.recipe.some(r => r.ingId === i.id))];
      return `<details class="bakecard bomcard" id="bomsf-${esc(i.id)}"><summary><span class="grow">${esc(i.name)}<small class="mut" style="display:block;font-weight:600">makes ${qty(i.yield, i.unit)} per run${money() && uc ? " · " + rs2(uc * (i.unit === "pcs" ? 1 : 1000)) + "/" + (i.unit === "pcs" ? "pc" : i.unit === "g" ? "kg" : "L") : ""} · used in ${used.length ? used.map(x => esc(x.name)).join(", ") : "nothing yet"}</small></span><span class="cnt">${depthOf(i.recipe, ings)} level${depthOf(i.recipe, ings) === 1 ? "" : "s"}</span>${ICON.down}</summary>
        <div class="bthead"><span>Material · for one run</span><span>Qty</span><span>${money() ? "Cost" : ""}</span></div>${tree(i.recipe, 1, 0, ings, new Set([i.id])) || `<div class="bt"><span class="mut">No recipe yet</span></div>`}</details>`; }).join("") || `<div class="empty"><strong>Nothing matches</strong></div>`}</div>`;
  }
  const list = mm.filter(m => !q || (m.name + " " + (m.recipe || []).map(r => (ings[r.ingId] || {}).name).join(" ")).toLowerCase().includes(q));
  if (!mm.length) return h + `<div class="empty"><strong>No menu items yet</strong>Add items in Menu & recipes, then give each a BOM.</div>`;
  return h + (noBom ? `<p class="hint" style="padding:0 4px">${noBom} item${noBom === 1 ? " has" : "s have"} no BOM yet, so batches of ${noBom === 1 ? "it" : "them"} don’t touch stock or cost.</p>` : "")
    + `<div class="bomlist">${list.map(m => { const rc = M.recipeCost(m); const d = depthOf(m.recipe, ings);
      return `<details class="bakecard bomcard" id="bomfg-${esc(m.id)}"${list.length === 1 ? " open" : ""}><summary><span class="grow">${esc(m.name)}${m.active === false ? ` <span class="tag t-camp">off sale</span>` : ""}<small class="mut" style="display:block;font-weight:600">${money() ? `${rs(m.price)} · cost ${rc.lines ? rs2(rc.cost) : "–"}${rc.lines && m.price ? ` · margin ${Math.round((1 - rc.cost / m.price) * 100)}%` : ""}${rc.missing ? " · prices missing" : ""}` : `${(m.recipe || []).length} lines`}</small></span><span class="cnt">${(m.recipe || []).length ? d + " level" + (d === 1 ? "" : "s") : "no BOM"}</span>${ICON.down}</summary>
        <div class="bthead"><span>Material · per piece</span><span>Qty</span><span>${money() ? "Cost" : ""}</span></div>${tree(m.recipe, 1, 0, ings, new Set()) || `<div class="bt"><span class="mut">No BOM yet</span></div>`}
        ${R.can("menu.edit") ? `<div class="bt"><button class="linkbtn" data-menuitem="${esc(m.id)}">Edit BOM</button></div>` : ""}</details>`; }).join("") || `<div class="empty"><strong>Nothing matches</strong></div>`}</div>`;
};

// The day plan that used to live here is now the Planning screen (plan.js).
H.click.push(async T => { if (T.closest("[data-goplan]")) { S.view = "plan"; H.render(); window.scrollTo({ top: 0 }); return true; } return false; });
