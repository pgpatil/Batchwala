// GST tax invoices and counter receipts. An invoice number is given once, on first print, from a series per financial year
// and per device (INV-2627-PA-0007), so two devices never issue the same number even offline. Printing is plain HTML.
import * as M from "./model.js";
import * as R from "./roles.js";
import { H, saveOrder } from "./core.js";
import { printHtml } from "./plan.js";
import { esc, rs2, today, dLong } from "./util.js";

// Financial year April–March: 2026-27 for any date from 1 Apr 2026 to 31 Mar 2027.
export const fyOf = d => { const y = +d.slice(0, 4), m = +d.slice(5, 7); const s = m >= 4 ? y : y - 1; return `${String(s).slice(2)}${String(s + 1).slice(2)}`; };
export function nextInvoiceNo(d = today()) {
  const c = M.config(); const pre = (c.invoicePrefix || "INV").toUpperCase(); const fy = fyOf(d); const dev = R.numPrefix() || "X"; const head = `${pre}-${fy}-${dev}-`;
  const n = M.orders().map(o => String(o.invoiceNo || "")).filter(x => x.startsWith(head)).map(x => +x.slice(head.length) || 0);
  return head + String(Math.max(0, ...n) + 1).padStart(4, "0");
}
async function ensureInvoiceNo(o) { if (o.invoiceNo) return o; const x = { ...o, invoiceNo: nextInvoiceNo(o.date), invoiceAt: new Date().toISOString() }; await saveOrder(x); return M.orders().find(y => y.id === o.id) || x; }

// Rupees in words, Indian style (lakh, crore), for the invoice total.
const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
const two = n => n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? " " + ONES[n % 10] : "");
const three = n => (n >= 100 ? ONES[Math.floor(n / 100)] + " Hundred" + (n % 100 ? " " : "") : "") + (n % 100 ? two(n % 100) : "");
export function words(n) { n = Math.round(n); if (!n) return "Zero"; const parts = []; const cr = Math.floor(n / 1e7), lk = Math.floor(n / 1e5) % 100, th = Math.floor(n / 1000) % 100, rest = n % 1000;
  if (cr) parts.push(three(cr) + " Crore"); if (lk) parts.push(two(lk) + " Lakh"); if (th) parts.push(two(th) + " Thousand"); if (rest) parts.push(three(rest)); return parts.join(" "); }

// Lines with taxable value and tax per line, after the order's offer %.
function lines(o) { const f = 1 - M.discF(o); const menu = M.menu(); const t = M.taxCfg();
  return o.items.map(i => { const m = (i.menuId && menu.find(x => x.id === i.menuId)) || M.menuByName(i.item) || {}; const r = +i.taxPct || 0; const gross = i.qty * i.rate * f;
    const taxable = o.taxIncl ? gross / (1 + r / 100) : gross; const tax = taxable * r / 100;
    return { ...i, hsn: m.hsn || M.config().hsn || "", rate: r, taxable, tax, half: t.split ? tax / 2 : 0, amount: taxable + tax, price: i.rate }; })
    // Delivery and packing charges are lines of their own, taxed at their own rate.
    .concat((o.charges || []).map(c => { const r = +c.taxPct || 0; const taxable = o.taxIncl ? c.amount / (1 + r / 100) : c.amount; const tax = taxable * r / 100;
      return { item: c.name, qty: 1, hsn: M.config().sac || "", rate: r, taxable, tax, half: t.split ? tax / 2 : 0, amount: taxable + tax, price: c.amount }; })); }

function invoiceHtml(o) {
  const c = M.config(); const t = M.taxCfg(); const L = lines(o); const taxable = L.reduce((s, l) => s + l.taxable, 0), tax = L.reduce((s, l) => s + l.tax, 0); const total = M.total(o);
  const ro = Math.round((total - taxable - tax) * 100) / 100; const paid = M.received(o); const gst = !!t.gstin && t.on;
  return `<div class="inv"><div class="inv-head"><div><h2>${esc(c.business)}</h2>${c.address ? `<div>${esc(c.address).replace(/\n/g, "<br>")}</div>` : ""}${c.phone ? `<div>Phone ${esc(c.phone)}</div>` : ""}${gst ? `<div>${esc(t.name)}IN <b>${esc(t.gstin)}</b>${c.state ? ` · State ${esc(c.state)}` : ""}</div>` : ""}</div>
    <div class="inv-meta"><h3>${gst ? "TAX INVOICE" : "INVOICE"}</h3><div>No. <b>${esc(o.invoiceNo)}</b></div><div>Date ${esc(dLong(o.date))}</div><div>Order #${esc(o.no)}</div>${o.status === "cancelled" ? `<div class="inv-void">CANCELLED</div>` : ""}</div></div>
    <div class="inv-to"><small>Bill to</small><b>${esc(o.customer || "Walk-in customer")}</b>${o.flat ? ` · ${esc(o.flat)}` : ""}${o.phone ? ` · ${esc(o.phone)}` : ""}${o.gstin ? `<div>${esc(t.name)}IN ${esc(o.gstin)}</div>` : ""}</div>
    <table class="inv-t"><thead><tr><th>#</th><th>Item</th>${gst ? "<th>HSN</th>" : ""}<th class="num">Qty</th><th class="num">Rate</th><th class="num">Taxable</th>${gst ? (t.split ? `<th class="num">CGST</th><th class="num">SGST</th>` : `<th class="num">${esc(t.name)}</th>`) : ""}<th class="num">Amount</th></tr></thead>
    <tbody>${L.map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.item)}</td>${gst ? `<td>${esc(l.hsn)}</td>` : ""}<td class="num">${l.qty}</td><td class="num">${rs2(l.price)}</td><td class="num">${rs2(l.taxable)}</td>${gst ? (t.split ? `<td class="num">${rs2(l.half)}<small> @${l.rate / 2}%</small></td><td class="num">${rs2(l.half)}<small> @${l.rate / 2}%</small></td>` : `<td class="num">${rs2(l.tax)}<small> @${l.rate}%</small></td>`) : ""}<td class="num">${rs2(l.amount)}</td></tr>`).join("")}</tbody></table>
    <div class="inv-tot"><div><span>Taxable value${M.disc(o) ? ` (after ${esc(M.offerText(o).replace(/^\w/, ch => ch.toLowerCase()))} ${rs2(M.disc(o))})` : ""}</span><b>${rs2(taxable)}</b></div>${gst ? (t.split ? `<div><span>CGST</span><b>${rs2(tax / 2)}</b></div><div><span>SGST</span><b>${rs2(tax / 2)}</b></div>` : `<div><span>${esc(t.name)}</span><b>${rs2(tax)}</b></div>`) : ""}${Math.abs(ro) >= 0.01 ? `<div><span>Round off</span><b>${ro > 0 ? "+" : "−"}${rs2(Math.abs(ro))}</b></div>` : ""}
      <div class="grand"><span>Total</span><b>${rs2(total)}</b></div><div class="inv-words">Rupees ${words(total)} only</div>${paid ? `<div><span>Paid</span><b>${rs2(paid)}</b></div>${total - paid > 0.5 ? `<div><span>Balance due</span><b>${rs2(total - paid)}</b></div>` : ""}` : ""}</div>
    <div class="inv-foot">${c.upi && total - paid > 0.5 ? `Pay by UPI: ${esc(c.upi)} · ` : ""}Thank you!${gst ? " This is a computer-generated invoice." : ""}</div></div>`;
}
// Narrow receipt for 58 / 80 mm counter printers.
function receiptHtml(o) {
  const c = M.config(); const L = lines(o); const total = M.total(o); const paid = M.received(o); const modes = [...new Set(M.paymentsFor(o.id).filter(p => p.amount > 0).map(p => p.mode).filter(Boolean))];
  return `<div class="rcpt"><b class="rc-biz">${esc(c.business)}</b>${c.address ? `<div>${esc(c.address.split("\n")[0])}</div>` : ""}${M.taxCfg().on && M.taxCfg().gstin ? `<div>${esc(M.taxCfg().name)}IN ${esc(M.taxCfg().gstin)}</div>` : ""}
    <div class="rc-line">${esc(o.invoiceNo || "#" + o.no)} · ${esc(new Date(o.createdAt || o._at || Date.now()).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }))}${o.table ? ` · Table ${esc(o.table)}` : ""}</div>
    ${L.map(l => `<div class="rc-row"><span>${esc(l.item)} × ${l.qty}</span><span>${rs2(l.price * l.qty)}</span></div>`).join("")}
    ${M.disc(o) ? `<div class="rc-row"><span>${esc(M.offerText(o))}</span><span>−${rs2(M.disc(o))}</span></div>` : ""}${M.taxLines(o).map(([n, v]) => `<div class="rc-row"><span>${esc(n)}</span><span>${rs2(v)}</span></div>`).join("")}
    <div class="rc-row rc-tot"><span>Total</span><span>${rs2(total)}</span></div>${paid ? `<div class="rc-row"><span>Paid${modes.length ? " · " + esc(modes.join(", ")) : ""}</span><span>${rs2(paid)}</span></div>` : ""}<div class="rc-thanks">Thank you! Visit again 💛</div></div>`;
}
export async function printInvoice(id) { let o = M.orders().find(x => x.id === id); if (!o) return; o = await ensureInvoiceNo(o); printHtml(`Invoice ${o.invoiceNo}`, invoiceHtml(o), true); }
export function printReceipt(id) { const o = M.orders().find(x => x.id === id); if (!o) return; printHtml(`Receipt ${o.no}`, receiptHtml(o), true); }
H.click.push(async T => {
  const i = T.closest("[data-invoice]"); if (i) { await printInvoice(i.dataset.invoice); return true; }
  const r = T.closest("[data-receipt]"); if (r) { printReceipt(r.dataset.receipt); return true; }
  return false;
});
H.printReceipt = printReceipt; H.words = words;
