// Shared helpers: formatting, dates, escaping, icons.
export const $ = s => document.querySelector(s);
export const $$ = s => [...document.querySelectorAll(s)];
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const rs = n => "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN");
export const rs2 = n => "₹" + (Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
export const num = v => +String(v ?? "").replace(/[^\d.\-]/g, "") || 0;
export const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
export const iso = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
export const today = () => iso(new Date());
export const addDays = (s, n) => { const d = new Date(s + "T00:00:00"); d.setDate(d.getDate() + n); return iso(d); };
export const dObj = s => new Date(s + "T00:00:00");
export function dLabel(s) {
  if (!s) return ""; const t = today();
  if (s === t) return "Today"; if (s === addDays(t, 1)) return "Tomorrow"; if (s === addDays(t, -1)) return "Yesterday";
  const x = dObj(s); return isNaN(x) ? s : x.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}
export const dLong = s => { const x = dObj(s); return isNaN(x) ? s : x.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" }); };

// Quantities are stored in base units (g, ml, pcs).
export const UNITS = { g: { big: "kg", f: 1000 }, ml: { big: "L", f: 1000 }, pcs: null };
export function qty(n, unit) {
  const u = UNITS[unit]; const v = Number(n) || 0;
  if (u && Math.abs(v) >= u.f) return (+(v / u.f).toFixed(2)).toLocaleString("en-IN") + " " + u.big;
  return (+v.toFixed(unit === "pcs" ? 0 : 1)).toLocaleString("en-IN") + " " + unit;
}

export function flatKey(f) { const m = /^\s*([A-Za-z])\s*-?\s*(\d+)/.exec(f || ""); return m ? [0, m[1].toUpperCase(), +m[2]] : [1, (f || "").toUpperCase(), 0]; }
export function cmpFlat(a, b) { const x = flatKey(a.flat), y = flatKey(b.flat); for (let i = 0; i < 3; i++) { if (x[i] < y[i]) return -1; if (x[i] > y[i]) return 1; } return (a.customer || "").localeCompare(b.customer || ""); }
export function plate(f) {
  const m = /^\s*([A-Za-z])\s*-?\s*(\d+)/.exec(f || "");
  if (!m) return `<div class="plate none"><b>&nbsp;</b><span>${esc(f || "No flat")}</span></div>`;
  const w = m[1].toUpperCase(); return `<div class="plate ${w === "A" || w === "B" ? w : ""}"><b>${esc(w)}</b><span>${esc(m[2])}</span></div>`;
}
export async function copyText(t) {
  try { await navigator.clipboard.writeText(t); return true; } catch (_) {
    const a = document.createElement("textarea"); a.value = t; document.body.appendChild(a); a.select();
    let ok = false; try { ok = document.execCommand("copy"); } catch (_) {} a.remove(); return ok;
  }
}
export function waHref(phone, text) {
  let d = String(phone || "").replace(/\D/g, ""); if (d.length === 10) d = "91" + d; if (d.length === 11 && d[0] === "0") d = "91" + d.slice(1);
  return "https://wa.me/" + d + "?text=" + encodeURIComponent(text);
}
const s = p => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
export const ICON = {
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg>`,
  plus: s('<path d="M12 5v14M5 12h14"/>'),
  today: s('<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
  orders: s('<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>'),
  pay: s('<rect x="2" y="6" width="20" height="13" rx="3"/><path d="M2 10h20M6 15h4"/>'),
  stock: s('<path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 7v10l9 4 9-4V7M12 11v10"/>'),
  more: s('<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>'),
  menu: s('<path d="M4 11h16a8 8 0 0 1-16 0zM8 7c0-2 2-2 2-4M12 7c0-2 2-2 2-4"/>'),
  people: s('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>'),
  chart: s('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  gear: s('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>'),
  dl: s('<path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14"/>'),
  cloud: s('<path d="M7 18a5 5 0 0 1-.6-9.96A7 7 0 0 1 20 10a4 4 0 0 1-1 7.9"/><path d="M12 13v8m-3-3l3 3 3-3"/>'),
  cart: s('<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.7 12.2a2 2 0 0 0 2 1.6h7.6a2 2 0 0 0 2-1.6L21 7H6"/>'),
  oven: s('<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 8h18M7 5.5h.01M11 5.5h.01"/><rect x="7" y="11" width="10" height="7" rx="1"/>'),
  run: s('<path d="M5 17h2l1-3 4-2 3 3h4"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/><path d="M12 12l-2-5h4l2 3"/>'),
  back: s('<path d="M15 18l-6-6 6-6"/>'),
  backup: s('<path d="M4 4h16v6H4zM4 14h16v6H4z"/><path d="M8 7h.01M8 17h.01"/>'),
  wa: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm5.3 14.1c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.3-.7-2.8-1.1-4.5-3.9-4.7-4.1-.1-.2-1.1-1.5-1.1-2.8s.7-2 1-2.3c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.4 0 .5l-.3.5-.4.4c-.1.2-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.1 1 2.1 1.3 2.4 1.5.3.1.5.1.6-.1l.9-1c.2-.3.4-.2.6-.1l1.9.9c.3.1.5.2.5.3.1.2.1.7-.1 1.3z"/></svg>`,
  chev: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 6l6 6-6 6"/></svg>`,
  down: s('<path d="M6 9l6 6 6-6"/>')
};
