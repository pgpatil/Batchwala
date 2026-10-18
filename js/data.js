// Import & export by data type: CSV export of what's in the app, a template per type, and import with a check screen before anything changes.
import * as ev from "./events.js";
import * as sync from "./sync.js";
import * as M from "./model.js";
import * as R from "./roles.js";
import { S, A, V, H, band, clean, saveOrder } from "./core.js";
import { putMove } from "./inventory.js";
import { esc, uid, today, ICON } from "./util.js";
import { ui, toast, openSheet, closeSheet } from "./ui.js";

/* ---------- CSV ---------- */
// Spreadsheet apps run cells starting with = + - @ as formulas; text like that is prefixed with ' (numbers are left alone).
const cell = v => { let s = v == null ? "" : String(v); if (typeof v !== "number" && /^[=+\-@]/.test(s)) s = "'" + s; return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
function download(name, rows) {
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
const memberName = id => (ev.get("members", id) || {}).name || "";

/* ---------- data types ---------- */
// cols: k = key, label = column header, req = required on import. notes: template guidance. ex: example row for the template (written as a # note).
const T = {
  menu: { label: "Menu items", icon: "menu", desc: "Prices, categories, short names, keep-ready levels, tax rate.",
    cols: [{ k: "name", label: "Name", req: true }, { k: "category", label: "Category" }, { k: "price", label: "Price" }, { k: "tax", label: "Tax %" }, { k: "par", label: "Keep ready" }, { k: "aliases", label: "Short names" }, { k: "active", label: "On sale" }],
    notes: ["Matched by Name: existing items are updated, new ones added.", "Tax % blank = the default rate. On sale: Yes or No (blank = Yes). Short names: comma separated, in quotes."],
    ex: ["Paneer Strudel", "Savoury", 120, 5, 6, "strudel, ps", "Yes"],
    count: () => M.menu().length,
    rows: () => M.menu().map(m => [m.name, m.category, m.price, m.taxPct ?? "", m.par || "", m.aliases, m.active !== false ? "Yes" : "No"]),
    plan(recs) { const out = newPlan(); const menu = M.menu(); const seen = new Set();
      recs.forEach(r => { const name = r.name.trim(); if (!name) return out.err(r, "Name is blank"); if (seen.has(name.toLowerCase())) return out.err(r, `${name} appears twice`); seen.add(name.toLowerCase());
        const price = numOr(r.price), tax = numOr(r.tax), par = numOr(r.par, 0); if ([price, tax, par].some(Number.isNaN)) return out.err(r, "Price, Tax % and Keep ready must be numbers");
        const ex = byName(menu, name); if (!ex && price == null) return out.err(r, `${name} is new and needs a Price`);
        const rec = { ...(ex ? clean(ex) : { id: uid("m"), recipe: [], sort: menu.length + out.adds + 1 }), name, category: r.category || (ex ? ex.category : ""), price: price ?? ex.price, par,
          aliases: r.aliases || (ex ? ex.aliases : ""), active: r.active === "" ? (ex ? ex.active !== false : true) : yes(r.active), taxPct: r.tax === "" ? (ex ? ex.taxPct ?? null : null) : tax };
        out.upsert(ex, rec, name, () => ev.put("menu", rec)); });
      return out; } },
  materials: { label: "Materials", icon: "stock", desc: "Raw materials, packing and semi-finished: unit, reorder level, price, supplier, tax.",
    cols: [{ k: "name", label: "Name", req: true }, { k: "type", label: "Type" }, { k: "unit", label: "Unit" }, { k: "reorder", label: "Reorder level" }, { k: "price", label: "Price per unit" }, { k: "supplier", label: "Supplier" }, { k: "barcode", label: "Barcode" }, { k: "tax", label: "Tax %" }, { k: "taxcost", label: "Purchase tax in cost" }, { k: "yield", label: "Yield per run" }],
    notes: ["Matched by Name. Type: RM, PM or Semi-finished (blank = RM). Unit: g, kg, ml, L or pcs; Reorder level, Price per unit and Yield per run are in that unit.", "Price is used until a GRN or purchase is recorded. Purchase tax in cost: Yes = tax paid is added to cost; No = recoverable. Yield per run is for semi-finished items; give their recipe in the BOM import."],
    ex: ["Maida", "RM", "kg", 5, 45, "Sharma Traders", "", 5, "No", ""],
    count: () => M.ingredients().length,
    rows: () => M.ingredients().map(i => { const [u, f] = BIG[i.unit] || [i.unit, 1]; return [i.name, { rm: "RM", pm: "PM", sf: "Semi-finished" }[i.type], u, i.reorder ? r4(i.reorder / f) : "", r4(M.unitCost(i) * f) || "", i.supplier, i.barcode, i.taxPct ?? "", i.taxInCost ? "Yes" : "No", i.type === "sf" && i.yield ? r4(i.yield / f) : ""]; }),
    plan(recs) { const out = newPlan(); const ings = M.ingredients(); const seen = new Set();
      recs.forEach(r => { const name = r.name.trim(); if (!name) return out.err(r, "Name is blank"); if (seen.has(name.toLowerCase())) return out.err(r, `${name} appears twice`); seen.add(name.toLowerCase());
        const ex = byName(ings, name); const type = r.type ? TYPE_IN[r.type.trim().toLowerCase()] : (ex ? ex.type : "rm"); if (!type) return out.err(r, `Type “${r.type}” isn’t RM, PM or Semi-finished`);
        const uu = r.unit ? unitIn(r.unit) : [ex ? ex.unit : "g", ex && BIG[ex.unit] ? BIG[ex.unit][1] : 1]; if (!uu) return out.err(r, `Unit “${r.unit}” isn’t g, kg, ml, L or pcs`);
        const [unit, f] = uu; if (ex && ex.unit !== unit && (M.stockMap()[ex.id] || 0)) return out.err(r, `${name} has stock in ${ex.unit}; its unit can’t change to ${unit}`);
        const reorder = numOr(r.reorder), price = numOr(r.price), tax = numOr(r.tax), y = numOr(r.yield); if ([reorder, price, tax, y].some(Number.isNaN)) return out.err(r, "Reorder level, Price, Tax % and Yield must be numbers");
        const rec = { ...(ex ? clean(ex) : { id: uid("i"), recipe: [], barcode: "", supplier: "" }), name, type, unit, reorder: reorder != null ? reorder * f : (ex ? ex.reorder : 0), cost: price != null ? price / f : (ex ? ex.cost : 0),
          supplier: r.supplier || (ex ? ex.supplier : ""), barcode: r.barcode || (ex ? ex.barcode : ""), taxPct: r.tax === "" ? (ex ? ex.taxPct ?? null : null) : tax, taxInCost: r.taxcost === "" ? !!(ex && ex.taxInCost) : yes(r.taxcost),
          yield: type === "sf" ? (y != null ? y * f : (ex ? ex.yield : 0)) : 0 };
        if (type !== "sf") rec.recipe = [];
        out.upsert(ex, rec, name, () => ev.put("ingredients", rec)); });
      return out; } },
  bom: { label: "BOM", icon: "tree", desc: "What goes into each menu item (per piece) and each semi-finished item (per run).",
    cols: [{ k: "parent", label: "Parent", req: true }, { k: "ptype", label: "Parent type" }, { k: "component", label: "Component", req: true }, { k: "qty", label: "Qty", req: true }, { k: "unit", label: "Unit" }],
    notes: ["One row per component. Parent = a menu item (Qty per piece) or a semi-finished material (Qty per run). Parent type: Menu item or Semi-finished (blank = whichever matches the name).", "Each parent listed gets exactly the rows given: its old BOM is replaced. Components must already exist as materials. Unit: g, kg, ml, L or pcs (blank = the component’s unit)."],
    ex: ["Paneer Strudel", "Menu item", "Paneer", 40, "g"],
    count: () => M.menu().filter(m => (m.recipe || []).length).length + M.ingredients().filter(i => i.recipe.length).length,
    rows: () => { const ings = M.ingMap(); const out = [];
      M.menu().forEach(m => (m.recipe || []).forEach(r => { const i = ings[r.ingId]; if (i) out.push([m.name, "Menu item", i.name, r4(r.qty), i.unit]); }));
      M.ingredients().filter(x => x.type === "sf").forEach(x => x.recipe.forEach(r => { const i = ings[r.ingId]; if (i) out.push([x.name, "Semi-finished", i.name, r4(r.qty), i.unit]); })); return out; },
    plan(recs) { const out = newPlan(); const menu = M.menu(), ings = M.ingredients(); const groups = new Map();
      recs.forEach(r => { const pn = r.parent.trim(); const pt = r.ptype.trim().toLowerCase();
        const m = pt.startsWith("semi") ? null : byName(menu, pn); const s = pt.startsWith("menu") ? null : byName(ings.filter(i => i.type === "sf"), pn);
        const parent = m ? { kind: "menu", x: m } : s ? { kind: "sf", x: s } : null;
        if (!parent) return out.err(r, `“${pn}” isn’t a menu item or semi-finished material`);
        const c = byName(ings, r.component); if (!c) return out.err(r, `Component “${r.component}” isn’t a material. Import materials first.`);
        const q = numOr(r.qty); if (q == null || Number.isNaN(q) || q <= 0) return out.err(r, "Qty must be more than 0");
        const uu = r.unit ? unitIn(r.unit) : [c.unit, 1]; if (!uu || uu[0] !== c.unit) return out.err(r, `${c.name} is measured in ${c.unit}; “${r.unit}” doesn’t fit`);
        const key = parent.kind + ":" + parent.x.id; const g = groups.get(key) || { ...parent, lines: [] }; g.lines.push({ ingId: c.id, qty: q * uu[1] }); groups.set(key, g); });
      groups.forEach(g => { if (g.kind === "sf" && M.makesCycle(g.x.id, g.lines)) { out.errors.push({ line: "", msg: `${g.x.name}’s recipe would use itself` }); return; }
        out.put("update", `${g.x.name}: ${g.lines.length} line${g.lines.length > 1 ? "s" : ""}`, () => ev.put(g.kind === "menu" ? "menu" : "ingredients", { ...clean(g.x), recipe: g.lines })); });
      return out; } },
  stock: { label: "Stock count (materials)", icon: "stock", desc: "Opening stock or a stock-take: sets each material’s quantity at a location.",
    cols: [{ k: "material", label: "Material", req: true }, { k: "location", label: "Location" }, { k: "qty", label: "Quantity", req: true }, { k: "unit", label: "Unit" }],
    notes: ["Sets the quantity on hand (a count), recorded as a stock-count entry. Location blank = the first location.", "Unit: g, kg, ml, L or pcs (blank = the material’s unit)."],
    ex: ["Maida", "Central kitchen", 25, "kg"],
    count: () => M.ingredients().length,
    rows: () => { const out = []; M.locations().forEach(l => { const sm = M.stockMap(l.id); M.ingredients().forEach(i => { const [u, f] = BIG[i.unit] || [i.unit, 1]; out.push([i.name, l.name, r4((sm[i.id] || 0) / f), u]); }); }); return out; },
    plan(recs) { const out = newPlan(); const ings = M.ingredients();
      recs.forEach(r => { const i = byName(ings, r.material); if (!i) return out.err(r, `“${r.material}” isn’t a material`); const l = locByName(r.location); if (!l) return out.err(r, `Location “${r.location}” doesn’t exist`);
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
      recs.forEach(r => { const m = byName(M.menu(), r.item); if (!m) return out.err(r, `“${r.item}” isn’t on the menu`); const l = locByName(r.location); if (!l) return out.err(r, `Location “${r.location}” doesn’t exist`);
        const q = numOr(r.qty); if (q == null || Number.isNaN(q) || q < 0 || q % 1) return out.err(r, "Pieces must be a whole number, 0 or more");
        const d = q - ((fg[l.id] || {})[m.name] || 0); if (!d) return out.skip(`${m.name} at ${l.name} already ${q}`);
        out.put("update", `${m.name} at ${l.name}: ${d > 0 ? "+" : ""}${d}`, () => ev.put("fg", { id: uid("f"), loc: l.id, item: m.name, qty: d, type: "count", date: today(), note: "Imported count" })); });
      return out; } },
  suppliers: { label: "Suppliers", icon: "inbox", desc: "Supplier names with phone and GSTIN.",
    cols: [{ k: "name", label: "Name", req: true }, { k: "phone", label: "Phone" }, { k: "gstin", label: "GSTIN" }],
    notes: ["Matched by Name: existing suppliers are updated."], ex: ["Sharma Traders", "9876543210", "27ABCDE1234F1Z5"],
    count: () => M.suppliers().length,
    rows: () => M.suppliers().map(s => [s.name, s.phone || "", s.gstin || ""]),
    plan(recs) { const out = newPlan(); const sup = M.suppliers();
      recs.forEach(r => { const name = r.name.trim(); if (!name) return out.err(r, "Name is blank"); const ex = byName(sup, name);
        const rec = { ...(ex ? clean(ex) : { id: uid("s") }), name, phone: r.phone || (ex ? ex.phone || "" : ""), gstin: (r.gstin || (ex ? ex.gstin || "" : "")).toUpperCase() };
        out.upsert(ex, rec, name, () => ev.put("suppliers", rec)); });
      return out; } },
  orders: { label: "Orders", icon: "orders", desc: "One row per item; rows with the same order number make one order.",
    cols: [{ k: "no", label: "Order #", req: true }, { k: "date", label: "Date", req: true }, { k: "customer", label: "Customer" }, { k: "flat", label: "Flat" }, { k: "phone", label: "Phone" }, { k: "channel", label: "Channel" }, { k: "status", label: "Status" }, { k: "item", label: "Item", req: true }, { k: "qty", label: "Qty", req: true }, { k: "rate", label: "Rate" }, { k: "tax", label: "Tax %" }, { k: "disc", label: "Offer %" }, { k: "paid", label: "Paid" }, { k: "mode", label: "Paid by" }, { k: "notes", label: "Notes" }],
    notes: ["Date as YYYY-MM-DD. Orders whose number is already in the app are skipped. Order details (customer, channel, status, offer, paid) are read from the order’s first row.", "Channel: WhatsApp, Phone, Instagram, Bulk / event, Other, Walk-in, Swiggy or Zomato. Status: Received, Confirmed, Ready, Delivered or Cancelled. Rate blank = menu price. Tax % blank = today’s rate. Paid = amount received for the whole order."],
    ex: ["1001", "2026-10-18", "Asha", "A-1201", "9876543210", "WhatsApp", "Delivered", "Paneer Strudel", 2, 120, 5, 0, 252, "UPI", ""],
    count: () => M.orders().length,
    rows: () => { const out = []; M.orders().sort((a, b) => a.date < b.date ? -1 : 1).forEach(o => o.items.forEach((i, ix) => out.push([o.no, o.date, o.customer, o.flat, o.phone, M.CHANNELS[o.channel] || o.channel, M.STATUS_LABEL[o.status] || o.status, i.item, i.qty, i.rate, i.taxPct ?? "", ix ? "" : o.discountPct || "", ix ? "" : M.received(o) || "", ix ? "" : M.lastPayMode(o), ix ? "" : o.notes]))); return out; },
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
        const paid = numOr(f.paid, 0), disc = numOr(f.disc, 0); if (Number.isNaN(paid) || Number.isNaN(disc)) return out.err(f, `Order ${no}: Paid and Offer % must be numbers`);
        const o = { id: uid("o"), no, date: f.date, customer: f.customer || M.CHANNELS[channel], flat: (f.flat || "").toUpperCase(), phone: f.phone || "", channel, status, items, discountPct: disc, notes: f.notes || "", tag: "", source: "import", createdAt: new Date().toISOString(), ...(status === "delivered" ? { deliveredAt: f.date + "T12:00:00.000Z" } : {}) };
        out.put("add", `Order ${no} · ${o.customer} · ${items.length} item${items.length > 1 ? "s" : ""}${paid ? ` · paid ${paid}` : ""}`, async () => { await saveOrder(o);
          if (paid > 0) await ev.put("payments", { id: uid("p"), orderId: o.id, customerKey: M.ckey(o), amount: Math.round(paid * 100) / 100, mode: f.mode || "", date: f.date, note: "Imported", businessId: M.config().businessId }); }); });
      return out; } },
  customers: { label: "Customers", icon: "people", desc: "Built from orders, so they’re export only; import orders to bring customers in.", exportOnly: true,
    cols: ["Customer", "Flat", "Phone", "Orders", "Spend", "Received", "Balance", "Last order"].map(label => ({ label })), count: () => M.customers().length,
    rows: () => M.customers().map(c => [c.customer, c.flat, c.phone, c.orders.length, c.spend, c.received, c.balance, c.last]) },
  payments: { label: "Payments", icon: "pay", desc: "Every payment and reversal.", exportOnly: true,
    cols: ["Date", "Order #", "Customer", "Amount", "Mode", "Note"].map(label => ({ label })), count: () => ev.all("payments").length,
    rows: () => { const byId = Object.fromEntries(M.orders().map(o => [o.id, o])); return ev.all("payments").sort((a, b) => a.date < b.date ? -1 : 1).map(p => { const o = byId[p.orderId] || {}; return [p.date, o.no || "", o.customer || "", p.amount, p.mode, p.note || ""]; }); } },
  batches: { label: "Batches", icon: "batch", desc: "Every batch with pieces, spoiled, prep and cost.", exportOnly: true,
    cols: ["Batch #", "Date", "Location", "Item or prep", "Pieces or runs", "Spoiled", "Batch cost", "Made by", "Note", "Status"].map(label => ({ label })), count: () => M.batches().length,
    rows: () => { const ings = M.ingMap(); const out = []; M.batches().slice().reverse().forEach(b => { const st = b.void ? "Undone" : "";
      b.lines.forEach((l, ix) => out.push([b.no, b.date, M.locName(b.outletId || M.locations()[0].id), l.item, l.qty, l.spoiled, ix ? "" : Math.round(M.batchCost(b) * 100) / 100, ix ? "" : memberName(b.madeBy || b._by), ix ? "" : b.notes, st]));
      b.prep.forEach(p => out.push([b.no, b.date, M.locName(b.outletId || M.locations()[0].id), (ings[p.ingId] || {}).name || "?", p.runs + " run(s)", "", "", "", "", st])); }); return out; } },
  grns: { label: "GRNs", icon: "inbox", desc: "Goods received, line by line, with tax.", exportOnly: true,
    cols: ["GRN", "Date", "Supplier", "Invoice", "Received at", "Material", "Qty", "Unit", "Amount", "Tax %", "Cost to stock", "Status"].map(label => ({ label })), count: () => M.grns().length,
    rows: () => { const ings = M.ingMap(); const out = []; M.grns().slice().reverse().forEach(g => g.lines.forEach(l => { const i = ings[l.ingId]; out.push([g.no, g.date, g.supplier, g.invoiceNo || "", M.locName(g.loc), i ? i.name : "?", l.qty, i ? i.unit : "", l.amount, l.taxPct || "", l.cost ?? l.amount, g.void ? "Undone" : ""]); })); return out; } },
  transfers: { label: "Transfers", icon: "truck", desc: "Sent and received quantities between locations.", exportOnly: true,
    cols: ["Transfer", "Date", "From", "To", "Item or material", "Sent", "Received", "Unit", "Status"].map(label => ({ label })), count: () => M.transfers().length,
    rows: () => { const ings = M.ingMap(); const out = []; M.transfers().slice().reverse().forEach(t => t.lines.forEach(l => { const i = l.ingId ? ings[l.ingId] : null;
      out.push([t.no, t.date, M.locName(t.from), M.locName(t.to), l.item || (i ? i.name : "?"), l.qty, M.xferReceived(t) ? (l.recv ?? l.qty) : "", l.item ? "pcs" : (i ? i.unit : ""), t.void ? "Undone" : M.xferReceived(t) ? (M.xferShort(t) ? "Received short" : "Received") : "In transit"]); })); return out; } }
};
function newPlan() {
  const out = { adds: 0, updates: 0, skips: [], errors: [], ops: [] };
  out.err = (r, msg) => { out.errors.push({ line: r.line, msg }); };
  out.skip = msg => { out.skips.push(msg); };
  // A record that would come out the same is reported as unchanged instead of written again.
  out.upsert = (ex, rec, what, run) => { const same = ex && JSON.stringify(Object.entries(clean(ex)).sort()) === JSON.stringify(Object.entries(clean(rec)).sort()); if (same) out.skip(`${what} unchanged`); else out.put(ex ? "update" : "add", what, run); };
  out.put = (kind, what, run) => { out[kind === "add" ? "adds" : "updates"]++; out.ops.push({ kind, what, run }); };
  return out;
}
const fileName = (k, kind) => `${(M.config().business || "bakery").replace(/[^\w]+/g, "_")}_${k}_${kind === "template" ? "template" : today()}.csv`;

/* ---------- screen ---------- */
const canExport = () => R.can("export"); const canImport = () => R.isAdmin();
V.data = () => {
  let h = band("Import & export", "", `<p class="bandnote">Export what’s in the app as CSV (opens in Excel or Google Sheets), download a template, or import a filled file. Imports show a check screen first.</p>`);
  return h + `<div class="datalist">${Object.entries(T).map(([k, t]) => `<div class="datacard"><div class="dc-head"><span class="ic">${ICON[t.icon] || ICON.dl}</span><div class="grow"><b>${esc(t.label)}</b><small>${esc(t.desc)}</small></div><span class="tag t-camp">${t.count()}</span></div>
    <div class="dc-btns">${canExport() ? `<button class="btn btn-ghost" data-exp="${k}">${ICON.dl}Export</button>` : ""}${t.exportOnly ? "" : `<button class="btn btn-ghost" data-tpl="${k}">Template</button>${canImport() ? `<label class="btn btn-primary">${ICON.inbox}Import<input type="file" accept=".csv,text/csv,.xlsx" data-imp="${k}" hidden></label>` : ""}`}</div></div>`).join("")}</div>
  ${!canImport() ? `<p class="hint" style="padding:0 4px">Only the admin can import.</p>` : ""}`;
};
A.data = () => { S.view = "data"; H.render(); window.scrollTo({ top: 0 }); };

async function readFile(file) {
  if (/\.xlsx$/i.test(file.name)) { if (!window.XLSX) throw new Error("Reading .xlsx needs internet the first time. Save the sheet as CSV instead.");
    const wb = window.XLSX.read(await file.arrayBuffer(), { type: "array" }); return window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: "" }); }
  return parseCSV(await file.text());
}
function previewSheet(k, out, name) {
  const t = T[k]; const ok = out.ops.length;
  openSheet({ kind: "imp", k, out }, `<div class="sh-head"><h2 class="h">Import: ${esc(t.label)}</h2><button class="x" data-close aria-label="Close">×</button></div>
  <p class="hint" style="margin-top:-4px">${esc(name)} · nothing has changed yet</p>
  <div class="kpis" style="padding:0;margin-bottom:10px"><div class="kpi"><b>${out.adds}</b><span>to add</span></div><div class="kpi"><b>${out.updates}</b><span>to update</span></div><div class="kpi"><b>${out.skips.length}</b><span>skipped</span></div><div class="kpi"><b style="${out.errors.length ? "color:var(--due)" : ""}">${out.errors.length}</b><span>rows with problems</span></div></div>
  ${out.errors.length ? `<label class="f">Problems · these rows won’t be imported</label><div class="kv">${out.errors.slice(0, 40).map(e => `<div><span>${e.line ? `Line ${e.line}` : "File"}</span><span style="text-align:right">${esc(e.msg)}</span></div>`).join("")}${out.errors.length > 40 ? `<div><span>…and ${out.errors.length - 40} more</span></div>` : ""}</div>` : ""}
  ${ok ? `<label class="f">Changes</label><div class="kv">${out.ops.slice(0, 60).map(o => `<div><span>${esc(o.what)}</span><span class="tag ${o.kind === "add" ? "t-paid" : "t-part"}">${o.kind === "add" ? "Add" : "Update"}</span></div>`).join("")}${ok > 60 ? `<div><span>…and ${ok - 60} more</span></div>` : ""}</div>` : ""}
  ${out.skips.length ? `<label class="f">Skipped</label><div class="kv">${out.skips.slice(0, 20).map(s => `<div><span>${esc(s)}</span></div>`).join("")}${out.skips.length > 20 ? `<div><span>…and ${out.skips.length - 20} more</span></div>` : ""}</div>` : ""}
  ${ok ? `<button class="btn btn-primary" data-act="applyImport">Import ${ok} change${ok > 1 ? "s" : ""}${out.errors.length ? ` · skip ${out.errors.length} row${out.errors.length > 1 ? "s" : ""} with problems` : ""}</button>` : `<p class="hint">${out.errors.length ? "Nothing to import. Fix the rows above and try again." : "Nothing to change: the app already matches this file."}</p>`}`);
}
A.applyImport = async el => {
  const st = ui.sheet; if (!st || st.kind !== "imp" || !canImport()) return; el.disabled = true; el.textContent = "Importing…";
  let n = 0; for (const op of st.out.ops) { await op.run(); n++; }
  sync.soon(); closeSheet(); toast(`${T[st.k].label}: ${n} change${n === 1 ? "" : "s"} imported`);
};

H.click.push(async T0 => {
  const ex = T0.closest("[data-exp]"); if (ex) { if (!canExport()) return true; const t = T[ex.dataset.exp]; download(fileName(ex.dataset.exp, "export"), [t.cols.map(c => c.label), ...t.rows()]); toast(`${t.label} exported`); return true; }
  const tp = T0.closest("[data-tpl]"); if (tp) { const t = T[tp.dataset.tpl];
    download(fileName(tp.dataset.tpl, "template"), [[`# Batchwala template: ${t.label}. Lines starting with # are ignored. Fill one row per record under the header line.`], ...t.notes.map(n => ["# " + n]), ["# Example: " + t.ex.join(" | ")], t.cols.map(c => c.label)]);
    toast(`${t.label} template downloaded`); return true; }
  return false;
});
H.change.push(async T0 => {
  if (!T0.dataset || T0.dataset.imp == null) return false; const k = T0.dataset.imp; const f = T0.files && T0.files[0]; T0.value = ""; if (!f || !canImport()) return true;
  try { const raw = await readFile(f); const { recs, error } = toRecords(raw, T[k].cols); if (error) { toast(error); return true; }
    if (!recs.length) { toast("No rows under the header line"); return true; } previewSheet(k, T[k].plan(recs), f.name); }
  catch (e) { toast(e.message || "Couldn’t read that file"); }
  return true;
});
