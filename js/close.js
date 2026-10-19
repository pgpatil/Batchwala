// Day close: each person counts the money they took in on a day and compares it with what the app recorded for them.
// Expected cash = opening float + cash received − cash refunded − cash paid to suppliers − other cash paid out.
import * as ev from "./events.js";
import * as sync from "./sync.js";
import * as M from "./model.js";
import * as R from "./roles.js";
import { asLines, layoutSwitch } from "./table.js";
import { S, V, H, band } from "./core.js";
import { printHtml } from "./plan.js";
import { $, esc, rs, rs2, num, today, addDays, dLong, ICON, copyText, waHref } from "./util.js";
import { toast, yesNo } from "./ui.js";

const MODES = ["Cash", "UPI", "Card", "Bank"];
const modeOf = m => { const x = String(m || "").toLowerCase(); return x.startsWith("cash") ? "Cash" : x.startsWith("upi") ? "UPI" : x.startsWith("card") ? "Card" : x.startsWith("bank") || x.startsWith("cheque") ? "Bank" : "Other"; };
const r2 = v => Math.round(v * 100) / 100;
const canSeeAll = () => R.isAdmin() || R.role() === "management" || R.role() === "manager";
export const closeId = (d, who) => `${d}@${who}`;

// What the app recorded for one person on one day, by mode.
export function dayTotals(d, who) {
  const got = Object.fromEntries([...MODES, "Other"].map(m => [m, 0])); const refunds = { ...got }; const out = { ...got };
  ev.all("payments").filter(p => p.date === d && p._by === who && p.mode !== "Credit").forEach(p => { const m = modeOf(p.mode); if (p.amount >= 0) got[m] += +p.amount; else refunds[m] += -p.amount; });
  // Only cash paid to suppliers leaves the drawer; a payment and its reversal cancel out.
  const sp = M.spays(); const rev = new Set(sp.filter(p => p.revOf).map(p => p.revOf));
  sp.filter(p => p.date === d && p._by === who && !p.revOf && !rev.has(p.id) && modeOf(p.mode) === "Cash").forEach(p => { out.Cash += +p.amount || 0; });
  return { got, refunds, out };
}

V.close = () => {
  const d = S.closeDate || today(); const me = R.me(); const who = canSeeAll() ? (S.closeWho || me.id) : me.id; const t = today();
  const people = canSeeAll() ? R.members().filter(m => ["admin", "management", "manager", "counter", "delivery"].includes(m.role)) : [me];
  const saved = ev.get("closes", closeId(d, who)); const tot = dayTotals(d, who); const c = S.closeDraft && S.closeDraft.id === closeId(d, who) ? S.closeDraft : { id: closeId(d, who), opening: saved ? saved.opening : 0, counted: saved ? { ...saved.counted } : {}, paidOut: saved ? saved.paidOut : 0, note: saved ? saved.note : "" };
  S.closeDraft = c;
  const expected = m => r2((m === "Cash" ? (+c.opening || 0) - (+c.paidOut || 0) : 0) + tot.got[m] - tot.refunds[m] - tot.out[m]);
  const diff = m => c.counted[m] === "" || c.counted[m] == null ? null : r2(+c.counted[m] - expected(m));
  const name = id => (ev.get("members", id) || {}).name || "?";
  let h = band("Day close", "", `<div class="stats"><div class="st"><b>${rs(MODES.reduce((s, m) => s + tot.got[m] - tot.refunds[m], 0) + tot.got.Other - tot.refunds.Other)}</b><span>taken in by ${esc(name(who))}</span></div><div class="st"><b>${rs(expected("Cash"))}</b><span>cash expected in hand</span></div>${diff("Cash") != null ? `<div class="st"><b class="${diff("Cash") < 0 ? "due" : ""}">${diff("Cash") > 0 ? "+" : ""}${rs2(diff("Cash"))}</b><span>cash difference</span></div>` : ""}</div>`);
  h += `<div class="tools"><div class="chips">${[t, addDays(t, -1)].map((x, i) => `<button class="chip" data-closedate="${x}" aria-pressed="${d === x}">${["Today", "Yesterday"][i]}</button>`).join("")}<label class="chip datechip">${[t, addDays(t, -1)].includes(d) ? "Other date" : esc(dLong(d))}<input type="date" data-closedatein value="${esc(d)}"></label></div>
    ${people.length > 1 ? `<div class="chips">${people.map(p => `<button class="chip" data-closewho="${esc(p.id)}" aria-pressed="${p.id === who}">${esc(p.name)}</button>`).join("")}</div>` : ""}</div>`;
  if (saved) h += `<div class="boardfoot" style="padding-bottom:0"><div class="banner ${Object.values(saved.diff || {}).some(v => Math.abs(v) >= 1) ? "warn" : "ok"}">Closed by ${esc(name(saved._by))} at ${esc(new Date(saved._at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }))}${R.isAdmin() ? " · the admin can correct it" : ""}</div></div>`;
  const edit = !saved || R.isAdmin();
  h += `<div class="plan"><div class="card"><h3>Count for ${esc(dLong(d))} · ${esc(name(who))}</h3><table><thead><tr><th>Mode</th><th>Received</th><th>Refunded / paid out</th><th>Expected</th><th>Counted</th><th>Difference</th></tr></thead><tbody>
    ${MODES.map(m => `<tr><td><b>${m}</b></td><td>${rs2(tot.got[m])}</td><td>${tot.refunds[m] + tot.out[m] ? rs2(tot.refunds[m] + tot.out[m]) : "–"}</td><td><b>${rs2(expected(m))}</b>${m === "Cash" ? `<small class="mut" style="display:block">incl. opening ${rs(+c.opening || 0)}${c.paidOut ? `, −${rs(c.paidOut)} paid out` : ""}</small>` : ""}</td>
      <td>${edit ? `<input class="rate" data-count="${m}" inputmode="decimal" value="${c.counted[m] ?? ""}" placeholder="${m === "Cash" ? "count" : "optional"}">` : rs2(+c.counted[m] || 0)}</td><td>${diff(m) == null ? "–" : `<b class="${diff(m) < 0 ? "due" : ""}">${diff(m) > 0 ? "+" : ""}${rs2(diff(m))}</b>`}</td></tr>`).join("")}
    ${tot.got.Other ? `<tr><td>Other</td><td>${rs2(tot.got.Other)}</td><td colspan="4"></td></tr>` : ""}</tbody></table>
    ${edit ? `<div class="two" style="padding:10px 14px 0"><div><label class="f" for="clOpen">Opening cash (float)</label><input class="in" id="clOpen" data-closefield="opening" inputmode="decimal" value="${c.opening || ""}" placeholder="0"></div><div><label class="f" for="clOut">Other cash paid out</label><input class="in" id="clOut" data-closefield="paidOut" inputmode="decimal" value="${c.paidOut || ""}" placeholder="0"></div></div>
      <div style="padding:0 14px 12px"><label class="f" for="clNote">Note</label><input class="in" id="clNote" data-closefield="note" value="${esc(c.note || "")}" placeholder="e.g. ₹200 for milk, short ₹50 explained"></div>` : (saved.note ? `<p class="hint">${esc(saved.note)}</p>` : "")}</div></div>
  <div class="boardfoot">${edit ? `<button class="btn btn-primary" data-closesave>${ICON.check}${saved ? "Update the close" : "Close the day"}</button>` : ""}<div class="btnrow"><button class="btn btn-ghost" data-closeprint>${ICON.print}Print</button><button class="btn btn-ghost" data-closecopy>Copy summary</button></div>
  <p class="hint">Received counts the payments this person recorded that day (orders, counter, advances), by mode. Supplier payments they made in cash come off the cash.</p></div>`;
  const list = ev.all("closes").filter(x => canSeeAll() || x.who === me.id).sort((a, b) => (b.date + b.who).localeCompare(a.date + a.who)).slice(0, 60);
  if (list.length) h += `<div class="tools" style="padding-top:12px">${layoutSwitch("close")}</div>` + (asLines("close") ? `<div class="card tablecard"><table class="reg"><thead><tr><th>Date</th><th>Person</th><th class="r">Cash expected</th><th class="r">Cash counted</th><th class="r">Difference</th><th>Note</th></tr></thead><tbody>${list.map(x => `<tr data-closeopen="${esc(x.id)}" tabindex="0"><td data-v="${esc(x.date)}">${esc(dLong(x.date))}</td><td>${esc(name(x.who))}</td><td class="r">${rs2(x.expected.Cash || 0)}</td><td class="r">${rs2(x.counted.Cash || 0)}</td><td class="r" data-v="${(x.diff || {}).Cash || 0}">${Math.abs((x.diff || {}).Cash || 0) >= 1 ? `<b class="${x.diff.Cash < 0 ? "due" : ""}">${x.diff.Cash > 0 ? "+" : ""}${rs2(x.diff.Cash)}</b>` : "–"}</td><td class="items">${esc(x.note || "")}</td></tr>`).join("")}</tbody></table></div>`
    : `<ul class="list">${list.map(x => `<li class="row"><button class="who" data-closeopen="${esc(x.id)}"><div class="nm">${esc(dLong(x.date))} · ${esc(name(x.who))}</div><div class="subl">cash ${rs2(x.counted.Cash || 0)} counted of ${rs2(x.expected.Cash || 0)}${Math.abs((x.diff || {}).Cash || 0) >= 1 ? ` · <b class="${x.diff.Cash < 0 ? "due" : ""}">${x.diff.Cash > 0 ? "+" : ""}${rs2(x.diff.Cash)}</b>` : ""}</div></button></li>`).join("")}</ul>`);
  return h;
};
function summary(d, who) { const x = ev.get("closes", closeId(d, who)); if (!x) return ""; const name = (ev.get("members", who) || {}).name || "";
  return `🧾 ${M.config().business} day close · ${dLong(d)} · ${name}\n` + MODES.map(m => `${m}: expected ${rs2(x.expected[m] || 0)}${x.counted[m] != null && x.counted[m] !== "" ? `, counted ${rs2(+x.counted[m])} (${(x.diff[m] || 0) >= 0 ? "+" : ""}${rs2(x.diff[m] || 0)})` : ""}`).join("\n") + (x.note ? `\nNote: ${x.note}` : ""); }
H.click.push(async T => {
  if (S.view !== "close") return false; const d = S.closeDate || today(); const who = canSeeAll() ? (S.closeWho || R.me().id) : R.me().id;
  const cd = T.closest("[data-closedate]"); if (cd) { S.closeDate = cd.dataset.closedate; S.closeDraft = null; H.render(); return true; }
  const cw = T.closest("[data-closewho]"); if (cw) { S.closeWho = cw.dataset.closewho; S.closeDraft = null; H.render(); return true; }
  const co = T.closest("[data-closeopen]"); if (co) { const [dd, ww] = co.dataset.closeopen.split("@"); S.closeDate = dd; S.closeWho = ww; S.closeDraft = null; H.render(); window.scrollTo({ top: 0 }); return true; }
  if (T.closest("[data-closecopy]")) { toast(await copyText(summary(d, who) || "Not closed yet") ? "Copied" : "Couldn’t copy here"); return true; }
  if (T.closest("[data-closeprint]")) { printHtml(`Day close · ${dLong(d)}`, document.querySelector("#main .plan").outerHTML); return true; }
  if (T.closest("[data-closesave]")) { const c = S.closeDraft; const tot = dayTotals(d, who);
    const expected = Object.fromEntries(MODES.map(m => [m, r2((m === "Cash" ? (+c.opening || 0) - (+c.paidOut || 0) : 0) + tot.got[m] - tot.refunds[m] - tot.out[m])]));
    if (c.counted.Cash === "" || c.counted.Cash == null) { toast("Count the cash first"); return true; }
    const diff = Object.fromEntries(MODES.filter(m => c.counted[m] !== "" && c.counted[m] != null).map(m => [m, r2(+c.counted[m] - expected[m])]));
    const big = Object.entries(diff).filter(([, v]) => Math.abs(v) >= 1);
    if (big.length && !c.note && !await yesNo(`<p class="cq">Close with a difference?</p><div class="cdetail">${big.map(([m, v]) => `${m}: ${v > 0 ? "+" : ""}${rs2(v)}`).join("<br>")}<br><br>Add a note saying why, or close anyway.</div>`, "Close anyway")) return true;
    await ev.put("closes", { id: closeId(d, who), date: d, who, opening: +c.opening || 0, paidOut: +c.paidOut || 0, counted: Object.fromEntries(Object.entries(c.counted).filter(([, v]) => v !== "")), expected, diff, received: tot.got, note: c.note || "" });
    sync.soon(); S.closeDraft = null; toast("Day closed"); return true; }
  return false;
});
H.input.push(T => {
  if (S.view !== "close" || !S.closeDraft) return false; const c = S.closeDraft;
  if (T.dataset.count) { c.counted[T.dataset.count] = T.value.trim() === "" ? "" : num(T.value); if (!/[.,]$/.test(T.value)) H.render(); return true; }
  if (T.dataset.closefield) { const k = T.dataset.closefield; c[k] = k === "note" ? T.value : num(T.value); if (k !== "note" && !/[.,]$/.test(T.value)) H.render(); return true; }
  return false;
});
H.change.push(T => { if (S.view !== "close" || !T.matches("[data-closedatein]")) return false; if (T.value) { S.closeDate = T.value; S.closeDraft = null; H.render(); } return true; });
