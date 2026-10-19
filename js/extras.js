// Discounts beyond the quick % chips (a custom % or ₹ amount, or a coupon set up in Business settings) and charges on top of the
// items (delivery, packing). Shared by the counter ticket and the order form: both hold discountPct, discountAmt, coupon and charges.
import * as M from "./model.js";
import { esc, rs, num, today } from "./util.js";
import { toast, ask } from "./ui.js";

export const chargeOpts = () => (M.config().charges || []).filter(c => c && c.name && +c.amount > 0);
const chargeTax = () => M.taxCfg().on ? +M.taxCfg().rate || 0 : 0;
const itemsValue = x => (x.items || []).reduce((s, i) => s + i.qty * i.rate, 0);
const preset = x => !x.coupon && !(+x.discountAmt > 0);

export function extrasHtml(x, label = "Discount") {
  const on = n => (x.charges || []).some(c => c.name === n); const opts = chargeOpts(); const other = (x.charges || []).filter(c => !opts.some(o => o.name === c.name));
  const custom = !preset(x) || ![0, 5, 10, 15].includes(x.discountPct || 0);
  return `<div class="offer">${label} ${[0, 5, 10, 15].map(d => `<button class="chip" data-xdisc="${d}" aria-pressed="${preset(x) && (x.discountPct || 0) === d}">${d ? d + "%" : "None"}</button>`).join("")}
    <button class="chip" data-xcustom aria-pressed="${custom && !x.coupon}">${custom && !x.coupon ? (+x.discountAmt > 0 ? rs(x.discountAmt) : x.discountPct + "%") : "Custom…"}</button>
    ${(M.config().coupons || []).length ? `<button class="chip" data-xcoupon aria-pressed="${!!x.coupon}">${x.coupon ? "🏷 " + esc(x.coupon) : "Coupon…"}</button>` : ""}</div>
  <div class="offer" style="margin-top:6px">Charges ${opts.map(o => `<button class="chip" data-xcharge="${esc(o.name)}" aria-pressed="${on(o.name)}">${esc(o.name)} ${rs(o.amount)}</button>`).join("")}
    ${other.map(c => `<button class="chip" data-xcharge="${esc(c.name)}" aria-pressed="true">${esc(c.name)} ${rs(c.amount)} ×</button>`).join("")}<button class="chip" data-xother>Other…</button></div>`;
}

// Returns true when the click was one of these controls (x is changed in place); the caller redraws.
export async function extrasClick(T, x) {
  const d = T.closest("[data-xdisc]"); if (d) { x.discountPct = +d.dataset.xdisc; x.discountAmt = 0; x.coupon = ""; return true; }
  if (T.closest("[data-xcustom]")) {
    const r = await ask(`<p class="cq">Custom discount</p><input class="in" id="xdAmt" inputmode="decimal" placeholder="Amount" style="margin-top:12px"><div class="chips" style="margin-top:8px"><label class="chip"><input type="radio" name="xdk" value="pct" checked> % off</label><label class="chip"><input type="radio" name="xdk" value="amt"> ₹ off</label></div>`,
      [{ label: "Cancel", cls: "btn-ghost", value: null }, { label: "Apply", cls: "btn-primary", value: true }], true);
    if (!r) return true; const v = num((document.getElementById("xdAmt") || {}).value); const pct = ((document.querySelector('input[name="xdk"]:checked') || {}).value || "pct") === "pct";
    if (!(v > 0)) { x.discountPct = 0; x.discountAmt = 0; x.coupon = ""; return true; }
    if (pct && v > 100) { toast("A discount can’t be over 100%"); return true; }
    if (pct) { x.discountPct = v; x.discountAmt = 0; } else { x.discountAmt = v; x.discountPct = 0; } x.coupon = ""; return true; }
  if (T.closest("[data-xcoupon]")) {
    const r = await ask(`<p class="cq">Coupon code</p><input class="in" id="xcCode" autocapitalize="characters" placeholder="e.g. DIWALI10" style="margin-top:12px">`, [{ label: "Cancel", cls: "btn-ghost", value: null }, ...(x.coupon ? [{ label: "Remove coupon", cls: "btn-ghost", value: "off" }] : []), { label: "Apply", cls: "btn-primary", value: true }], true);
    if (!r) return true; if (r === "off") { x.coupon = ""; x.discountAmt = 0; x.discountPct = 0; return true; }
    const code = ((document.getElementById("xcCode") || {}).value || "").trim().toUpperCase(); const c = (M.config().coupons || []).find(k => String(k.code).toUpperCase() === code);
    if (!c) { toast(`No coupon “${code}”`); return true; } if (c.until && c.until < today()) { toast(`${c.code} ended on ${c.until}`); return true; }
    if (+c.min && itemsValue(x) < +c.min) { toast(`${c.code} needs a bill of ${rs(c.min)} or more`); return true; }
    x.coupon = c.code; if (c.kind === "amt") { x.discountAmt = +c.value; x.discountPct = 0; } else { x.discountPct = +c.value; x.discountAmt = 0; } toast(`${c.code} applied`); return true; }
  const ch = T.closest("[data-xcharge]"); if (ch) { const n = ch.dataset.xcharge; x.charges = x.charges || [];
    if (x.charges.some(c => c.name === n)) x.charges = x.charges.filter(c => c.name !== n);
    else { const o = chargeOpts().find(c => c.name === n); if (o) x.charges.push({ name: o.name, amount: +o.amount, taxPct: chargeTax() }); } return true; }
  if (T.closest("[data-xother]")) {
    const r = await ask(`<p class="cq">Another charge</p><input class="in" id="xoName" placeholder="e.g. Cake stand, late delivery" style="margin-top:12px"><input class="in" id="xoAmt" inputmode="decimal" placeholder="Amount ₹" style="margin-top:8px">`, [{ label: "Cancel", cls: "btn-ghost", value: null }, { label: "Add", cls: "btn-primary", value: true }], true);
    if (!r) return true; const name = ((document.getElementById("xoName") || {}).value || "").trim(); const amt = num((document.getElementById("xoAmt") || {}).value);
    if (!name || !(amt > 0)) { toast("Give the charge a name and an amount"); return true; }
    x.charges = [...(x.charges || []).filter(c => c.name !== name), { name, amount: amt, taxPct: chargeTax() }]; return true; }
  return false;
}
// A coupon's minimum is checked again when items change: below it, the coupon comes off.
export function recheckCoupon(x) { if (!x.coupon) return; const c = (M.config().coupons || []).find(k => String(k.code).toUpperCase() === x.coupon); if (!c || (+c.min && itemsValue(x) < +c.min)) { toast(`${x.coupon} removed: the bill is below its minimum`); x.coupon = ""; x.discountAmt = 0; x.discountPct = 0; } }
