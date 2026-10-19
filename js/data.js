// Import & export by data type: CSV export of what's in the app, a template per type, and import with a check screen before anything changes.
import * as ev from "./events.js";
import * as sync from "./sync.js";
import * as M from "./model.js";
import * as R from "./roles.js";
import { asLines, layoutSwitch } from "./table.js";
import { S, A, V, H, band, clean, saveOrder, addCredit } from "./core.js";
import { putMove } from "./inventory.js";
import { esc, uid, today, ICON } from "./util.js";
import { ui, toast, openSheet, closeSheet } from "./ui.js";
import { similar, byNameOrAka, norm } from "./match.js";
import { readText, claudeRead, getKey, setKey, isPdf } from "./ocr.js";

/* ---------- CSV ---------- */
// Spreadsheet apps run cells starting with = + - @ as formulas; text like that is prefixed with ' (numbers are left alone).
const cell = v => { let s = v == null ? "" : String(v); if (typeof v !== "number" && /^[=+\-@]/.test(s)) s = "'" + s; return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export function download(name, rows) {
  const blob = new Blob(["﻿" + rows.map(r => r.map(cell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function parseCSV(t) {
  t = t.replace(/^﻿/, ""); const rows = []; let row = [], f = "", q = false;
  for (let i = 0; i < t.length; i++) { const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true; else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && t[i + 1] === "\n") i++; row.push(f); rows.push(row); row = []; f = ""; }
    else f += c; }
  if (f || row.length) { row.push(f); rows.push(row); } return rows;
}
// Rows as objects keyed by column, with their line number; # lines and blank lines are skipped; the first other line is the header.
function toRecords(raw, cols) {
  const lines = raw.map((r, i) => ({ r: r.map(x => String(x ?? "").trim().replace(/^'(?=[=+\-@])/, "")), line: i + 1 })).filter(x => x.r.some(Boolean) && !x.r[0].startsWith("#"));
  if (!lines.length) return { error: "The file is empty." };
  const norm = s => s.toLowerCase().replace(/[^a-z0-9%]/g, ""); const head = lines[0].r.map(norm);
  const idx = Object.fromEntries(cols.map(c => [c.k, head.indexOf(norm(c.label))]));
  const missing = cols.filter(c => c.req && idx[c.k] < 0).map(c => c.label);
  if (missing.length) return { error: `Missing column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. Start from the template.` };
  return { recs: lines.slice(1).map(x => ({ line: x.line, ...Object.fromEntries(cols.map(c => [c.k, idx[c.k] >= 0 ? x.r[idx[c.k]] ?? "" : ""])) })) };
}
const numOr = (v, d = null) => { const s = String(v ?? "").replace(/[₹,\s]/g, ""); if (s === "") return d; const n = Number(s); return isFinite(n) ? n : NaN; };
const yes = v => /^(y|yes|true|1|on)$/i.test(String(v).trim());
const UNIT_IN = { g: ["g", 1], gm: ["g", 1], gram: ["g", 1], grams: ["g", 1], kg: ["g", 1000], ml: ["ml", 1], l: ["ml", 1000], ltr: ["ml", 1000], litre: ["ml", 1000], liter: ["ml", 1000], pcs: ["pcs", 1], pc: ["pcs", 1], piece: ["pcs", 1], pieces: ["pcs", 1], nos: ["pcs", 1] };
const unitIn = u => UNIT_IN[String(u || "").trim().toLowerCase()] || null;
const BIG = { g: ["kg", 1000], ml: ["L", 1000], pcs: ["pcs", 1] };
const r4 = v => Math.round(v * 10000) / 10000;
const byName = (list, n) => list.find(x => x.name.toLowerCase() === String(n).trim().toLowerCase());
const locByName = n => { const s = String(n || "").trim().toLowerCase(); return !s ? M.locations()[0] : M.locations().find(l => l.name.toLowerCase() === s || l.id === s); };
const TYPE_IN = { rm: "rm", raw: "rm", "raw material": "rm", pm: "pm", packing: "pm", "packing material": "pm", sf: "sf", semi: "sf", "semi-finished": "sf", "semi finished": "sf" };
const algIn = v => { const parts = String(v).split(",").map(x => x.trim()).filter(Boolean); const list = [], bad = []; parts.forEach(x => { const a = M.ALLERGENS.find(y => y.toLowerCase() === x.toLowerCase() || (x.toLowerCase().startsWith("nut") && y === "Tree nuts") || (/^(wheat|gluten)/i.test(x) && y === "Gluten") || (/^(dairy|milk)/i.test(x) && y === "Milk") || (/^eggs?$/i.test(x) && y === "Egg")); a ? list.push(a) : bad.push(x); }); return { list: [...new Set(list)], bad }; };
const memberName = id => (ev.get("members", id) || {}).name || "";

/* ---------- data types ---------- */
// cols: k = key, label = column header, req = required on import. notes: template guidance. ex: example row for the template (written as a # note).
const T = {
  menu: { label: "Menu items", icon: "menu", desc: "Prices, categories, short names, keep-ready levels, tax rate.",
    cols: [{ k: "name", label: "Name", req: true }, { k: "category", label: "Category" }, { k: "price", label: "Price" }, { k: "tax", label: "Tax %" }, { k: "par", label: "Keep ready" }, { k: "aliases", label: "Short names" }, { k: "active", label: "On sale" }, { k: "life", label: "Shelf life days" }, { k: "diet", label: "Food type" }, { k: "may", label: "May contain" }, { k: "net", label: "Net quantity" }, { k: "alg", label: "Allergens" }],
    notes: ["Matched by Name: existing items are updated, new ones added.", "Food type: Veg, Egg or Non-veg (for labels). Allergens: any the BOM doesn’t already bring in, comma separated. Tax % blank = the default rate. On sale: Yes or No (blank = Yes). Short names: comma separated, in quotes. Shelf life days blank = 30 for cookies, 3 for others."],
    ex: ["Paneer Strudel", "Savoury", 120, 5, 6, "strudel, ps", "Yes", 3, "Veg", "sesame", "1 pc", ""],
    count: () => M.menu().length,
    rows: () => M.menu().map(m => [m.name, m.category, m.price, m.taxPct ?? "", m.par || "", m.aliases, m.active !== false ? "Yes" : "No", m.shelfLife ?? "", { veg: "Veg", egg: "Egg", nonveg: "Non-veg" }[m.diet || "veg"], m.mayContain || "", m.netQty || "", M.allergensOf(m).join(", ")]),
    plan(recs, dec) { const out = newPlan(dec); const menu = M.menu(); const seen = new Set();
      recs.forEach(r => { let name = r.name.trim(); if (!name) return out.err(r, "Name is blank"); if (seen.has(name.toLowerCase())) return out.err(r, `${name} appears twice`); seen.add(name.toLowerCase());
        const price = numOr(r.price), tax = numOr(r.tax), par = numOr(r.par, 0), life = numOr(r.life); if ([price, tax, par, life].some(Number.isNaN)) return out.err(r, "Price, Tax %, Shelf life and Keep ready must be numbers");
        let ex = byName(menu, name); if (!ex) { const same = askSame(out, "menu item", name, menu); if (same === undefined) return; if (same !== "new") { ex = same; name = ex.name; } }
        if (!ex && price == null) return out.err(r, `${name} is new and needs a Price`);
        const rec = { ...(ex ? clean(ex) : { id: uid("m"), recipe: [], sort: menu.length + out.adds + 1 }), name, shelfLife: r.life === "" ? (ex ? ex.shelfLife ?? null : null) : Math.max(1, Math.round(life)), category: r.category || (ex ? ex.category : ""), price: price ?? ex.price, par: r.par === "" ? (ex ? ex.par || 0 : 0) : par,
          aliases: r.aliases || (ex ? ex.aliases : ""), active: r.active === "" ? (ex ? ex.active !== false : true) : yes(r.active), taxPct: r.tax === "" ? (ex ? ex.taxPct ?? null : null) : tax };
        if (r.diet) { const d = /^non/i.test(r.diet) ? "nonveg" : /egg/i.test(r.diet) ? "egg" : /^veg/i.test(r.diet) ? "veg" : null; if (!d) return out.err(r, "Food type must be Veg, Egg or Non-veg"); rec.diet = d; }
        if (r.may) rec.mayContain = r.may; if (r.net) rec.netQty = r.net;
        if (r.alg) { const al = algIn(r.alg); if (al.bad.length) return out.err(r, `Allergen “${al.bad[0]}” isn’t one of ${M.ALLERGENS.join(", ")}`); rec.allergens = al.list.filter(a => !M.allergensOf({ recipe: rec.recipe }).includes(a)); }
        out.upsert(ex, rec, name, () => ev.put("menu", rec)); });
      return out; } },
  materials: { label: "Materials", icon: "stock", desc: "Raw materials, packing and semi-finished: unit, reorder level, price, supplier, tax.",
    cols: [{ k: "name", label: "Name", req: true }, { k: "type", label: "Type" }, { k: "unit", label: "Unit" }, { k: "reorder", label: "Reorder level" }, { k: "price", label: "Price per unit" }, { k: "supplier", label: "Supplier" }, { k: "barcode", label: "Barcode" }, { k: "tax", label: "Tax %" }, { k: "taxcost", label: "Purchase tax in cost" }, { k: "yield", label: "Yield per run" }, { k: "category", label: "Category" }, { k: "alg", label: "Allergens" }],
    notes: ["Matched by Name. Type: RM, PM or Semi-finished (blank = RM). Unit: g, kg, ml, L or pcs; Reorder level, Price per unit and Yield per run are in that unit.", "Allergens: comma separated, in quotes (Gluten, Milk, Egg, Tree nuts, Peanut, Soy, Sesame, Mustard, Sulphites, Fish, Crustaceans). Price is used until a GRN or purchase is recorded. Purchase tax in cost: Yes = tax paid is added to cost; No = recoverable. Yield per run is for semi-finished items; give their recipe in the BOM import."],
    ex: ["Maida", "RM", "kg", 5, 45, "Sharma Traders", "", 5, "No", "", "Flour & grains", "Gluten"],
    count: () => M.ingredients().length,
    rows: () => M.ingredients().map(i => { const [u, f] = BIG[i.unit] || [i.unit, 1]; return [i.name, { rm: "RM", pm: "PM", sf: "Semi-finished" }[i.type], u, i.reorder ? r4(i.reorder / f) : "", r4(M.unitCost(i) * f) || "", i.supplier, i.barcode, i.taxPct ?? "", i.taxInCost ? "Yes" : "No", i.type === "sf" && i.yield ? r4(i.yield / f) : "", i.category || "", (i.allergens || []).join(", ")]; }),
    plan(recs, dec) { const out = newPlan(dec); const ings = M.ingredients(); const seen = new Set();
      recs.forEach(r => { let name = r.name.trim(); if (!name) return out.err(r, "Name is blank"); if (seen.has(name.toLowerCase())) return out.err(r, `${name} appears twice`); seen.add(name.toLowerCase());
        let ex = byNameOrAka(ings, name); if (!ex) { const same = askSame(out, "material", name, ings); if (same === undefined) return; if (same !== "new") ex = same; } if (ex) name = ex.name; const type = r.type ? TYPE_IN[r.type.trim().toLowerCase()] : (ex ? ex.type : "rm"); if (!type) return out.err(r, `Type “${r.type}” isn’t RM, PM or Semi-finished`);
        const uu = r.unit ? unitIn(r.unit) : ex ? [ex.unit, BIG[ex.unit] ? BIG[ex.unit][1] : 1] : ["g", 1000];   // blank unit: the existing unit (kg / L), or kg for a new material if (!uu) return out.err(r, `Unit “${r.unit}” isn’t g, kg, ml, L or pcs`);
        const [unit, f] = uu; if (ex && ex.unit !== unit && (M.stockMap()[ex.id] || 0)) return out.err(r, `${name} has stock in ${ex.unit}; its unit can’t change to ${unit}`);
        const reorder = numOr(r.reorder), price = numOr(r.price), tax = numOr(r.tax), y = numOr(r.yield); if ([reorder, price, tax, y].some(Number.isNaN)) return out.err(r, "Reorder level, Price, Tax % and Yield must be numbers");
        const rec = { ...(ex ? clean(ex) : { id: uid("i"), recipe: [], barcode: "", supplier: "" }), name, type, unit, reorder: reorder != null ? reorder * f : (ex ? ex.reorder : 0), cost: price != null ? price / f : (ex ? ex.cost : 0),
          category: r.category || (ex ? ex.category || "" : ""), supplier: r.supplier || (ex ? ex.supplier : ""), barcode: r.barcode || (ex ? ex.barcode : ""), taxPct: r.tax === "" ? (ex ? ex.taxPct ?? null : null) : tax, taxInCost: r.taxcost === "" ? !!(ex && ex.taxInCost) : yes(r.taxcost),
          yield: type === "sf" ? (y != null ? y * f : (ex ? ex.yield : 0)) : 0 };
        if (r.alg) { const al = algIn(r.alg); if (al.bad.length) return out.err(r, `Allergen “${al.bad[0]}” isn’t one of ${M.ALLERGENS.join(", ")}`); rec.allergens = al.list; }
        if (type !== "sf") rec.recipe = [];
        out.upsert(ex, rec, name, () => ev.put("ingredients", rec)); });
      return out; } },
  bom: { label: "BOM", icon: "tree", desc: "What goes into each menu item (per piece) and each semi-finished item (per run).",
    cols: [{ k: "parent", label: "Parent", req: true }, { k: "ptype", label: "Parent type" }, { k: "component", label: "Component", req: true }, { k: "qty", label: "Qty", req: true }, { k: "unit", label: "Unit" }],
    notes: ["One row per component. Parent = a menu item (Qty per piece) or a semi-finished material (Qty per run). Parent type: Menu item or Semi-finished (blank = whichever matches the name).", "Each parent listed gets exactly the rows given: its old BOM is replaced. A component or parent not found in the app is matched before saving: you pick the inventory item it means (remembered for next time) or create it. Unit: g, kg, ml, L or pcs (blank = the component’s unit)."],
    ex: ["Paneer Strudel", "Menu item", "Paneer", 40, "g"],
    count: () => M.menu().filter(m => (m.recipe || []).length).length + M.ingredients().filter(i => i.recipe.length).length,
    rows: () => { const ings = M.ingMap(); const out = [];
      M.menu().forEach(m => (m.recipe || []).forEach(r => { const i = ings[r.ingId]; if (i) out.push([m.name, "Menu item", i.name, r4(r.qty), i.unit]); }));
      M.ingredients().filter(x => x.type === "sf").forEach(x => x.recipe.forEach(r => { const i = ings[r.ingId]; if (i) out.push([x.name, "Semi-finished", i.name, r4(r.qty), i.unit]); })); return out; },
    plan(recs, dec) { const out = newPlan(dec); const menu = M.menu(), ings = M.ingredients(); const groups = new Map(); const made = {};
      recs.forEach(r => { const pn = r.parent.trim(); const pt = r.ptype.trim().toLowerCase();
        const m = pt.startsWith("semi") ? null : byName(menu, pn); const s = pt.startsWith("menu") ? null : byNameOrAka(ings.filter(i => i.type === "sf"), pn);
        let parent = m ? { kind: "menu", x: m } : s ? { kind: "sf", x: s } : null;
        if (!parent) { const p = askParent(out, pn, menu, ings); if (p === undefined) return; if (!p) return out.skip(`Rows for “${pn}” skipped`); parent = p; }
        const uh = unitIn(r.unit); const c = askMaterial(out, r.component, uh ? uh[0] : "", ings, made, `used in ${parent.x.name}`); if (c === undefined) return; if (!c) return out.skip(`“${r.component}” in ${parent.x.name} skipped`);
        const q = numOr(r.qty); if (q == null || Number.isNaN(q) || q <= 0) return out.err(r, "Qty must be more than 0");
        const uu = r.unit ? unitIn(r.unit) : [c.unit, 1]; if (!uu || uu[0] !== c.unit) return out.err(r, `${c.name} is measured in ${c.unit}; “${r.unit}” doesn’t fit`);
        const key = parent.kind + ":" + parent.x.id; const g = groups.get(key) || { ...parent, lines: [] }; g.lines.push({ ingId: c.id, qty: q * uu[1] }); groups.set(key, g); });
      if (out.pend.length) return out;   // build the BOMs only once every name is settled
      groups.forEach(g => { if (g.kind === "sf" && M.makesCycle(g.x.id, g.lines)) { out.errors.push({ line: "", msg: `${g.x.name}’s recipe would use itself` }); return; }
        out.put("update", `${g.x.name}: ${g.lines.length} line${g.lines.length > 1 ? "s" : ""}`, () => ev.put(g.kind === "menu" ? "menu" : "ingredients", { ...clean(g.x), recipe: g.lines })); });
      return out; } },
  stock: { label: "Inventory count", icon: "stock", desc: "Opening stock or a stock-take: sets each material’s quantity at a location.",
    cols: [{ k: "material", label: "Material", req: true }, { k: "location", label: "Location" }, { k: "qty", label: "Quantity", req: true }, { k: "unit", label: "Unit" }],
    notes: ["Sets the quantity on hand (a count), recorded as a stock-count entry. Location blank = the first location.", "Unit: g, kg, ml, L or pcs (blank = the material’s unit)."],
    ex: ["Maida", "Central kitchen", 25, "kg"],
    count: () => M.ingredients().length,
    rows: () => { const out = []; M.locations().forEach(l => { const sm = M.stockMap(l.id); M.ingredients().forEach(i => { const [u, f] = BIG[i.unit] || [i.unit, 1]; out.push([i.name, l.name, r4((sm[i.id] || 0) / f), u]); }); }); return out; },
    plan(recs) { const out = newPlan(); const ings = M.ingredients();
      const seenS = new Set(); recs.forEach(r => { const i = byNameOrAka(ings, r.material); if (!i) return out.err(r, `“${r.material}” isn’t in inventory`); const l = locByName(r.location); if (!l) return out.err(r, `Location “${r.location}” doesn’t exist`);
        if (seenS.has(i.id + "@" + l.id)) return out.err(r, `${i.name} at ${l.name} appears twice; a count needs one row`); seenS.add(i.id + "@" + l.id);
        const q = numOr(r.qty); if (q == null || Number.isNaN(q) || q < 0) return out.err(r, "Quantity must be 0 or more"); const uu = r.unit ? unitIn(r.unit) : [i.unit, 1]; if (!uu || uu[0] !== i.unit) return out.err(r, `${i.name} is measured in ${i.unit}`);
        const target = q * uu[1]; const d = target - (M.stockMap(l.id)[i.id] || 0); if (!d) return out.skip(`${i.name} at ${l.name} already ${target} ${i.unit}`);
        out.put("update", `${i.name} at ${l.name}: ${d > 0 ? "+" : ""}${r4(d)} ${i.unit}`, () => putMove({ ingId: i.id, type: "count", qty: d, note: "Imported count", outletId: l.id })); });
      return out; } },
  fg: { label: "Finished goods count", icon: "batch", desc: "Pieces of each item on the shelf at each location (opening count for ERP).",
    cols: [{ k: "location", label: "Location" }, { k: "item", label: "Item", req: true }, { k: "qty", label: "Pieces", req: true }],
    notes: ["Sets the pieces on hand (a count). Location blank = the first location. Item must be on the menu."], ex: ["Baner shop", "Paneer Strudel", 12],
    count: () => Object.values(M.fgStock()).reduce((s, o) => s + Object.keys(o).length, 0),
    rows: () => { const fg = M.fgStock(); const out = []; M.locations().forEach(l => Object.entries(fg[l.id] || {}).forEach(([n, q]) => out.push([l.name, n, q]))); return out; },
    plan(recs) { const out = newPlan(); const fg = M.fgStock();
      const seenF = new Set(); recs.forEach(r => { const m = byName(M.menu(), r.item); if (!m) return out.err(r, `“${r.item}” isn’t on the menu`); const l = locByName(r.location); if (!l) return out.err(r, `Location “${r.location}” doesn’t exist`);
        if (seenF.has(m.id + "@" + l.id)) return out.err(r, `${m.name} at ${l.name} appears twice; a count needs one row`); seenF.add(m.id + "@" + l.id);
        const q = numOr(r.qty); if (q == null || Number.isNaN(q) || q < 0 || q % 1) return out.err(r, "Pieces must be a whole number, 0 or more");
        const d = q - ((fg[l.id] || {})[m.name] || 0); if (!d) return out.skip(`${m.name} at ${l.name} already ${q}`);
        out.put("update", `${m.name} at ${l.name}: ${d > 0 ? "+" : ""}${d}`, () => ev.put("fg", { id: uid("f"), loc: l.id, item: m.name, qty: d, type: "count", date: today(), note: "Imported count" })); });
      return out; } },
  suppliers: { label: "Suppliers", icon: "inbox", desc: "Supplier names with phone and GSTIN.",
    cols: [{ k: "name", label: "Name", req: true }, { k: "phone", label: "Phone" }, { k: "gstin", label: "GSTIN" }],
    notes: ["Matched by Name: existing suppliers are updated."], ex: ["Sharma Traders", "9876543210", "27ABCDE1234F1Z5"],
    count: () => M.suppliers().length,
    rows: () => M.suppliers().map(s => [s.name, s.phone || "", s.gstin || ""]),
    plan(recs, dec) { const out = newPlan(dec); const sup = M.suppliers();
      recs.forEach(r => { let name = r.name.trim(); if (!name) return out.err(r, "Name is blank"); let ex = byName(sup, name);
        if (!ex) { const same = askSame(out, "supplier", name, sup); if (same === undefined) return; if (same !== "new") { ex = same; name = ex.name; } }
        const rec = { ...(ex ? clean(ex) : { id: uid("s") }), name, phone: r.phone || (ex ? ex.phone || "" : ""), gstin: (r.gstin || (ex ? ex.gstin || "" : "")).toUpperCase() };
        out.upsert(ex, rec, name, () => ev.put("suppliers", rec)); });
      return out; } },
  orders: { label: "Orders", icon: "orders", desc: "One row per item; rows with the same order number make one order.",
    cols: [{ k: "no", label: "Order #", req: true }, { k: "date", label: "Date", req: true }, { k: "customer", label: "Customer" }, { k: "flat", label: "Flat" }, { k: "phone", label: "Phone" }, { k: "channel", label: "Channel" }, { k: "status", label: "Status" }, { k: "item", label: "Item", req: true }, { k: "qty", label: "Qty", req: true }, { k: "rate", label: "Rate" }, { k: "tax", label: "Tax %" }, { k: "disc", label: "Offer %" }, { k: "damt", label: "Discount ₹" }, { k: "paid", label: "Paid" }, { k: "mode", label: "Paid by" }, { k: "notes", label: "Notes" }],
    notes: ["Date as YYYY-MM-DD. Orders whose number is already in the app are skipped. Order details (customer, channel, status, offer, paid) are read from the order’s first row.", "Channel: WhatsApp, Phone, Instagram, Bulk / event, Other, Walk-in, Swiggy or Zomato. Status: Received, Confirmed, Ready, Delivered or Cancelled. Rate blank = menu price. Tax % blank = today’s rate. Paid = amount received for the whole order."],
    ex: ["1001", "2026-10-18", "Asha", "A-1201", "9876543210", "WhatsApp", "Delivered", "Paneer Strudel", 2, 120, 5, 0, "", 252, "UPI", ""],
    count: () => M.orders().length,
    rows: () => { const out = []; M.orders().sort((a, b) => a.date < b.date ? -1 : 1).forEach(o => o.items.forEach((i, ix) => out.push([o.no, o.date, o.customer, o.flat, o.phone, M.CHANNELS[o.channel] || o.channel, M.STATUS_LABEL[o.status] || o.status, i.item, i.qty, i.rate, i.taxPct ?? "", ix ? "" : o.discountPct || "", ix ? "" : o.discountAmt || "", ix ? "" : M.received(o) || "", ix ? "" : M.lastPayMode(o), ix ? "" : o.notes]))); return out; },
    plan(recs) { const out = newPlan(); const have = new Set(M.orders().map(o => String(o.no))); const groups = new Map();
      const chan = v => { const s = String(v || "").trim().toLowerCase(); if (!s) return "whatsapp"; return Object.keys(M.CHANNELS).find(k => k === s || M.CHANNELS[k].toLowerCase() === s || M.CHANNELS[k].toLowerCase().split(" ")[0] === s) || null; };
      const stat = v => { const s = String(v || "").trim().toLowerCase(); if (!s) return "received"; return Object.keys(M.STATUS_LABEL).find(k => k === s || M.STATUS_LABEL[k].toLowerCase() === s) || null; };
      recs.forEach(r => { const no = r.no.trim(); if (!no) return out.err(r, "Order # is blank"); const g = groups.get(no) || { first: r, rows: [] }; g.rows.push(r); groups.set(no, g); });
      groups.forEach((g, no) => { const f = g.first; if (have.has(no)) return out.skip(`Order ${no} is already in the app`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date)) return out.err(f, `Order ${no}: date must be YYYY-MM-DD`);
        const channel = chan(f.channel), status = stat(f.status); if (!channel) return out.err(f, `Order ${no}: channel “${f.channel}” not recognised`); if (!status) return out.err(f, `Order ${no}: status “${f.status}” not recognised`);
        const items = []; for (const r of g.rows) { const m = byName(M.menu(), r.item); const q = numOr(r.qty), rate = numOr(r.rate), tax = numOr(r.tax);
          if (!r.item) return out.err(r, `Order ${no}: item is blank`); if (q == null || Number.isNaN(q) || q <= 0) return out.err(r, `Order ${no}: Qty must be more than 0`);
          if (Number.isNaN(rate) || Number.isNaN(tax)) return out.err(r, `Order ${no}: Rate and Tax % must be numbers`); if (rate == null && !m) return out.err(r, `Order ${no}: “${r.item}” isn’t on the menu, so it needs a Rate`);
          items.push({ item: m ? m.name : r.item, qty: q, rate: rate ?? m.price, ...(m ? { menuId: m.id } : {}), ...(tax != null ? { taxPct: tax } : {}) }); }
        const paid = numOr(f.paid, 0), disc = numOr(f.disc, 0), damt = numOr(f.damt, 0); if ([paid, disc, damt].some(Number.isNaN)) return out.err(f, `Order ${no}: Paid, Offer % and Discount ₹ must be numbers`);
        const o = { id: uid("o"), no, date: f.date, customer: f.customer || M.CHANNELS[channel], flat: (f.flat || "").toUpperCase(), phone: f.phone || "", channel, status, items, discountPct: damt ? 0 : disc, discountAmt: damt, notes: f.notes || "", tag: "", source: "import", createdAt: new Date().toISOString(), ...(status === "delivered" ? { deliveredAt: f.date + "T12:00:00.000Z" } : {}) };
        out.put("add", `Order ${no} · ${o.customer} · ${items.length} item${items.length > 1 ? "s" : ""}${paid ? ` · paid ${paid}` : ""}`, async () => { await saveOrder(o);
          if (paid > 0) await ev.put("payments", { id: uid("p"), orderId: o.id, customerKey: M.ckey(o), amount: Math.round(paid * 100) / 100, mode: f.mode || "", date: f.date, note: "Imported", businessId: M.config().businessId }); }); });
      return out; } },
  batches: { label: "Batches", icon: "batch", desc: "Every batch with pieces, spoiled, prep and cost.", exportOnly: true,
    cols: ["Batch #", "Date", "Location", "Item or prep", "Pieces or runs", "Spoiled", "Batch cost", "Made by", "Note", "Status"].map(label => ({ label })), count: () => M.batches().length,
    rows: () => { const ings = M.ingMap(); const out = []; M.batches().slice().reverse().forEach(b => { const st = b.void ? "Undone" : "";
      b.lines.forEach((l, ix) => out.push([b.no, b.date, M.locName(b.outletId || M.locations()[0].id), l.item, l.qty, l.spoiled, ix ? "" : Math.round(M.batchCost(b) * 100) / 100, ix ? "" : memberName(b.madeBy || b._by), ix ? "" : b.notes, st]));
      b.prep.forEach(p => out.push([b.no, b.date, M.locName(b.outletId || M.locations()[0].id), (ings[p.ingId] || {}).name || "?", p.runs + " run(s)", "", "", "", "", st])); }); return out; } },
  transfers: { label: "Transfers", icon: "truck", desc: "Sent and received quantities between locations.", exportOnly: true,
    cols: ["Transfer", "Date", "From", "To", "Item or material", "Sent", "Received", "Unit", "Status"].map(label => ({ label })), count: () => M.transfers().length,
    rows: () => { const ings = M.ingMap(); const out = []; M.transfers().slice().reverse().forEach(t => t.lines.forEach(l => { const i = l.ingId ? ings[l.ingId] : null;
      out.push([t.no, t.date, M.locName(t.from), M.locName(t.to), l.item || (i ? i.name : "?"), l.qty, M.xferReceived(t) ? (l.recv ?? l.qty) : "", l.item ? "pcs" : (i ? i.unit : ""), t.void ? "Undone" : M.xferReceived(t) ? (M.xferShort(t) ? "Received short" : "Received") : "In transit"]); })); return out; } }
};
/* ---------- more data types: people, places, money and purchasing ---------- */
// Columns marked out are only in exports (worked out by the app); templates and imports leave them out.
const ISO_D = /^\d{4}-\d{2}-\d{2}$/;
const r2 = v => Math.round(v * 100) / 100;
const usesOf = m => { const mm = Array.isArray(m.modes) ? m.modes : ["restaurant"]; return mm.length > 1 ? "Both" : mm[0] === "erp" ? "ERP" : "Restaurant"; };
// Same rule as adding a person by hand: first letter, then letter pairs, never one already used.
const prefixOf = (name, used) => { const base = (name.trim()[0] || "X").toUpperCase(); if (!used.has(base)) return base; for (const ch of name.toUpperCase().replace(/[^A-Z]/g, "").slice(1)) if (!used.has(base + ch)) return base + ch; for (const a of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") for (const b of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") if (!used.has(base + a + b)) return base + a + b; return base + "Z"; };
const supKnown = n => M.supplierByName(n) || M.payables().find(p => M.nameKey(p.name) === M.nameKey(n));
const big = i => BIG[i.unit] || [i.unit, 1];
// A material named in a purchase file: matched (or created) like the BOM import, with a unit that must fit it.
function lineMat(out, r, ings, made, ctx) {
  const uh = r.unit ? unitIn(r.unit) : null; if (r.unit && !uh) { out.err(r, `Unit “${r.unit}” isn’t g, kg, ml, L or pcs`); return null; }
  const m = askMaterial(out, r.material, uh ? uh[0] : "", ings, made, ctx, ["rm", "pm"]); if (m === undefined) return undefined; if (!m) { out.skip(`“${r.material}” skipped`); return null; }
  const uu = uh || [m.unit, BIG[m.unit] ? BIG[m.unit][1] : 1]; if (uu[0] !== m.unit) { out.err(r, `${m.name} is measured in ${m.unit}; “${r.unit}” doesn’t fit`); return null; }
  return { m, f: uu[1] };
}
const taxDefault = m => M.taxCfg().on ? (m.taxPct != null && m.taxPct !== "" ? +m.taxPct : +M.taxCfg().rate || 0) : 0;

T.customers = { label: "Customers", icon: "people", desc: "Name, flat, phone, notes and advance held. Customers also come in with their orders.",
  cols: [{ k: "customer", label: "Customer", req: true }, { k: "flat", label: "Flat" }, { k: "phone", label: "Phone" }, { k: "notes", label: "Notes" }, { k: "credit", label: "Advance held" }, ...["Orders", "Spend", "Received", "Balance", "Last order"].map(label => ({ label, out: true }))],
  notes: ["Matched by Customer and Flat together. Existing customers get the phone and notes given; new ones can be added before their first order.", "Advance held: money of theirs you already hold (₹). If it is more than the app shows, the difference is added as an advance; it is never reduced here (use Refund credit on their page). What they owe comes in with the Orders import (its Paid column)."],
  ex: ["Asha Mehta", "A-1201", "9876543210", "No nuts", 500],
  count: () => M.customers().length,
  rows: () => M.customers().sort((a, b) => a.customer.localeCompare(b.customer)).map(c => [c.customer, c.flat, c.phone, c.notes || "", c.credit || "", c.orders.length, c.spend, c.received, c.balance, c.last || ""]),
  plan(recs) { const out = newPlan(); const cs = M.customers(); const seen = new Set();
    recs.forEach(r => { const name = r.customer.trim(); if (!name) return out.err(r, "Customer is blank"); const flat = r.flat.trim().toUpperCase(); const key = M.ckey({ customer: name, flat }); const who = name + (flat ? " · " + flat : "");
      if (seen.has(key)) return out.err(r, `${who} appears twice`); seen.add(key);
      const credit = numOr(r.credit); if (Number.isNaN(credit) || (credit != null && credit < 0)) return out.err(r, "Advance held must be 0 or more");
      const c = cs.find(x => x.key === key); const ex = ev.get("custs", key);
      const rec = { ...(ex ? clean(ex) : { id: key }), customer: name, flat, phone: r.phone.trim() || (ex ? ex.phone || "" : c ? c.phone || "" : ""), notes: r.notes.trim() || (ex ? ex.notes || "" : "") };
      if (ex || !c || rec.phone !== (c.phone || "") || rec.notes) out.upsert(ex, rec, who, () => ev.put("custs", rec)); else out.skip(`${who} unchanged`);
      const have = c ? c.credit : 0;
      if (credit != null && credit > have + 0.005) out.put("update", `${who}: advance +${r2(credit - have)}`, () => addCredit({ key, customer: name, flat }, credit - have, "Opening", "Imported advance"));
      else if (credit != null && credit < have - 0.005) out.skip(`${who} holds ${have} already; import never reduces an advance`); });
    return out; } };

T.users = { label: "Users & roles", icon: "people", desc: "People, their role, Restaurant / ERP, location and Google email.",
  cols: [{ k: "name", label: "Name", req: true }, { k: "role", label: "Role", req: true }, { k: "uses", label: "Uses" }, { k: "location", label: "Location" }, { k: "email", label: "Email" }, { label: "Number prefix", out: true }, { label: "PIN set", out: true }],
  notes: [`Role: ${R.ROLE_KEYS.filter(k => k !== "admin").map(k => R.ROLES[k].label).join(", ")}. Admins are added in More → Users, not by import, and an admin’s role can’t be changed here.`, "Matched by Name, or by Email. Uses: Restaurant, ERP or Both (blank = Restaurant for new people). Location blank = the first. PINs are never imported or exported; each person sets their own."],
  ex: ["Ravi", "Kitchen", "ERP", "Central kitchen", "ravi@gmail.com"],
  count: () => R.members().length,
  rows: () => R.members().map(m => [m.name, (R.ROLES[m.role] || {}).label || m.role, usesOf(m), M.locName(m.loc || M.locations()[0].id), m.email || "", m.prefix || "", R.hasPin(m) ? "Yes" : "No"]),
  plan(recs) { const out = newPlan(); const ms = R.members(); const seen = new Set(); const used = new Set(ms.map(m => m.prefix).filter(Boolean));
    const roles = R.ROLE_KEYS.filter(k => k !== "admin").map(k => R.ROLES[k].label).join(", ");
    recs.forEach(r => { const name = r.name.trim(); if (!name) return out.err(r, "Name is blank"); if (seen.has(name.toLowerCase())) return out.err(r, `${name} appears twice`); seen.add(name.toLowerCase());
      const rl = r.role.trim().toLowerCase(); const role = R.ROLE_KEYS.find(k => k === rl || R.ROLES[k].label.toLowerCase() === rl); if (!role) return out.err(r, `Role “${r.role}” isn’t one of ${roles}`);
      const email = r.email.trim().toLowerCase(); if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return out.err(r, `Email “${r.email}” doesn’t look right`);
      const ex = ms.find(m => m.name.trim().toLowerCase() === name.toLowerCase()) || (email ? ms.find(m => (m.email || "").toLowerCase() === email) : null);
      if (role === "admin" && !(ex && ex.role === "admin")) return out.err(r, `${name}: admins are added in More → Users, not by import`);
      if (ex && ex.role === "admin" && role !== "admin") return out.err(r, `${ex.name} is an admin; change that in More → Users`);
      const u = r.uses.trim().toLowerCase(); const modes = !u ? null : u.startsWith("both") ? ["restaurant", "erp"] : u.startsWith("erp") ? ["erp"] : u.startsWith("rest") ? ["restaurant"] : undefined;
      if (modes === undefined) return out.err(r, "Uses must be Restaurant, ERP or Both");
      const l = r.location.trim() ? locByName(r.location) : null; if (r.location.trim() && !l) return out.err(r, `Location “${r.location}” doesn’t exist`);
      let prefix = ex && ex.prefix; if (!prefix) { prefix = prefixOf(name, used); used.add(prefix); }
      const rec = { ...(ex ? clean(ex) : { id: uid("u"), pin: "", modes: ["restaurant"] }), name, role, email: email || (ex ? ex.email || "" : ""), prefix, ...(modes ? { modes } : {}), ...(l ? { loc: l.id } : {}) };
      out.upsert(ex, rec, `${name} · ${R.ROLES[role].label}`, () => ev.put("members", rec)); });
    return out; },
  // ERP starts counting finished goods from the day it is first given to someone (as when adding a person by hand).
  after: async () => { if (M.erpOn() && !M.config().erpStart) await ev.put("config", clean({ ...M.config(), erpStart: today(), id: "app" })); } };

T.locations = { label: "Locations", icon: "store", desc: "Kitchens and outlets.",
  cols: [{ k: "name", label: "Name", req: true }, { k: "kind", label: "Kind" }],
  notes: ["Matched by Name: a new name adds a location; Kind changes an existing one. Kind: Kitchen or Outlet (blank = Outlet for a new one). Import never removes a location; rename or remove them in Business settings."],
  ex: ["Baner shop", "Outlet"],
  count: () => M.locations().length,
  rows: () => M.locations().map(l => [l.name, l.kind === "kitchen" ? "Kitchen" : "Outlet"]),
  plan(recs) { const out = newPlan(); const locs = M.locations().map(l => ({ ...l })); const seen = new Set(); let done = false;
    const save = async () => { if (done) return; done = true; await ev.put("config", clean({ ...M.config(), id: "app", locations: locs })); };
    recs.forEach(r => { const name = r.name.trim(); if (!name) return out.err(r, "Name is blank"); if (seen.has(name.toLowerCase())) return out.err(r, `${name} appears twice`); seen.add(name.toLowerCase());
      const k = r.kind.trim().toLowerCase(); const kind = !k ? null : k.startsWith("kitchen") ? "kitchen" : /^(outlet|shop|store)/.test(k) ? "outlet" : undefined; if (kind === undefined) return out.err(r, "Kind must be Kitchen or Outlet");
      const ex = locs.find(l => l.name.trim().toLowerCase() === name.toLowerCase());
      if (ex) { if (kind && kind !== (ex.kind || "outlet")) { ex.kind = kind; out.put("update", `${ex.name} → ${kind}`, save); } else out.skip(`${ex.name} unchanged`); }
      else { locs.push({ id: uid("l"), name, kind: kind || "outlet" }); out.put("add", `${name} (${kind || "outlet"})`, save); } });
    if (out.ops.length && !locs.some(l => l.kind === "kitchen")) { out.ops = []; out.adds = out.updates = 0; out.errors.push({ line: "", msg: "At least one location has to stay a kitchen" }); }
    return out; } };

{ // suppliers: credit days, other names and an opening balance as well
  const t = T.suppliers;
  t.desc = "Supplier names with phone, GSTIN, credit days and the balance owed when you start.";
  t.cols = [...t.cols, { k: "days", label: "Credit days" }, { k: "lead", label: "Lead days" }, { k: "aka", label: "Other names" }, { k: "opening", label: "Opening balance" }, { k: "asOn", label: "Balance as on" }];
  t.notes = ["Matched by Name (or another name): existing suppliers are updated.", "Opening balance: what you owed them when you started with the app (negative = an advance with them), as on the date given (YYYY-MM-DD, blank = today). It shows as the first bill in their ledger. Other names: comma separated, in quotes."];
  t.ex = ["Sharma Traders", "9876543210", "27ABCDE1234F1Z5", 15, 2, "Sharma, ST", 12500, "2026-04-01"];
  t.rows = () => M.suppliers().map(s => [s.name, s.phone || "", s.gstin || "", s.days || "", s.lead ?? "", (s.aka || []).join(", "), s.opening || "", s.opening ? s.openingDate || "" : ""]);
  t.plan = (recs, dec) => { const out = newPlan(dec); const sup = M.suppliers(); const seen = new Set();
    recs.forEach(r => { let name = r.name.trim(); if (!name) return out.err(r, "Name is blank"); if (seen.has(name.toLowerCase())) return out.err(r, `${name} appears twice`); seen.add(name.toLowerCase());
      let ex = byNameOrAka(sup, name); if (!ex) { const same = askSame(out, "supplier", name, sup); if (same === undefined) return; if (same !== "new") ex = same; } if (ex) name = ex.name;
      const days = numOr(r.days), ob = numOr(r.opening), lead = numOr(r.lead); if (Number.isNaN(lead) || (lead != null && lead < 0)) return out.err(r, "Lead days must be 0 or more"); if (Number.isNaN(days) || (days != null && days < 0)) return out.err(r, "Credit days must be 0 or more"); if (Number.isNaN(ob)) return out.err(r, "Opening balance must be a number");
      if (r.asOn && !ISO_D.test(r.asOn)) return out.err(r, "Balance as on must be YYYY-MM-DD");
      const aka = r.aka ? [...new Set([...(ex ? ex.aka || [] : []), ...r.aka.split(",").map(x => x.trim()).filter(x => x && x.toLowerCase() !== name.toLowerCase())])] : (ex ? ex.aka : undefined);
      const rec = { ...(ex ? clean(ex) : { id: uid("s") }), name, phone: r.phone || (ex ? ex.phone || "" : ""), gstin: (r.gstin || (ex ? ex.gstin || "" : "")).toUpperCase(), ...(days != null ? { days: Math.round(days) } : {}), ...(lead != null ? { lead: Math.round(lead) } : {}), ...(aka && aka.length ? { aka } : {}),
        ...(ob != null ? { opening: r2(ob), openingDate: r.asOn || (ex && ex.openingDate) || today() } : {}) };
      out.upsert(ex, rec, name, () => ev.put("suppliers", rec)); });
    return out; };
}

T.payments = { label: "Payments", icon: "pay", desc: "Every payment, reversal and advance. Import payments against order numbers, or advances for a customer.",
  cols: [{ k: "date", label: "Date", req: true }, { k: "no", label: "Order #" }, { k: "customer", label: "Customer" }, { k: "flat", label: "Flat" }, { k: "amount", label: "Amount", req: true }, { k: "mode", label: "Mode" }, { k: "note", label: "Note" }],
  notes: ["Date as YYYY-MM-DD. With an Order #, the payment goes on that order and can’t be more than the order still owes. Without one, it is an advance held for the Customer and Flat given.", "Mode: UPI, Cash, Card, Bank… Reversals are made in the app, not imported. A row matching a payment already in the app (same order or customer, date, amount and mode) is skipped, so an export can be imported again safely."],
  ex: ["2026-10-18", "1001", "", "", 252, "UPI", ""],
  count: () => ev.all("payments").length,
  rows: () => { const byId = Object.fromEntries(M.orders().map(o => [o.id, o])); return ev.all("payments").sort((a, b) => a.date < b.date ? -1 : 1).map(p => { const o = byId[p.orderId] || {}; return [p.date, o.no || "", o.customer || p.customer || "", o.flat || p.flat || "", p.amount, p.mode, p.note || ""]; }); },
  plan(recs) { const out = newPlan(); const byNo = new Map(M.orders().map(o => [String(o.no), o])); const pays = ev.all("payments"); const left = {};
    const same = (p, d, a, m) => p.date === d && Math.abs((+p.amount || 0) - a) < 0.005 && (p.mode || "") === m;
    recs.forEach(r => { if (!ISO_D.test(r.date)) return out.err(r, "Date must be YYYY-MM-DD"); const a = numOr(r.amount); if (a == null || Number.isNaN(a)) return out.err(r, "Amount must be a number"); const mode = r.mode.trim();
      if (r.no.trim()) { const o = byNo.get(r.no.trim()); if (!o) return out.err(r, `Order ${r.no} isn’t in the app`);
        if (pays.some(p => p.orderId === o.id && same(p, r.date, a, mode))) return out.skip(`Order ${o.no}: ${a} on ${r.date} already recorded`);
        if (a <= 0) return out.err(r, "Amount must be more than 0; reversals are made in the app"); if (o.status === "cancelled") return out.err(r, `Order ${o.no} is cancelled`);
        const owe = left[o.id] ?? M.bal(o); if (a > owe + 0.005) return out.err(r, `Order ${o.no} owes ${r2(owe)}; ${a} is more`); left[o.id] = owe - a;
        out.put("add", `Order ${o.no} · ${o.customer}: ${a}${mode ? " " + mode : ""}`, () => ev.put("payments", { id: uid("p"), orderId: o.id, customerKey: M.ckey(o), amount: r2(a), mode, date: r.date, note: r.note || "Imported", businessId: M.config().businessId })); }
      else { const name = r.customer.trim(); if (!name) return out.err(r, "Give an Order #, or a Customer for an advance"); const flat = r.flat.trim().toUpperCase(); const key = M.ckey({ customer: name, flat });
        if (pays.some(p => !p.orderId && p.customerKey === key && same(p, r.date, a, mode))) return out.skip(`${name}: ${a} on ${r.date} already recorded`);
        if (a <= 0) return out.err(r, "Amount must be more than 0; refunds are made in the app");
        out.put("add", `Advance · ${name}${flat ? " · " + flat : ""}: ${a}`, () => ev.put("payments", { id: uid("p"), orderId: "", customerKey: key, customer: name, flat, amount: r2(a), mode, date: r.date, note: r.note || "Imported advance", businessId: M.config().businessId })); } });
    return out; } };

T.grns = { label: "GRNs", icon: "inbox", desc: "Goods received, line by line, with tax. Import past purchases: they add stock and become supplier bills.",
  cols: [{ k: "no", label: "GRN" }, { k: "date", label: "Date", req: true }, { k: "supplier", label: "Supplier", req: true }, { k: "invoice", label: "Invoice" }, { k: "loc", label: "Received at" }, { k: "material", label: "Material", req: true }, { k: "qty", label: "Qty", req: true }, { k: "unit", label: "Unit" }, { k: "amount", label: "Amount", req: true }, { k: "tax", label: "Tax %" }, { label: "Cost to stock", out: true }, { k: "status", label: "Status" }],
  notes: ["One row per material. Rows with the same GRN (or, without one, the same Supplier, Invoice and Date) make one GRN. Date as YYYY-MM-DD; Received at blank = the first location.", "Qty in the Unit given (g, kg, ml, L or pcs; blank = kg / L / pcs). Amount = before tax. Tax % blank = the material’s rate. A GRN whose number, or supplier and invoice, is already in the app is skipped; undone ones are skipped too."],
  ex: ["", "2026-10-15", "Sharma Traders", "INV-778", "Central kitchen", "Maida", 50, "kg", 2250, 5, "", ""],
  count: () => M.grns().length,
  rows: () => { const ings = M.ingMap(); const out = []; M.grns().slice().reverse().forEach(g => g.lines.forEach(l => { const i = ings[l.ingId]; const [u, f] = i ? big(i) : ["", 1]; out.push([g.no, g.date, g.supplier, g.invoiceNo || "", M.locName(g.loc), i ? i.name : "?", r4(l.qty / f), u, l.amount, l.taxPct || "", l.cost ?? l.amount, g.void ? "Undone" : ""]); })); return out; },
  plan(recs, dec) { const out = newPlan(dec); const ings = M.ingredients(); const made = {}; const groups = new Map(); const have = M.grns();
    recs.forEach(r => { if (/undone/i.test(r.status)) return out.skip(`${r.no || "A GRN"} line marked undone`); const key = r.no.trim() || [M.nameKey(r.supplier), r.invoice.trim().toLowerCase(), r.date].join("|");
      const g = groups.get(key) || { first: r, rows: [] }; g.rows.push(r); groups.set(key, g); });
    const ready = [];
    groups.forEach(g => { const f0 = g.first; const label = f0.no || `${f0.supplier} ${f0.invoice || f0.date}`;
      if (f0.no && have.some(x => x.no === f0.no)) return out.skip(`${f0.no} is already in the app`);
      if (f0.invoice && have.some(x => !x.void && M.nameKey(x.supplier) === M.nameKey(f0.supplier) && (x.invoiceNo || "").toLowerCase() === f0.invoice.trim().toLowerCase())) return out.skip(`${f0.supplier} invoice ${f0.invoice} is already in the app`);
      if (!ISO_D.test(f0.date)) return out.err(f0, `${label}: date must be YYYY-MM-DD`); if (!f0.supplier.trim()) return out.err(f0, `${label}: Supplier is blank`);
      const l = locByName(f0.loc); if (!l) return out.err(f0, `Location “${f0.loc}” doesn’t exist`);
      const lines = []; for (const r of g.rows) { const x = lineMat(out, r, ings, made, `in ${label}`); if (x === undefined) return; if (!x) continue;
        const q = numOr(r.qty), a = numOr(r.amount), t = numOr(r.tax); if (q == null || Number.isNaN(q) || q <= 0) return out.err(r, `${label}: Qty must be more than 0`); if (a == null || Number.isNaN(a) || a < 0 || Number.isNaN(t)) return out.err(r, `${label}: Amount and Tax % must be numbers`);
        lines.push({ ing: x.m, qty: q * x.f, amount: r2(a), taxPct: t ?? taxDefault(x.m) }); }
      if (lines.length) ready.push({ f0, l, lines, label }); });
    if (out.pend.length) return out;   // every material name settled first
    ready.forEach(({ f0, l, lines, label }) => { const sup = byNameOrAka(M.suppliers(), f0.supplier); const name = sup ? sup.name : f0.supplier.trim();
      const amount = r2(lines.reduce((s, x) => s + x.amount, 0)), tax = r2(lines.reduce((s, x) => s + x.amount * x.taxPct / 100, 0));
      out.put("add", `${label} · ${name} · ${lines.length} line${lines.length > 1 ? "s" : ""} · ${r2(amount + tax)}`, async () => {
        if (!M.supplierByName(name)) await ev.put("suppliers", { id: uid("s"), name });
        const id = uid("g"); const no = f0.no.trim() || M.nextDocNo("grns", R.numPrefix(), "GRN"); const cur = M.ingMap(); const costOf = x => r2(x.amount * (1 + ((cur[x.ing.id] || x.ing).taxInCost ? x.taxPct / 100 : 0)));
        for (const x of lines) await putMove({ ingId: x.ing.id, type: "purchase", qty: x.qty, amount: costOf(x), date: f0.date, note: `${no} · ${name}`, ref: id, outletId: l.id });
        await ev.put("grns", { id, no, date: f0.date, supplier: name, invoiceNo: f0.invoice.trim(), loc: l.id, notes: "Imported", lines: lines.map(x => ({ ingId: x.ing.id, qty: x.qty, amount: x.amount, taxPct: x.taxPct, cost: costOf(x) })), amount, tax, total: r2(amount + tax), by: (R.me() || {}).id || "" }); }); });
    return out; } };

T.spays = { label: "Supplier payments", icon: "pay", desc: "Payments made to suppliers, with the bills they settle.",
  cols: [{ k: "date", label: "Date", req: true }, { k: "supplier", label: "Supplier", req: true }, { k: "amount", label: "Amount", req: true }, { k: "mode", label: "Mode" }, { k: "ref", label: "Reference" }, { k: "bills", label: "Against bills" }],
  notes: ["Date as YYYY-MM-DD. Mode: Bank, UPI, Cash or Cheque. Against bills: GRN numbers or supplier invoice numbers, separated by ; (blank = the oldest bills first).", "Reversals are made in the app. A row matching a payment already in the app (supplier, date, amount, reference) is skipped."],
  ex: ["2026-10-18", "Sharma Traders", 12500, "Bank", "UTR 1234", "GRN-P4; INV-778"],
  count: () => M.spays().length,
  rows: () => { const g = Object.fromEntries(M.grns().map(x => [x.id, x.no])); return M.spays().slice().reverse().map(p => [p.date, p.supplier, p.amount, p.mode || "", p.ref || "", (p.bills || []).map(id => g[id] || (id.startsWith("ob:") ? "Opening balance" : "")).filter(Boolean).join("; ")]); },
  plan(recs) { const out = newPlan(); const pays = M.spays();
    recs.forEach(r => { if (!ISO_D.test(r.date)) return out.err(r, "Date must be YYYY-MM-DD"); const s = supKnown(r.supplier); if (!s) return out.err(r, `“${r.supplier}” isn’t a supplier yet; import Suppliers first`);
      const name = s.name; const a = numOr(r.amount); if (a == null || Number.isNaN(a)) return out.err(r, "Amount must be a number"); const ref = r.ref.trim();
      if (pays.some(p => M.nameKey(p.supplier) === M.nameKey(name) && p.date === r.date && Math.abs(p.amount - a) < 0.005 && (p.ref || "") === ref)) return out.skip(`${name}: ${a} on ${r.date} already recorded`);
      if (a <= 0) return out.err(r, "Amount must be more than 0; reversals are made in the app");
      const mine = M.grns().filter(g => !g.void && M.nameKey(g.supplier) === M.nameKey(name)); const ids = []; const wanted = r.bills.split(/[;,]/).map(x => x.trim()).filter(Boolean);
      for (const w of wanted) { const g = mine.find(x => x.no.toLowerCase() === w.toLowerCase() || (x.invoiceNo || "").toLowerCase() === w.toLowerCase()); if (!g && !/^opening/i.test(w)) return out.err(r, `${name} has no bill “${w}”`); ids.push(g ? g.id : "ob:" + M.nameKey(name)); }
      out.put("add", `${name}: ${a}${r.mode ? " " + r.mode : ""}${ids.length ? " · for " + wanted.join(", ") : ""}`, () => ev.put("spays", { id: uid("sp"), supplier: name, date: r.date, amount: r2(a), mode: r.mode.trim() || "Bank", ref, ...(ids.length ? { bills: ids } : {}), by: (R.me() || {}).id || "" })); });
    return out; } };

T.porders = { label: "Purchase orders", icon: "orders", desc: "POs line by line. Import open POs as drafts or approved.",
  cols: [{ k: "no", label: "PO #" }, { k: "date", label: "Date", req: true }, { k: "supplier", label: "Supplier", req: true }, { k: "expected", label: "Expected" }, { k: "loc", label: "Deliver to" }, { k: "material", label: "Material", req: true }, { k: "qty", label: "Qty", req: true }, { k: "unit", label: "Unit" }, { k: "rate", label: "Rate" }, { k: "tax", label: "Tax %" }, { k: "status", label: "Status" }, { label: "State", out: true }],
  notes: ["One row per material; rows with the same PO # (or, without one, the same Supplier and Date) make one PO. Dates as YYYY-MM-DD. Deliver to blank = the first location.", "Rate is per Unit given (kg, L, pcs…; blank = the supplier’s last price). Status: Draft or Approved (blank = Draft). A PO number already in the app is skipped; closed, cancelled or received POs aren’t imported."],
  ex: ["", "2026-10-18", "Sharma Traders", "2026-10-20", "Central kitchen", "Maida", 100, "kg", 44, 5, "Approved", ""],
  count: () => M.porders().length,
  rows: () => { const ings = M.ingMap(); const out = []; M.porders().slice().reverse().forEach(p => p.lines.forEach(l => { const i = ings[l.ingId]; const [u, f] = i ? big(i) : ["", 1];
    out.push([p.no, p.date, p.supplier, p.expected || "", M.locName(p.loc || M.locations()[0].id), i ? i.name : "?", r4(l.qty / f), u, r4((+l.rate || 0) * f), l.taxPct || "", p.status === "approved" ? "Approved" : p.status === "draft" ? "Draft" : (M.PO_LABEL[p.status] || p.status), M.PO_LABEL[M.poState(p)]]); })); return out; },
  plan(recs, dec) { const out = newPlan(dec); const ings = M.ingredients(); const made = {}; const groups = new Map(); const have = new Set(M.porders().map(p => p.no)); const ready = [];
    recs.forEach(r => { const key = r.no.trim() || M.nameKey(r.supplier) + "|" + r.date; const g = groups.get(key) || { first: r, rows: [] }; g.rows.push(r); groups.set(key, g); });
    groups.forEach(g => { const f0 = g.first; const label = f0.no || `${f0.supplier} ${f0.date}`; if (f0.no && have.has(f0.no.trim())) return out.skip(`${f0.no} is already in the app`);
      const st = f0.status.trim().toLowerCase(); const status = !st || st.startsWith("draft") || st.startsWith("waiting") ? "draft" : st.startsWith("approv") ? "approved" : null; if (!status) return out.skip(`${label}: only draft or approved POs are imported`);
      if (!ISO_D.test(f0.date) || (f0.expected && !ISO_D.test(f0.expected))) return out.err(f0, `${label}: dates must be YYYY-MM-DD`); if (!f0.supplier.trim()) return out.err(f0, `${label}: Supplier is blank`);
      const l = locByName(f0.loc); if (!l) return out.err(f0, `Location “${f0.loc}” doesn’t exist`); const sup = (supKnown(f0.supplier) || {}).name || f0.supplier.trim();
      const lines = []; for (const r of g.rows) { const x = lineMat(out, r, ings, made, `in ${label}`); if (x === undefined) return; if (!x) continue;
        const q = numOr(r.qty), rate = numOr(r.rate), t = numOr(r.tax); if (q == null || Number.isNaN(q) || q <= 0) return out.err(r, `${label}: Qty must be more than 0`); if (Number.isNaN(rate) || Number.isNaN(t)) return out.err(r, `${label}: Rate and Tax % must be numbers`);
        const per = rate != null ? rate / x.f : (M.lastRate(sup, x.m.id) || M.lastPrice(x.m)); const d = lines.find(y => y.ingId === x.m.id);
        if (d) { d.rate = (d.rate * d.qty + per * q * x.f) / (d.qty + q * x.f); d.qty += q * x.f; } else lines.push({ ingId: x.m.id, qty: q * x.f, rate: r4(per), taxPct: t ?? taxDefault(x.m) }); }
      if (lines.length) ready.push({ f0, l, lines, label, status, sup }); });
    if (out.pend.length) return out;
    ready.forEach(({ f0, l, lines, label, status, sup }) => out.put("add", `${label} · ${sup} · ${lines.length} line${lines.length > 1 ? "s" : ""} · ${status}`, async () => {
      if (!M.supplierByName(sup)) await ev.put("suppliers", { id: uid("s"), name: sup });
      const me = (R.me() || {}).id || ""; await ev.put("porders", { id: uid("po"), no: f0.no.trim() || M.nextDocNo("porders", R.numPrefix(), "PO"), date: f0.date, supplier: sup, loc: l.id, expected: f0.expected || f0.date, lines, status, notes: "Imported", by: me, ...(status === "approved" ? { approvedBy: me, approvedAt: new Date().toISOString() } : {}) }); }));
    return out; } };

// Records made by the app's own steps (work orders, closes, counts, returns, every stock movement): exported, not imported.
const memName = id => (ev.get("members", id) || {}).name || "";
T.wos = { label: "Work orders", icon: "oven", desc: "Work orders with what they were to make and their status.", exportOnly: true,
  cols: ["WO", "Date", "Location", "Status", "Item or semi-finished", "Pieces or runs", "Notes"].map(label => ({ label })), count: () => ev.all("wos").length,
  rows: () => { const ings = M.ingMap(); const out = []; ev.all("wos").sort((a, b) => a.date < b.date ? -1 : 1).forEach(w => { (w.lines || []).filter(l => l.qty > 0).forEach(l => out.push([w.no, w.date, M.locName(w.loc || M.locations()[0].id), w.status, l.item, l.qty, w.notes || ""]));
    (w.prep || []).filter(p => p.runs > 0).forEach(p => out.push([w.no, w.date, M.locName(w.loc || M.locations()[0].id), w.status, (ings[p.ingId] || {}).name || "?", p.runs + " run(s)", w.notes || ""])); }); return out; } };
T.closes = { label: "Day closes", icon: "pay", desc: "Each person’s day close: expected, counted and the difference by mode.", exportOnly: true,
  cols: ["Date", "Person", "Mode", "Expected", "Counted", "Difference", "Opening cash", "Paid out", "Note"].map(label => ({ label })), count: () => ev.all("closes").length,
  rows: () => { const out = []; ev.all("closes").sort((a, b) => a.date < b.date ? -1 : 1).forEach(c => Object.keys(c.expected || {}).forEach(m => { if (!(c.expected[m] || (c.counted || {})[m] != null)) return;
    out.push([c.date, memName(c.who), m, c.expected[m], (c.counted || {})[m] ?? "", (c.diff || {})[m] ?? "", m === "Cash" ? c.opening || 0 : "", m === "Cash" ? c.paidOut || 0 : "", c.note || ""]); })); return out; } };
T.stocktakes = { label: "Stock-takes", icon: "stock", desc: "Every stock-take line: app quantity, counted, difference and reason.", exportOnly: true,
  cols: ["Stock-take", "Date", "Location", "Material", "In the app", "Counted", "Difference", "Unit", "Reason", "Value"].map(label => ({ label })), count: () => ev.all("stocktakes").length,
  rows: () => { const ings = M.ingMap(); const out = []; ev.all("stocktakes").sort((a, b) => a.date < b.date ? -1 : 1).forEach(t => t.lines.forEach(l => { const i = ings[l.ingId]; const [u, f] = i ? big(i) : ["", 1];
    out.push([t.no, t.date, M.locName(t.loc), i ? i.name : "?", r4(l.system / f), r4(l.counted / f), r4(l.diff / f), u, l.reason || "", l.value]); })); return out; } };
T.preturns = { label: "Purchase returns", icon: "inbox", desc: "Debit notes line by line, with the GRN, reason and tax.", exportOnly: true,
  cols: ["Debit note", "Date", "Supplier", "Against GRN", "Material", "Qty", "Unit", "Amount", "Tax %", "Reason", "Status"].map(label => ({ label })), count: () => M.preturns().length,
  rows: () => { const ings = M.ingMap(); const out = []; M.preturns().slice().reverse().forEach(d => d.lines.forEach(l => { const i = ings[l.ingId]; const [u, f] = i ? big(i) : ["", 1];
    out.push([d.no, d.date, d.supplier, d.grnNo || "", i ? i.name : "?", r4(l.qty / f), u, l.amount, l.taxPct || "", d.reason || "", d.void ? "Undone" : ""]); })); return out; } };
T.moves = { label: "Stock movements", icon: "stock", desc: "Every change to material stock: purchases, use, counts, wastage, transfers.", exportOnly: true,
  cols: ["Date", "Material", "Type", "Qty", "Unit", "Location", "Amount", "Note"].map(label => ({ label })), count: () => ev.all("moves").length,
  rows: () => { const ings = M.ingMap(); return ev.all("moves").sort((a, b) => (a.date + (a._at || "")) < (b.date + (b._at || "")) ? -1 : 1).map(m => { const i = ings[m.ingId]; const [u, f] = i ? big(i) : ["", 1];
    return [m.date, i ? i.name : "?", m.type, r4((+m.qty || 0) / f), u, M.locName(m.outletId || M.locations()[0].id), m.amount ?? "", m.note || ""]; }); } };

// Screen order: masters first, then opening balances and transactions, then what the app records by itself.
{ const order = ["menu", "materials", "bom", "customers", "suppliers", "users", "locations", "stock", "fg", "orders", "payments", "porders", "grns", "spays", "batches", "transfers", "wos", "stocktakes", "preturns", "closes", "moves"];
  const all = { ...T }; Object.keys(T).forEach(k => delete T[k]); [...order, ...Object.keys(all).filter(k => !order.includes(k))].forEach(k => { if (all[k]) T[k] = all[k]; }); }

// dec: the answers given on the check screen so far, by question key. A question without an answer holds its rows back (out.pend).
function newPlan(dec = {}) {
  const out = { adds: 0, updates: 0, skips: [], errors: [], ops: [], pend: [], seenQ: new Set(), aka: new Set() };
  out.ask = (key, q, opts, suggest) => { if (dec[key] !== undefined) return dec[key]; if (!out.seenQ.has(key)) { out.seenQ.add(key); out.pend.push({ key, q, opts, suggest }); } return undefined; };
  out.err = (r, msg) => { out.errors.push({ line: r.line, msg }); };
  out.skip = msg => { out.skips.push(msg); };
  // A record that would come out the same is reported as unchanged instead of written again.
  out.upsert = (ex, rec, what, run) => { const same = ex && JSON.stringify(Object.entries(clean(ex)).sort()) === JSON.stringify(Object.entries(clean(rec)).sort()); if (same) out.skip(`${what} unchanged`); else out.put(ex ? "update" : "add", what, run); };
  out.put = (kind, what, run) => { out[kind === "add" ? "adds" : "updates"]++; out.ops.push({ kind, what, run }); };
  return out;
}
// A new name that looks like an existing record: same one, or really new? Returns the record, "new", or undefined (not answered yet).
function askSame(out, kind, name, list) {
  const hits = similar(list, name).slice(0, 3); if (!hits.length) return "new";
  const v = out.ask(`same:${kind}:${norm(name)}`, `“${name}” would be a new ${kind}. Similar: ${hits.map(h => h.x.name).join(", ")}.`, [...hits.map(h => ({ v: h.x.id, label: `Same as ${h.x.name} (update it)` })), { v: "new", label: `No, add “${name}” as new` }], hits[0].x.id);
  return v === undefined ? undefined : v === "new" ? "new" : list.find(x => x.id === v);
}
// A material named in a file but not in inventory: match it (remembered as another name for that item), create it, or skip it.
function askMaterial(out, name, unit, ings, made, ctx, types = ["rm", "pm", "sf"]) {
  name = String(name || "").trim(); const ex = byNameOrAka(ings, name); if (ex) return ex; const key = "mat:" + norm(name);
  const hits = similar(ings, name, 0.45).slice(0, 4); const hitIds = new Set(hits.map(h => h.x.id));
  const v = out.ask(key, `“${name}”${ctx ? ` (${ctx})` : ""} isn’t in inventory. Which item is it?`, [
    ...hits.map(h => ({ v: h.x.id, label: `${h.x.name}`, group: "Closest matches" })),
    ...ings.filter(i => !hitIds.has(i.id)).map(i => ({ v: i.id, label: i.name, group: M.ING_TYPES[i.type] })),
    ...types.map(t => ({ v: "new:" + t, label: `Add “${name}” as a new ${M.ING_TYPES[t].toLowerCase()}${unit ? ` (${unit})` : ""}`, group: "Not in inventory" })),
    { v: "skip", label: "Skip these rows", group: "Not in inventory" }], hits.length ? hits[0].x.id : "");
  if (v === undefined) return undefined; if (v === "skip") return null;
  if (v.startsWith("new:")) { if (!made[key]) { const rec = { id: uid("i"), name, type: v.slice(4), unit: unit || "g", reorder: 0, cost: 0, barcode: "", supplier: "", category: "", recipe: [], yield: 0, aka: [] };
    made[key] = rec; out.put("add", `New ${M.ING_TYPES[rec.type].toLowerCase()} “${name}” in ${rec.unit}`, () => ev.put("ingredients", rec)); } return made[key]; }
  const m = ings.find(i => i.id === v); if (m && !out.aka.has(key)) { out.aka.add(key);
    out.put("update", `Remember “${name}” as ${m.name}`, () => { const cur = ev.get("ingredients", m.id); return ev.put("ingredients", { ...clean(cur), aka: [...new Set([...(cur.aka || []), name])] }); }); }
  return m;
}
function askParent(out, name, menu, ings) {
  const sfs = ings.filter(i => i.type === "sf"); const all = [...menu.map(x => ({ x, kind: "menu" })), ...sfs.map(x => ({ x, kind: "sf" }))];
  const hits = similar(all.map(a => ({ ...a.x, _k: a.kind })), name, 0.45).slice(0, 4);
  const v = out.ask("parent:" + norm(name), `BOM parent “${name}” isn’t a menu item or semi-finished item. Which is it?`, [
    ...hits.map(h => ({ v: h.x._k + ":" + h.x.id, label: h.x.name, group: "Closest matches" })), ...menu.map(x => ({ v: "menu:" + x.id, label: x.name, group: "Menu items" })),
    ...sfs.map(x => ({ v: "sf:" + x.id, label: x.name, group: "Semi-finished" })), { v: "skip", label: "Skip these rows", group: "Other" }], hits.length ? hits[0].x._k + ":" + hits[0].x.id : "");
  if (v === undefined) return undefined; if (v === "skip") return null; const [k, id] = v.split(":");
  return { kind: k, x: (k === "menu" ? menu : sfs).find(x => x.id === id) };
}
const fileName = (k, kind) => `${(M.config().business || "bakery").replace(/[^\w]+/g, "_")}_${k}_${kind === "template" ? "template" : today()}.csv`;

/* ---------- screen ---------- */
const canExport = () => R.can("export"); const canImport = () => R.isAdmin();
V.data = () => {
  let h = band("Import & export", R.can("stock.buy") ? `<button class="pillbtn" data-act="invoiceIn">${ICON.inbox}Purchase invoice → GRN</button>` : "", `<p class="bandnote">Export what’s in the app as CSV (opens in Excel or Google Sheets), download a template, or import a filled file. Imports show a check screen first.</p>`);
  const types = Object.entries(T).filter(([, t]) => !t.hidden);
  h += `<div class="tools">${layoutSwitch("data")}</div>`;
  if (asLines("data")) return h + `<div class="card tablecard"><table class="reg"><thead><tr><th>Data</th><th>What it holds</th><th class="r">Records</th><th>Export</th><th>Template</th><th>Import</th></tr></thead><tbody>${types.map(([k, t]) => `<tr><td><b>${esc(t.label)}</b></td><td class="items">${esc(t.desc)}</td><td class="r">${t.count()}</td><td>${canExport() ? `<button class="linkbtn" data-exp="${k}">Export</button>` : ""}</td><td>${t.exportOnly ? "–" : `<button class="linkbtn" data-tpl="${k}">Template</button>`}</td><td>${!t.exportOnly && canImport() ? `<label class="linkbtn">Import<input type="file" accept=".csv,text/csv,.xlsx" data-imp="${k}" hidden></label>` : "–"}</td></tr>`).join("")}</tbody></table></div>${!canImport() ? `<p class="hint" style="padding:0 4px">Only the admin can import.</p>` : ""}`;
  return h + `<div class="datalist">${Object.entries(T).filter(([, t]) => !t.hidden).map(([k, t]) => `<div class="datacard"><div class="dc-head"><span class="ic">${ICON[t.icon] || ICON.dl}</span><div class="grow"><b>${esc(t.label)}</b><small>${esc(t.desc)}</small></div><span class="tag t-camp">${t.count()}</span></div>
    <div class="dc-btns">${canExport() ? `<button class="btn btn-ghost" data-exp="${k}">${ICON.dl}Export</button>` : ""}${t.exportOnly ? "" : `<button class="btn btn-ghost" data-tpl="${k}">Template</button>${canImport() ? `<label class="btn btn-primary">${ICON.inbox}Import<input type="file" accept=".csv,text/csv,.xlsx" data-imp="${k}" hidden></label>` : ""}`}</div></div>`).join("")}</div>
  ${!canImport() ? `<p class="hint" style="padding:0 4px">Only the admin can import.</p>` : ""}`;
};
A.data = () => { S.view = "data"; H.render(); window.scrollTo({ top: 0 }); };

async function readFile(file) {
  if (/\.xlsx$/i.test(file.name)) { if (!window.XLSX) throw new Error("Reading .xlsx needs internet the first time. Save the sheet as CSV instead.");
    const wb = window.XLSX.read(await file.arrayBuffer(), { type: "array" }); return window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: "" }); }
  return parseCSV(await file.text());
}
// The check screen: questions to answer first, problems, the changes, what's skipped. Answering a question re-checks the file.
function startImport(k, recs, name, extra = {}) { const st = { kind: "imp", k, recs, name, dec: {}, ...extra }; st.out = T[k].plan(recs, st.dec, st); st.redraw = () => drawPreview(st); drawPreview(st); }
function drawPreview(st) {
  const t = T[st.k]; const out = st.out; const ok = out.ops.length; const pend = out.pend;
  const opt = o => `<option value="${esc(o.v)}">${esc(o.label)}</option>`;
  const select = p => { const groups = [...new Set(p.opts.map(o => o.group || ""))];
    return `<select class="in" data-pend="${esc(p.key)}"><option value="">Choose…</option>${groups.map(g => g ? `<optgroup label="${esc(g)}">${p.opts.filter(o => o.group === g).map(opt).join("")}</optgroup>` : p.opts.filter(o => !o.group).map(opt).join("")).join("")}</select>`; };
  openSheet(st, `<div class="sh-head"><h2 class="h">${esc(t.verb || "Import")}: ${esc(t.label)}</h2><button class="x" data-close aria-label="Close">×</button></div>
  <p class="hint" style="margin-top:-4px">${esc(st.name)} · nothing has changed yet</p>
  ${pend.length ? `<div class="banner warn">${pend.length} name${pend.length > 1 ? "s" : ""} to check before ${t.verb ? "continuing" : "importing"}. Each answer is checked against the whole file.</div>
    <div class="kv pendlist">${pend.map(p => `<div><span><b>${esc(p.q)}</b></span>${select(p)}</div>`).join("")}</div>
    ${pend.some(p => p.suggest) ? `<button class="btn btn-ghost" data-pendall>Use the closest match for ${pend.filter(p => p.suggest).length === pend.length ? "all" : "those with one"}</button>` : ""}` : ""}
  <div class="kpis" style="padding:0;margin:10px 0"><div class="kpi"><b>${out.adds}</b><span>to add</span></div><div class="kpi"><b>${out.updates}</b><span>to update</span></div><div class="kpi"><b>${out.skips.length}</b><span>skipped or unchanged</span></div><div class="kpi"><b style="${out.errors.length ? "color:var(--due)" : ""}">${out.errors.length}</b><span>rows with problems</span></div></div>
  ${out.errors.length ? `<label class="f">Problems · these rows won’t be imported</label><div class="kv">${out.errors.slice(0, 40).map(e => `<div><span>${e.line ? `Line ${e.line}` : "File"}</span><span style="text-align:right">${esc(e.msg)}</span></div>`).join("")}${out.errors.length > 40 ? `<div><span>…and ${out.errors.length - 40} more</span></div>` : ""}</div>` : ""}
  ${ok ? `<label class="f">Changes</label><div class="kv">${out.ops.slice(0, 60).map(o => `<div><span>${esc(o.what)}</span><span class="tag ${o.kind === "add" ? "t-paid" : "t-part"}">${o.kind === "add" ? "Add" : "Update"}</span></div>`).join("")}${ok > 60 ? `<div><span>…and ${ok - 60} more</span></div>` : ""}</div>` : ""}
  ${t.summary ? t.summary(out, st) : ""}
  ${out.skips.length ? `<label class="f">Skipped or unchanged</label><div class="kv">${out.skips.slice(0, 20).map(x => `<div><span>${esc(x)}</span></div>`).join("")}${out.skips.length > 20 ? `<div><span>…and ${out.skips.length - 20} more</span></div>` : ""}</div>` : ""}
  ${pend.length ? `<button class="btn btn-primary" disabled>Answer the ${pend.length} question${pend.length > 1 ? "s" : ""} above first</button>`
    : t.finish ? `<button class="btn btn-primary" data-act="applyImport" ${t.ready && !t.ready(out) ? "disabled" : ""}>${esc(t.finishLabel(out))}</button>`
    : ok ? `<button class="btn btn-primary" data-act="applyImport">Import ${ok} change${ok > 1 ? "s" : ""}${out.errors.length ? ` · skip ${out.errors.length} row${out.errors.length > 1 ? "s" : ""} with problems` : ""}</button>` : `<p class="hint">${out.errors.length ? "Nothing to import. Fix the rows above and try again." : "Nothing to change: the app already matches this file."}</p>`}`);
}
const replan = st => { st.out = T[st.k].plan(st.recs, st.dec, st); $sheetKeep(); drawPreview(st); };
const $sheetKeep = () => { const el = document.getElementById("sheet"); if (el) el.dataset.keep = "1"; };
A.applyImport = async el => {
  const st = ui.sheet; if (!st || st.kind !== "imp" || st.out.pend.length) return; const t = T[st.k]; if (!(t.finish ? R.can("stock.buy") : canImport())) return;
  el.disabled = true; el.textContent = "Saving…";
  let n = 0; for (const op of st.out.ops) { await op.run(); n++; }
  if (t.after) await t.after(st.out);
  sync.soon(); closeSheet(); if (t.finish) { t.finish(st.out, st); return; } toast(`${t.label}: ${n} change${n === 1 ? "" : "s"} imported`);
};

/* ---------- purchase invoice → GRN draft ---------- */
// Supplier invoices come in their own layout: find the header row (item, qty, amount…), read lines until a total row.
const INV = { item: /item|description|particular|product|material|goods|name/, qty: /^(qty|quantity|qnty|nos|no of)/, unit: /^(unit|uom|units)$/, rate: /rate|price|mrp/, amount: /taxable|amount|value|net|total/, tax: /gst|tax|igst/ };
const QTYU = /^\s*(\d+(?:\.\d+)?)\s*([a-z]+)?\s*$/i;
function invoiceLines(raw) {
  const rows = raw.map(r => r.map(c => String(c ?? "").trim()));
  const hi = rows.findIndex(r => r.some(c => INV.item.test(c.toLowerCase())) && r.some(c => INV.qty.test(c.toLowerCase())));
  if (hi < 0) return { error: "Couldn’t find a header row with an item and a quantity column. Use the invoice template, or paste the lines instead." };
  const h = rows[hi].map(c => c.toLowerCase()); const col = re => h.findIndex(c => re.test(c));
  const ci = { item: col(INV.item), qty: col(INV.qty), unit: col(INV.unit), rate: col(INV.rate), amount: (() => { const a = h.findIndex(c => /taxable|amount/.test(c)); return a >= 0 ? a : col(INV.amount); })(), tax: h.findIndex(c => INV.tax.test(c) && /%|rate/.test(c)) };
  const out = [];
  for (let i = hi + 1; i < rows.length; i++) { const r = rows[i]; const name = r[ci.item] || ""; if (!name) continue; if (/^(sub ?total|total|grand total|round|cgst|sgst|igst|tax)/i.test(name)) break;
    const qm = QTYU.exec(r[ci.qty] || ""); if (!qm) continue; const q = +qm[1]; const unit = (ci.unit >= 0 && r[ci.unit]) || qm[2] || "";
    const rate = ci.rate >= 0 ? numOr(r[ci.rate]) : null, amt = ci.amount >= 0 ? numOr(r[ci.amount]) : null, tax = ci.tax >= 0 ? numOr(String(r[ci.tax]).replace("%", "")) : null;
    out.push({ line: i + 1, item: name, qty: q, unit, amount: amt != null && !Number.isNaN(amt) ? amt : (rate != null && !Number.isNaN(rate) ? r4(rate * q) : 0), tax: tax != null && !Number.isNaN(tax) ? tax : null }); }
  return { recs: out };
}
// Pasted text from a PDF or message, read from the end of each line: the last number is the amount; the quantity is the number before it,
// or, with three numbers at the end, the first of a quantity × rate = amount pair. Pack sizes inside names ("Maida 50kg bag") stay in the name.
const UNITW = /^(kg|kgs|g|gm|gms|grams?|l|ltr|litres?|liters?|ml|pcs|pc|pieces?|nos|no)$/i;
const NUMW = /^\d[\d,]*(?:\.\d+)?$/; const GLUED = /^(\d+(?:\.\d+)?)(kg|kgs|g|gm|gms|l|ltr|ml|pcs|pc|nos)$/i;
function pastedLines(text) {
  const out = [];
  text.split(/\r?\n/).forEach((ln, li) => { const l = ln.replace(/₹|rs\.?(?=\s|\d)/gi, " ").replace(/[|\t]/g, " ").trim(); if (!l || /^(sub ?total|total|grand|gst|cgst|sgst|igst|invoice|date|bill|tax)/i.test(l)) return;
    const w = l.split(/\s+/); const items = []; let i = w.length - 1;
    while (i >= 0 && items.length < 3) { const x = w[i];
      if (UNITW.test(x) && i > 0 && NUMW.test(w[i - 1])) { items.unshift({ n: +w[i - 1].replace(/,/g, ""), u: x, at: i - 1 }); i -= 2; }
      else if (NUMW.test(x)) { items.unshift({ n: +x.replace(/,/g, ""), u: "", at: i }); i--; }
      else if (GLUED.test(x)) { const m = GLUED.exec(x); items.unshift({ n: +m[1], u: m[2], at: i }); i--; }
      else break; }
    if (items.length < 2) return; const amt = items[items.length - 1];
    let q = items[items.length - 2]; if (items.length === 3 && Math.abs(items[0].n * items[1].n - amt.n) <= 0.02 * amt.n) q = items[0];
    const name = w.slice(0, q.at).join(" ").replace(/[-–:]+$/, "").trim(); if (!/[a-z]/i.test(name)) return;
    out.push({ line: li + 1, item: name, qty: q.n, unit: q.u, amount: amt.n, tax: null }); });
  return out;
}
// Text with columns (PDF text keeps gaps between columns; pasted spreadsheet cells are tab-separated): read it as a table when a header row is found, else line by line.
// Text recognition often reads a lone 1 as i, l, I or |, and 0 as O inside numbers; fix those before reading quantities.
const fixOcr = t => t.split("\n").map(l => l.replace(/(^|\s)[il|I](?=\s+\d)/g, "$11").replace(/(\d)[oO](?=\d|\b)/g, "$10").replace(/\b[oO](\d)/g, "0$1")).join("\n");
function linesFromText(text) { const r = invoiceLines(text.split(/\r?\n/).map(l => l.trim().split(/\t|\s{2,}/))); return !r.error && r.recs.length ? r.recs : pastedLines(text); }
T.invoice = { label: "Purchase invoice", verb: "Read", hidden: true,
  plan(recs, dec, st) { const out = newPlan(dec); const ings = M.ingredients().filter(i => i.type !== "sf"); const made = {}; out.lines = [];
    recs.forEach(r => { const uu = r.unit ? unitIn(r.unit) : null; if (r.unit && !uu) return out.err(r, `Unit “${r.unit}” for ${r.item} isn’t g, kg, ml, L or pcs`);
      const m = askMaterial(out, r.item, uu ? uu[0] : "", ings, made, `${r.qty}${r.unit ? " " + r.unit : ""}`, ["rm", "pm"]); if (m === undefined) return; if (!m) return out.skip(`${r.item} skipped`);
      // No unit on the invoice: read the quantity in the item's larger unit (kg, L) or pieces.
      const [u, f] = uu || [m.unit, (BIG[m.unit] || [m.unit, 1])[1]]; if (u !== m.unit) return out.err(r, `${r.item}: ${m.name} is measured in ${m.unit}, the invoice says ${r.unit}`);
      out.lines.push({ ingId: m.id, name: m.name, from: r.item, qty: r.qty * f, f, amount: +r.amount || 0, taxPct: r.tax }); });
    return out; },
  summary: (out, st) => (st && st.text ? `<details class="ivtext"><summary>Text that was read · ${esc(st.how === "pdf" ? "from the PDF" : st.how === "paste" ? "pasted" : "by text recognition")}</summary><pre class="billbox">${esc(st.text.trim())}</pre><button class="btn btn-ghost" data-invedit>Fix the text and read again</button></details>` : "") + (out.lines.length ? `<label class="f">GRN draft · ${out.lines.length} line${out.lines.length > 1 ? "s" : ""}</label><div class="kv">${out.lines.map(l => { const i = M.ingMap()[l.ingId]; return `<div><span>${esc(l.name)}${norm(l.from) !== norm(l.name) ? ` <small class="mut">from “${esc(l.from)}”</small>` : ""}</span><span>${i ? esc(qtyText(l.qty, i)) : l.qty} · ₹${l.amount}</span></div>`; }).join("")}</div>` : ""),
  ready: out => out.lines.length > 0,
  finishLabel: out => `Open GRN with ${out.lines.length} line${out.lines.length === 1 ? "" : "s"}`,
  finish: (out, st) => { H.grnSheet && H.grnSheet({ supplier: st.supplier, invoiceNo: st.invoiceNo, lines: out.lines }); toast("Check the GRN and save it to add the stock"); } };
const qtyText = (q, i) => { const [u, f] = BIG[i.unit] || [i.unit, 1]; return `${r4(q / f)} ${u}`; };
// opts: { text, supplier, invoiceNo } to come back to the sheet with what was read, for editing.
A.invoiceIn = async (el, e, opts = {}) => { if (!R.can("stock.buy")) return toast("Your role can’t record purchases.");
  const key = await getKey(); const st = { kind: "invin", redraw: () => A.invoiceIn(null, null, { ...invMeta(), text: (document.getElementById("ivText") || {}).value || "" }) };
  openSheet(st, `<div class="sh-head"><h2 class="h">Purchase invoice</h2><button class="x" data-close aria-label="Close">×</button></div>
  <p class="hint" style="margin-top:-4px">Take a photo of the bill, or load the supplier’s PDF or Excel. Items the app doesn’t know are matched to inventory (and remembered), then a GRN opens for you to check and save.</p>
  <div class="two"><div><label class="f" for="ivSup">Supplier</label><input class="in" id="ivSup" list="ivsups" placeholder="Name (read from the bill if blank)" value="${esc(opts.supplier || "")}"><datalist id="ivsups">${M.suppliers().map(x => `<option value="${esc(x.name)}">`).join("")}</datalist></div><div><label class="f" for="ivNo">Invoice no.</label><input class="in" id="ivNo" placeholder="Optional" value="${esc(opts.invoiceNo || "")}"></div></div>
  <label class="btn btn-primary" style="margin-top:14px">${ICON.inbox}Take a photo or choose a PDF<input type="file" accept="image/*,application/pdf" data-invimg hidden></label>
  ${key ? `<label class="chkline"><input type="checkbox" id="ivClaude" checked> Read with Claude <small class="mut">(better for photos and crumpled or handwritten bills)</small></label>` : `<p class="hint">Photos are read on this phone. For hard-to-read photos, add a Claude API key below.</p>`}
  <p class="hint ivstatus" id="ivStatus" role="status"></p>
  <label class="btn btn-ghost">Choose Excel or CSV invoice<input type="file" accept=".csv,text/csv,.xlsx" data-invfile hidden></label>
  <label class="f" for="ivText">Or paste the item lines</label><textarea class="in" id="ivText" style="height:140px" placeholder="Amul Butter 500g   4 kg   2200&#10;Maida 50kg bag   1   1850&#10;6pc box   100 pcs   1000">${esc(opts.text || "")}</textarea>
  <button class="btn btn-ghost" data-invpaste>Read pasted lines</button>
  <details class="ivclaude"><summary>Claude reading for photos and PDFs · ${key ? "on for this device" : "off"}</summary>
    <p class="hint">Claude (Anthropic) reads the photo or PDF and returns the item lines. You need your own API key from console.anthropic.com; each invoice costs a few rupees on your Anthropic account. The key is kept only on this device, never synced, and anyone using this device can use it. The photo is sent to Anthropic to be read.</p>
    ${key ? `<div class="kv"><div><span>Key</span><span>${esc(key.slice(0, 10))}…${esc(key.slice(-4))}</span></div></div><button class="btn btn-danger" data-invkeyrm>Remove the key from this device</button>`
      : `<input class="in" id="ivKey" type="password" placeholder="sk-ant-…" autocomplete="off" autocapitalize="off"><button class="btn btn-ghost" data-invkey>Save key on this device</button>`}</details>
  <button class="btn btn-ghost" data-tpl="invoice">Download an invoice template</button>`); };
T.invoice.cols = [{ label: "Item" }, { label: "Qty" }, { label: "Unit" }, { label: "Rate" }, { label: "Amount" }, { label: "GST %" }];
T.invoice.notes = ["Any supplier layout works if it has a header row with an item and a quantity column. Reading stops at a Total row.", "Unit: g, kg, ml, L or pcs; blank = kg, L or pcs for that item. Amount is before tax; blank = Qty × Rate."];
T.invoice.ex = ["Amul Butter 500g", 4, "kg", 550, 2200, 12];
const invMeta = () => ({ supplier: (document.getElementById("ivSup") || {}).value || "", invoiceNo: (document.getElementById("ivNo") || {}).value || "" });

H.click.push(async T0 => {
  const ex = T0.closest("[data-exp]"); if (ex) { if (!canExport()) return true; const t = T[ex.dataset.exp]; download(fileName(ex.dataset.exp, "export"), [t.cols.map(c => c.label), ...t.rows()]); toast(`${t.label} exported`); return true; }
  const tp = T0.closest("[data-tpl]"); if (tp) { const t = T[tp.dataset.tpl];
    download(fileName(tp.dataset.tpl, "template"), [[`# Batchwala template: ${t.label}. Lines starting with # are ignored. Fill one row per record under the header line.`], ...t.notes.map(n => ["# " + n]), ["# Example: " + t.ex.join(" | ")], t.cols.filter(c => !c.out).map(c => c.label)]);
    toast(`${t.label} template downloaded`); return true; }
  if (T0.closest("[data-invkey]")) { const k = ((document.getElementById("ivKey") || {}).value || "").trim(); if (!/^sk-ant-/.test(k)) { toast("That doesn’t look like a Claude API key (it starts with sk-ant-)"); return true; }
    await setKey(k); toast("Key saved on this device"); ui.sheet.redraw(); return true; }
  if (T0.closest("[data-invkeyrm]")) { await setKey(""); toast("Key removed from this device"); ui.sheet.redraw(); return true; }
  if (T0.closest("[data-invedit]")) { const st = ui.sheet; A.invoiceIn(null, null, { text: st.text, supplier: st.supplier, invoiceNo: st.invoiceNo }); return true; }
  if (T0.closest("[data-invpaste]")) { const recs = linesFromText((document.getElementById("ivText") || {}).value || ""); if (!recs.length) { toast("No item lines found. Each line needs a name and a quantity."); return true; }
    startImport("invoice", recs, "Pasted lines", { ...invMeta(), text: (document.getElementById("ivText") || {}).value || "", how: "paste" }); return true; }
  const st = ui.sheet;
  if (st && st.kind === "imp" && T0.closest("[data-pendall]")) { st.out.pend.forEach(p => { if (p.suggest) st.dec[p.key] = p.suggest; }); replan(st); return true; }
  return false;
});
H.change.push(async T0 => {
  const st = ui.sheet;
  if (st && st.kind === "imp" && T0.dataset && T0.dataset.pend != null) { if (T0.value) { st.dec[T0.dataset.pend] = T0.value; replan(st); } return true; }
  if (T0.dataset && T0.dataset.invimg != null) { const f = T0.files && T0.files[0]; T0.value = ""; if (!f) return true; const meta = invMeta();
    const useClaude = !!(document.getElementById("ivClaude") || {}).checked; const status = t => { const el = document.getElementById("ivStatus"); if (el) el.textContent = t; };
    if (!isPdf(f) && !/^image\//.test(f.type)) { toast("Choose a photo or a PDF"); return true; }
    try {
      if (useClaude) {
        const r = await claudeRead(f, await getKey(), status);
        const recs = (r.lines || []).map((l, i) => ({ line: i + 1, item: String(l.item || "").trim(), qty: +l.qty || 0, unit: String(l.unit || "").trim(), amount: +l.amount || 0, tax: +l.tax_pct >= 0 ? +l.tax_pct : null })).filter(x => x.item && x.qty > 0);
        if (!recs.length) { status("Claude found no item lines on this file."); return true; }
        startImport("invoice", recs, `${f.name} · read by Claude`, { supplier: meta.supplier || r.supplier || "", invoiceNo: meta.invoiceNo || r.invoice_no || "" });
      } else {
        const read = await readText(f, status); const how = read.how; const text = how === "ocr" ? fixOcr(read.text) : read.text; const ta = document.getElementById("ivText"); if (ta) ta.value = text.trim();
        const recs = linesFromText(text);
        if (!recs.length) { status(`Read the ${how === "pdf" ? "PDF’s text" : "photo"}, but found no item lines with a quantity and amount. Fix the text below, then tap Read pasted lines.`); return true; }
        startImport("invoice", recs, `${f.name} · ${how === "pdf" ? "PDF text" : "text recognition"}`, { ...meta, text, how });
      }
    } catch (e) { status(""); toast(e.message || "Couldn’t read that file"); }
    return true; }
  if (T0.dataset && T0.dataset.invfile != null) { const f = T0.files && T0.files[0]; T0.value = ""; if (!f) return true; const meta = invMeta();
    try { const { recs, error } = invoiceLines(await readFile(f)); if (error) { toast(error); return true; } if (!recs.length) { toast("No item lines found under the header"); return true; } startImport("invoice", recs, f.name, meta); }
    catch (e) { toast(e.message || "Couldn’t read that file"); } return true; }
  if (!T0.dataset || T0.dataset.imp == null) return false; const k = T0.dataset.imp; const f = T0.files && T0.files[0]; T0.value = ""; if (!f || !canImport()) return true;
  try { const raw = await readFile(f); const { recs, error } = toRecords(raw, T[k].cols.filter(c => !c.out)); if (error) { toast(error); return true; }
    if (!recs.length) { toast("No rows under the header line"); return true; } startImport(k, recs, f.name); }
  catch (e) { toast(e.message || "Couldn’t read that file"); }
  return true;
});
