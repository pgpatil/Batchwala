// Product labels: name, veg mark, ingredients (largest first), allergens, net quantity, price, batch number, made and best-before dates,
// and the business with its FSSAI licence. Printed as a sheet of labels (A4 label paper) from a batch or a menu item.
import * as M from "./model.js";
import { H } from "./core.js";
import { printHtml } from "./plan.js";
import { esc, rs, today, addDays, dLong, num } from "./util.js";
import { ui, toast, openSheet } from "./ui.js";

const DIET = { veg: ["#1e8e3e", "Veg"], egg: ["#c98a00", "Contains egg"], nonveg: ["#c5221f", "Non-veg"] };
const SIZES = { large: ["2 across (≈ 99 × 57 mm)", 2], small: ["3 across (≈ 64 × 38 mm)", 3] };
// Best before: the last day it can be sold, counting the day it was made.
const bestBefore = (m, made) => addDays(made, M.shelfLife(m) - 1);
const short = d => new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

export function labelHtml(m, { made, batch }) {
  const c = M.config(); const t = M.taxCfg(); const [col, dl] = DIET[m.diet || "veg"]; const alg = M.allergensOf(m); const ingr = M.labelIngredients(m);
  const price = M.total(M.withTax({ items: [{ item: m.name, qty: 1, rate: m.price, menuId: m.id }] }));
  return `<div class="lbl"><div class="lb-top"><span class="lb-mark" style="border-color:${col}" title="${esc(dl)}"><i style="background:${col}"></i></span><b class="lb-name">${esc(m.name)}</b></div>
    ${ingr ? `<div class="lb-ing"><b>Ingredients:</b> ${esc(ingr)}</div>` : ""}
    ${alg.length ? `<div class="lb-alg"><b>Contains: ${esc(alg.join(", "))}</b></div>` : ""}${m.mayContain ? `<div class="lb-may">May contain ${esc(m.mayContain)}</div>` : ""}
    <div class="lb-row">${m.netQty ? `<span>Net qty: <b>${esc(m.netQty)}</b></span>` : ""}<span>MRP <b>${rs(price)}</b>${t.on ? " incl. of all taxes" : ""}</span></div>
    <div class="lb-row">${batch ? `<span>Batch <b>${esc(batch)}</b></span>` : ""}<span>Mfd <b>${esc(short(made))}</b></span><span>Best before <b>${esc(short(bestBefore(m, made)))}</b></span></div>
    <div class="lb-biz">${esc(c.business)}${c.address ? " · " + esc(c.address.split("\n").join(", ")) : ""}${c.fssai ? ` · FSSAI Lic. No. ${esc(c.fssai)}` : ""}</div></div>`;
}

// from: { batchId } or { itemId }. One row per item with how many labels to print.
export function labelSheet(from) {
  let rows = [], made = today(), batch = "";
  if (from.batchId) { const b = M.batches().find(x => x.id === from.batchId); if (!b) return; made = b.date; batch = b.no || "";
    rows = b.lines.map(l => ({ m: M.menuByName(l.item), n: Math.max(0, l.qty - l.spoiled) })).filter(r => r.m); }
  else { const m = M.menu().find(x => x.id === from.itemId); if (!m) return; rows = [{ m, n: 1 }]; }
  if (!rows.length) { toast("These items aren’t on the menu any more"); return; }
  const st = { kind: "labels", rows, made, batch, size: "large", from }; st.redraw = () => drawLabels(st); drawLabels(st);
}
function drawLabels(st) {
  const c = M.config(); const missing = st.rows.filter(r => !(r.m.recipe || []).length).map(r => r.m.name);
  openSheet(st, `<div class="sh-head"><h2 class="h">Print labels</h2><button class="x" data-close aria-label="Close">×</button></div>
  <div class="kv">${st.rows.map((r, ix) => `<div style="align-items:center"><span>${esc(r.m.name)}<small class="mut" style="display:block">best before ${esc(dLong(bestBefore(r.m, st.made)))}</small></span><input class="in" data-lbn="${ix}" inputmode="numeric" value="${r.n}" style="max-width:90px" aria-label="Labels for ${esc(r.m.name)}"></div>`).join("")}</div>
  <div class="two"><div><label class="f" for="lbMade">Made on</label><input class="in" id="lbMade" type="date" value="${esc(st.made)}"></div><div><label class="f" for="lbBatch">Batch no.</label><input class="in" id="lbBatch" value="${esc(st.batch)}" placeholder="Optional"></div></div>
  <label class="f">Label size</label><div class="chips">${Object.entries(SIZES).map(([k, [l]]) => `<button class="chip" data-lbsize="${k}" aria-pressed="${st.size === k}">${l}</button>`).join("")}</div>
  ${!c.fssai ? `<p class="hint">Add your FSSAI licence number in Business settings to print it on labels.</p>` : ""}${missing.length ? `<p class="hint">No BOM yet for ${esc(missing.join(", "))}, so no ingredients or allergens will print for ${missing.length > 1 ? "them" : "it"}.</p>` : ""}
  <label class="f">Preview</label><div class="lblprev">${labelHtml(st.rows[0].m, st)}</div>
  <button class="btn btn-primary" data-lbprint>Print ${st.rows.reduce((s, r) => s + r.n, 0)} labels</button>`);
}
const syncLabels = st => { st.rows.forEach((r, ix) => { const el = document.querySelector(`[data-lbn="${ix}"]`); if (el) r.n = Math.max(0, Math.min(500, Math.round(num(el.value)))); });
  const d = document.getElementById("lbMade"); if (d && d.value) st.made = d.value; const b = document.getElementById("lbBatch"); if (b) st.batch = b.value.trim(); };
H.click.push(T => {
  const lb = T.closest("[data-labels]"); if (lb) { const [k, id] = lb.dataset.labels.split(":"); labelSheet(k === "batch" ? { batchId: id } : { itemId: id }); return true; }
  const st = ui.sheet; if (!st || st.kind !== "labels") return false;
  const sz = T.closest("[data-lbsize]"); if (sz) { syncLabels(st); st.size = sz.dataset.lbsize; drawLabels(st); return true; }
  if (T.closest("[data-lbprint]")) { syncLabels(st); const all = st.rows.flatMap(r => Array.from({ length: r.n }, () => labelHtml(r.m, st))); if (!all.length) { toast("Enter how many labels"); return true; }
    printHtml(`Labels ${st.batch || dLong(st.made)}`, `<div class="lblsheet c${SIZES[st.size][1]}">${all.join("")}</div>`, true); return true; }
  return false;
});
H.change.push(T => { const st = ui.sheet; if (!st || st.kind !== "labels" || !(T.id === "lbMade" || T.dataset.lbn != null)) return false; syncLabels(st); drawLabels(st); return true; });
