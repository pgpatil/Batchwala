// Reads a WhatsApp order message into a draft order. Pure function: no storage, easy to test.
const WORDNUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, dozen: 12,
  ek: 1, teen: 3, char: 4, chaar: 4, paanch: 5, panch: 5, chhe: 6, che: 6, saat: 7, aath: 8, nau: 9, das: 10 };
const STOP = new Set(("hi hello hey hii helo please pls plz kindly thanks thank thankyou thx ty order orders want wanted need needed send sending deliver delivery " +
  "for me i we would like the a an of to can could you your my our ma am mam maam madam sir didi bhabhi bhaiya bhai aunty ji ok okay good morning evening night " +
  "and also with is are will be by at on in it this that same as usual piece pieces pc pcs nos no qty quantity flat wing tower building block " +
  "here there aaj kal today tomorrow tmrw tmr parso day after book booking put add mujhe hume chahiye dena dijiye bhej bhejna bhejiye na hai hain ho").split(" "));
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const iso = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const norm = s => " " + String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim() + " ";
const sing = w => w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w;

export function parseOrderMessage(text, { menu = [], customers = [], todayISO }) {
  const base = new Date((todayISO || iso(new Date())) + "T00:00:00");
  let body = String(text || "");
  const out = { sender: "", customer: "", customerKey: "", flat: "", phone: "", date: "", dateWords: "", items: [], unmatched: [] };

  // WhatsApp copy prefix: "[17/10/26, 9:15 am] Harmeen A1301: ..." or "17/10/26, 9:15 am - Harmeen: ..."
  body = body.replace(/^\s*\[?\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4},?\s+\d{1,2}[:.]\d{2}(?:[:.]\d{2})?\s*(?:[ap]\.?\s?m\.?)?\]?\s*[-–]?\s*([^:\n]{1,40}):\s*/gim, (m, who) => { if (!out.sender) out.sender = who.trim(); return ""; });

  // phone
  body = body.replace(/(?:\+?91[\s-]?)?\b([6-9]\d{4})[\s-]?(\d{5})\b/, (m, a, b) => { out.phone = a + b; return " "; });
  // flat: wing letter + number, or "flat 1301"
  const fm = /\b([A-Za-z])\s*[-\/]?\s*(\d{3,4})\b/.exec(body) || /\bflat\s*(?:no\.?)?\s*(\d{2,4})\b/i.exec(body);
  if (fm) { out.flat = fm.length === 3 ? `${fm[1].toUpperCase()}-${fm[2]}` : fm[1]; body = body.replace(fm[0], " "); }
  if (!out.flat && out.sender) { const sm = /\b([A-Za-z])\s*[-\/]?\s*(\d{3,4})\b/.exec(out.sender); if (sm) { out.flat = `${sm[1].toUpperCase()}-${sm[2]}`; out.sender = out.sender.replace(sm[0], "").trim(); } }

  // date
  const setDate = (d, words) => { if (!out.date) { out.date = iso(d); out.dateWords = words; } };
  const plus = n => { const d = new Date(base); d.setDate(d.getDate() + n); return d; };
  body = body.replace(/\b(day after tomorrow|parso)\b/i, m => { setDate(plus(2), m); return " "; });
  body = body.replace(/\b(tomorrow|tmrw|tmr|kal)\b/i, m => { setDate(plus(1), m); return " "; });
  body = body.replace(/\b(today|aaj|tonight)\b/i, m => { setDate(plus(0), m); return " "; });
  // dd/mm or dd.mm, but not a time ("7.30 pm") or a weight ("1.5 kg"), and only a real day of a real month.
  body = body.replace(/\b(\d{1,2})[\/.](\d{1,2})(?:[\/.](\d{2,4}))?\b(?!\s*(?:am|pm|a\.m|p\.m|kg|kgs|g|gm|gms|ml|l|ltr|litre|hrs?|o'?clock)\b)/i, (m, d, mo) => {
    if (+mo < 1 || +mo > 12 || +d < 1) return m; const x = new Date(base.getFullYear(), +mo - 1, +d); if (x.getMonth() !== +mo - 1) return m;
    if (x < plus(-1)) x.setFullYear(x.getFullYear() + 1); setDate(x, m); return " "; });
  body = body.replace(/\b(\d{1,2})\s*(?:st|nd|rd|th)?\s*(?:of\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i, (m, d, mo) => { const x = new Date(base.getFullYear(), MONTHS.indexOf(mo.toLowerCase().slice(0, 3)), +d); if (x < plus(-1)) x.setFullYear(x.getFullYear() + 1); setDate(x, m); return " "; });
  body = body.replace(/\b(\d{1,2})\s*(st|nd|rd|th)\b/i, (m, d) => { const x = new Date(base.getFullYear(), base.getMonth(), +d); if (x < plus(-1)) x.setMonth(x.getMonth() + 1); setDate(x, m); return " "; });
  // A weekday needs "on / this / next" before a short form, or the full name, so "sun dried tomato" stays an item.
  body = body.replace(/\b(?:(?:on|this|next)\s+(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|nesday|rsday|urday)?|(sun|mon|tues|wednes|thurs|fri|satur)day)\b/i, (m, d1, d2) => { const d = d1 || d2; const t = DAYS.indexOf(d.toLowerCase().slice(0, 3)); let n = (t - base.getDay() + 7) % 7; if (n === 0) n = 7; setDate(plus(n), m); return " "; });

  // items
  const keys = [];
  menu.forEach(m => {
    const words = [m.name, ...(String(m.aliases || "").split(","))].map(s => norm(s).trim()).filter(Boolean);
    words.forEach(w => keys.push({ m, key: " " + w + " " }));
    words.forEach(w => { const s = w.split(" ").map(sing).join(" "); if (s !== w) keys.push({ m, key: " " + s + " " }); });
  });
  keys.sort((a, b) => b.key.length - a.key.length);
  const segs = body.split(/\n|,|;|\+|\band\b|&|\.(?!\d)/i).map(s => s.trim()).filter(Boolean);
  const found = new Map();
  segs.forEach(seg => {
    let s = norm(seg).replace(/\bhalf dozen\b/g, "6");
    const tk = s.trim().split(" "); const startsItem = i => keys.some(k => (" " + tk.slice(i).map(sing).join(" ") + " ").startsWith(k.key));
    s = " " + tk.map((w, i) => w === "do" ? (startsItem(i + 1) ? "2" : w) : w !== "dozen" && WORDNUM[w] != null ? String(WORDNUM[w]) : w).join(" ") + " ";
    s = s.replace(/\b(\d{1,2}) dozen\b/g, (m, n) => String(n * 12)).replace(/\bdozen\b/g, "12");
    const s2 = " " + s.trim().split(" ").map(sing).join(" ") + " ";
    let rest = s2; const hits = [];
    for (const k of keys) { const at = rest.indexOf(k.key); if (at >= 0) { rest = rest.slice(0, at) + " " + "#".repeat(k.key.length - 2) + " " + rest.slice(at + k.key.length); if (!hits.some(h => h.m.id === k.m.id)) hits.push({ ...k, at }); } }
    hits.sort((a, b) => a.at - b.at);   // quantities pair with items in the order they appear
    if (hits.length) {
      const nums = (s.match(/\b\d{1,3}(?:\.\d+)?\b/g) || []).map(Number).filter(n => Number.isInteger(n));
      hits.forEach((h, i) => { const q = hits.length === 1 ? (nums[0] || 1) : (nums[i] || 1); const cur = found.get(h.m.id); found.set(h.m.id, { menuId: h.m.id, item: h.m.name, rate: +h.m.price || 0, qty: (cur ? cur.qty : 0) + q }); });
    } else {
      const words = s.trim().split(" ").filter(w => w && !STOP.has(w) && !/^\d+$/.test(w) && w.length > 1);
      if (words.length) out.unmatched.push({ text: seg.trim(), qty: (s.match(/\b\d{1,3}\b/) || [1])[0] * 1 });
    }
  });
  out.items = [...found.values()];

  // customer
  const byFlat = out.flat ? customers.filter(c => (c.flat || "").toUpperCase().replace(/\s/g, "") === out.flat.toUpperCase()) : [];
  const nameKey = n => norm(n).trim().split(" ")[0];
  let match = null;
  if (byFlat.length === 1) match = byFlat[0];
  else if (byFlat.length > 1 && out.sender) match = byFlat.find(c => nameKey(c.customer) === nameKey(out.sender)) || byFlat[0];
  else if (out.sender) match = customers.find(c => nameKey(c.customer) === nameKey(out.sender) && nameKey(out.sender).length > 2) || null;
  if (!match && out.phone) match = customers.find(c => String(c.phone || "").replace(/\D/g, "").slice(-10) === out.phone) || null;
  if (match) { out.customer = match.customer; out.customerKey = match.key; out.flat = out.flat || match.flat; out.phone = out.phone || match.phone || ""; }
  else out.customer = out.sender;
  const nameWords = new Set(norm(out.customer + " " + out.sender).trim().split(" ").filter(Boolean));
  out.unmatched = out.unmatched.filter(u => norm(u.text).trim().split(" ").some(w => w && !STOP.has(w) && !nameWords.has(w) && !/^\d+$/.test(w) && w.length > 1));
  return out;
}
