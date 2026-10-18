// Reading purchase invoices from PDFs and photos.
// Free, on this device: PDFs with a text layer are read directly (pdf.js); photos and scanned pages go through text recognition (Tesseract).
// Optional: Claude reads the photo or PDF and returns the item lines, using an API key kept on this device only.
// Libraries load from the CDN the first time they are needed, then the browser caches them.
import * as ev from "./events.js";

// Tests can point at a local mirror (localStorage "bw.cdn"), the same way "bw.testAdapter" points sync at a local folder.
const CDN = (() => { try { return localStorage.getItem("bw.cdn") || ""; } catch (_) { return ""; } })() || "https://cdn.jsdelivr.net/npm";
const PKG = { pdf: "pdfjs-dist@6.4.299", tess: "tesseract.js@7.0.0", core: "tesseract.js-core@7.0.0", eng: "@tesseract.js-data/eng@1.0.0", sdk: "@anthropic-ai/sdk@0.131.0" };
const MODEL = "claude-opus-5-5";

export const isPdf = f => f.type === "application/pdf" || /\.pdf$/i.test(f.name);

/* ---------- images ---------- */
// Photos are scaled to at most 2000 px on the long side and re-encoded as JPEG: smaller uploads, and any phone format the browser can show becomes one Claude and Tesseract accept.
async function toCanvas(file, max = 2000) {
  const url = URL.createObjectURL(file); const img = new Image(); img.src = url;
  try { await img.decode(); } finally { URL.revokeObjectURL(url); }
  const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight)); const c = document.createElement("canvas");
  c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s); c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); return c;
}
const canvasB64 = c => c.toDataURL("image/jpeg", 0.9).split(",")[1];
const fileB64 = file => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = () => rej(r.error); r.readAsDataURL(file); });

/* ---------- PDF ---------- */
// The legacy build carries polyfills, so it also runs on phones whose browsers are a few versions behind.
async function pdfjs() { const lib = await import(`${CDN}/${PKG.pdf}/legacy/build/pdf.min.mjs`); lib.GlobalWorkerOptions.workerSrc = `${CDN}/${PKG.pdf}/legacy/build/pdf.worker.min.mjs`; return lib; }
// Text of a PDF, one line per row: pieces at the same height are joined left to right, with double spaces between columns.
async function pdfDoc(file) { const lib = await pdfjs(); return lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise; }
async function pdfText(doc) {
  const lines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent(); const rows = [];
    tc.items.forEach(it => { if (!it.str || !it.str.trim()) return; const x = it.transform[4], y = it.transform[5];
      let r = rows.find(r => Math.abs(r.y - y) < Math.max(2, (it.height || 8) * 0.5)); if (!r) rows.push(r = { y, parts: [] }); r.parts.push({ x, s: it.str.trim() }); });
    rows.sort((a, b) => b.y - a.y).forEach(r => lines.push(r.parts.sort((a, b) => a.x - b.x).map(p => p.s).join("  ")));
  }
  return lines.join("\n");
}
async function pdfPages(doc, max = 4) {
  const out = [];
  for (let p = 1; p <= Math.min(doc.numPages, max); p++) { const page = await doc.getPage(p); const vp = page.getViewport({ scale: 2 });
    const c = document.createElement("canvas"); c.width = vp.width; c.height = vp.height; await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise; out.push(c); }
  return out;
}

/* ---------- on-device text recognition ---------- */
async function ocr(images, onStep) {
  const Tesseract = (await import(`${CDN}/${PKG.tess}/dist/tesseract.esm.min.js`)).default;
  const worker = await Tesseract.createWorker("eng", 1, { workerPath: `${CDN}/${PKG.tess}/dist/worker.min.js`, corePath: `${CDN}/${PKG.core}`, langPath: `${CDN}/${PKG.eng}/4.0.0_best_int`,
    logger: m => { if (onStep && m.status === "recognizing text") onStep(`Reading text… ${Math.round(m.progress * 100)}%`); } });
  try { let text = ""; for (const img of images) text += (await worker.recognize(img)).data.text + "\n"; return text; }
  finally { await worker.terminate(); }
}
// Text from a PDF or photo without any account: the PDF's own text when it has some, otherwise recognised from the page images.
export async function readText(file, onStep = () => {}) {
  if (isPdf(file)) {
    onStep("Opening PDF…"); const doc = await pdfDoc(file); const text = await pdfText(doc);
    if (text.replace(/\s/g, "").length > 40) return { text, how: "pdf" };
    onStep("Scanned PDF: preparing pages…"); return { text: await ocr(await pdfPages(doc), onStep), how: "ocr" };
  }
  onStep("Preparing photo…"); return { text: await ocr([await toCanvas(file)], onStep), how: "ocr" };
}

/* ---------- Claude ---------- */
export const getKey = async () => (await ev.getMeta("claudeKey")) || "";
export const setKey = k => ev.setMeta("claudeKey", k || "");
const LINE = { type: "object", additionalProperties: false, required: ["item", "qty", "unit", "amount", "tax_pct"], properties: {
  item: { type: "string", description: "Item name exactly as written on the invoice" },
  qty: { type: "number", description: "Quantity bought" },
  unit: { type: "string", description: "One of kg, g, L, ml, pcs, or empty if the invoice gives none" },
  amount: { type: "number", description: "Line amount in rupees before tax; the shown line amount if tax is not separated" },
  tax_pct: { type: "number", description: "GST or tax percent for this line, or -1 if not shown" } } };
const SCHEMA = { type: "object", additionalProperties: false, required: ["supplier", "invoice_no", "invoice_date", "lines"], properties: {
  supplier: { type: "string" }, invoice_no: { type: "string" }, invoice_date: { type: "string", description: "YYYY-MM-DD, or empty" }, lines: { type: "array", items: LINE } } };
const PROMPT = `This is a supplier's purchase invoice, bill or receipt for a bakery. List every item that was bought, one entry per line item, in the order shown.
Use the item name as written. Give the quantity as a number and its unit as kg, g, L, ml or pcs (empty if none is shown; read "nos" as pcs).
Leave out totals, sub-totals, tax lines, discounts, round-off, delivery charges and anything that is not a purchased item.
If a value can't be read, make the best reading you can rather than leaving the item out. Also give the supplier's name, the invoice number and the invoice date.`;
// Returns { supplier, invoice_no, invoice_date, lines: [{ item, qty, unit, amount, tax_pct }] }.
export async function claudeRead(file, key, onStep = () => {}) {
  onStep("Preparing the file…");
  const block = isPdf(file) ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: await fileB64(file) } }
    : { type: "image", source: { type: "base64", media_type: "image/jpeg", data: canvasB64(await toCanvas(file)) } };
  onStep("Loading…"); const sdk = await import(`${CDN}/${PKG.sdk}/+esm`); const Anthropic = sdk.default;
  const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
  onStep("Claude is reading the invoice…");
  let resp;
  try {
    resp = await client.beta.messages.create({ model: MODEL, max_tokens: 16000, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
      messages: [{ role: "user", content: [block, { type: "text", text: PROMPT }] }] });
  } catch (e) {
    if (e instanceof sdk.AuthenticationError) throw new Error("The Claude API key wasn’t accepted. Check it in this sheet.");
    if (e instanceof sdk.PermissionDeniedError) throw new Error("This API key isn’t allowed to use Claude. Check the key’s workspace.");
    if (e instanceof sdk.RateLimitError) throw new Error("Claude is busy for this key right now. Try again in a minute.");
    if (e instanceof sdk.BadRequestError) throw new Error(`Claude couldn’t take this file: ${e.message}`);
    if (e instanceof sdk.APIConnectionError) throw new Error("Couldn’t reach Claude. Check the internet connection.");
    throw e;
  }
  if (resp.stop_reason === "refusal") throw new Error("Claude declined to read this file. Try the free reading instead.");
  if (resp.stop_reason === "max_tokens") throw new Error("The invoice was too long to read in one go. Try one page at a time.");
  const text = resp.content.filter(b => b.type === "text").map(b => b.text).join("");
  return JSON.parse(text);
}
