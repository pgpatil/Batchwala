// Help: one topic per screen and module, searchable, opened on the topic for the screen you came from.
import * as R from "./roles.js";
import { S, A, V, H } from "./core.js";
import { esc, ICON } from "./util.js";

// view: the screen the topic describes (for "Open" and for opening Help in context). Bodies are trusted static HTML.
const TOPICS = [
  { id: "start", title: "Getting started", tags: "first run setup install home screen", body: `
    <p>Batchwala keeps orders, the counter, baking, stock, purchases and money for a bakery in one app. It runs in the browser on a phone, tablet or computer and keeps working offline.</p>
    <ol><li><b>Start fresh</b> with your name and the business name. You become Admin.</li>
    <li>In <b>More → Business settings</b> add your logo, UPI ID, tax and locations.</li>
    <li>Add your <b>menu</b> (Menu & recipes) and <b>materials</b> (Inventory), or load them in one go from <b>Import & export</b> using the templates.</li>
    <li>Give each item a <b>BOM</b> so batches take stock and show cost.</li>
    <li>Add your team in <b>Users & roles</b>.</li></ol>
    <p>Install it: in Chrome, menu → <i>Install app</i>; on iPhone, Share → <i>Add to Home Screen</i>.</p>` },
  { id: "modes", title: "Roles, modes and locations", tags: "admin management manager kitchen delivery counter restaurant erp toggle switch location outlet", body: `
    <p>Each person has a <b>role</b> that decides what they can do, and the admin decides whether they use <b>Restaurant</b>, <b>ERP</b> or <b>both</b>.</p>
    <ul><li><b>Restaurant</b>: Counter, Today, Orders, Payments, Delivery run and the outlet’s Bake board.</li>
    <li><b>ERP</b>: Production, Purchases (GRN), Stock by location, Transfers, Finished goods, Batches and BOM.</li>
    <li><b>Both</b>: a Restaurant / ERP switch at the top of the sidebar (desktop) or in More (phone).</li></ul>
    <p>While nobody has ERP, everyone sees one combined app, as before ERP existed.</p>
    <p><b>Locations</b>: with more than one location, each device picks where it is (sidebar or More). New orders, batches and stock moves belong to that location.</p>
    <table><thead><tr><th>Role</th><th>Can</th></tr></thead><tbody>
    <tr><td>Admin</td><td>Everything, including users, settings, sync, backup, import and deleting</td></tr>
    <tr><td>Management</td><td>Counter, orders, money, purchases, stock, BOM, menu and prices, reports, export</td></tr>
    <tr><td>Manager</td><td>Day-to-day operations; no prices, recipes or export</td></tr>
    <tr><td>Kitchen</td><td>Production, batches, transfers, BOM, wastage and counts; no money</td></tr>
    <tr><td>Delivery</td><td>Delivery run and collecting payment</td></tr>
    <tr><td>Counter</td><td>Counter sales and receiving transfers at the outlet</td></tr></tbody></table>` },
  { id: "pos", view: "pos", title: "Counter", tags: "pos walk-in takeaway dine-in table swiggy zomato charge settle", body: `
    <p>The first screen for punching walk-in orders.</p>
    <ul><li><b>Takeaway</b>: tap items (or type in the search and press Enter), pick UPI, Cash or Card, tap <b>Charge</b>. Name and phone are optional. The toast has <b>Undo</b>.</li>
    <li><b>Dine-in</b>: pick a table, add items, <b>Open table</b>. Busy tables show their running bill; tap one to add more, then <b>Update table</b>. <b>Settle</b> asks how it was paid.</li>
    <li><b>Swiggy / Zomato</b>: saved as owing; they appear under Payments until settled.</li></ul>
    <p>Discount and a note apply to the whole ticket. With tax on, the ticket shows the tax lines and the total includes them. The number of tables is set in Business settings.</p>` },
  { id: "today", view: "today", title: "Today", tags: "day picker deliver tick pieces collected", body: `
    <p>All orders for one day, in flat order. Use the day strip or <b>Pick date</b>. The header shows delivered count, pieces (and how many still to bake) and money collected.</p>
    <p>Tap the circle to mark delivered; if money is due it asks whether it was paid by UPI or cash. Tap an order to open it. Filters: To deliver, Delivered, All.</p>` },
  { id: "orders", view: "orders", title: "Orders and the order screen", tags: "order list register channel occasion status cancel restore history edit repeat", body: `
    <p>Every order from every channel. Filter by Upcoming, Past, Cancelled or All, by channel and by occasion; search by name, flat, phone or order number. On a computer it is a table with totals.</p>
    <p>Opening an order shows its status steps (Received → Delivered), items, tax, total, and boxes for delivery and payment. From there: <b>Bill summary</b>, <b>Send order</b> on WhatsApp, <b>Edit</b>, <b>Repeat order</b>, <b>History of changes</b>, <b>Cancel</b> (keeps it, with a reason) or, for admins, <b>Delete permanently</b>.</p>` },
  { id: "neworder", title: "New order and WhatsApp import", tags: "compose new order whatsapp paste share message parse unmatched short names", body: `
    <p><b>New order</b> (the yellow button, or N on a computer): customer (past customers are suggested), flat, phone, channel (WhatsApp, Phone, Instagram, Bulk / event, Other), delivery date, items, occasion, notes and an offer %. Prices can be changed per line.</p>
    <p><b>From a WhatsApp message</b>: paste the customer’s message (or share it to the app on Android). The app reads the customer, flat, items and date and shows a check screen. Words it couldn’t match must be matched to an item or ignored; it can remember them as short names for next time.</p>` },
  { id: "bill", title: "Bill summary and tax on bills", tags: "bill summary copy sent gst cgst sgst gstin round off", body: `
    <p><b>Bill summary</b> lists each item at its menu price, then Total, Discount, the tax lines and Total payable. <b>Copy message</b> marks it “Bill summary sent”; if the order changes afterwards it is flagged.</p>
    <p>When tax is on, bills, order messages, the order screen and the counter ticket show the taxable value and each tax line (split into CGST and SGST if chosen), any round-off, and your GSTIN. Each line keeps the rate it was sold at, so later changes to rates never alter old bills.</p>` },
  { id: "pay", view: "pay", title: "Payments and customers", tags: "payments balance collect reminder part payment reverse customers", body: `
    <p>Balances by customer. <b>Mark paid</b> records the full balance by UPI or cash; <b>Different amount</b> takes a part payment, applied to the oldest order first. Payments are never edited: a mistake is fixed with a reversal, and both stay in history.</p>
    <p>A customer’s page shows spend, balance, phone, order history, a WhatsApp <b>reminder</b> with your UPI ID, and <b>New order</b> for them. Customers are built from orders, so they appear once they have ordered.</p>` },
  { id: "run", view: "run", title: "Delivery run", tags: "delivery run route wing floor collect", body: `
    <p>Today’s pre-orders in route order: by wing, then floor, then flat. <b>Delivered</b> asks whether it was paid by UPI, cash or not yet. Delivered orders move to the bottom.</p>` },
  { id: "bake", view: "bake", title: "Bake board", tags: "bake board pre-ordered kept ready par baked spoiled left outlet on hand short ask kitchen receive", body: `
    <p><b>Without ERP</b>: per item for a day, how many are pre-ordered, kept ready (the item’s par level), baked, spoiled, sold at the counter and left, and how many are still to bake. <b>Record a batch</b> opens the batch form with those numbers.</p>
    <p><b>Outlet board (Restaurant mode with ERP)</b>: what is on hand at this outlet, pre-orders still to hand over, kept-ready levels, what is short, and what is on the way from the kitchen. <b>Receive</b> confirms a delivery; <b>Ask kitchen</b> copies a message listing what’s short.</p>` },
  { id: "prod", view: "prod", title: "Production", tags: "production kitchen to bake need outlets erp send", body: `
    <p>The ERP home for a kitchen. For the chosen day it shows, per item, what each outlet is short of (pre-orders plus kept-ready levels, minus what it holds and what is already on the way), what is ready at the kitchen, and how many to bake.</p>
    <p><b>Record a batch</b> uses those quantities. <b>Send to outlets</b> opens a transfer suggested from each outlet’s shortfall. <b>Plan & explode</b> shows the materials needed.</p>` },
  { id: "batches", view: "batches", title: "Batches", tags: "batch record new batch prep runs spoiled undo cost per piece", body: `
    <p>Each bake is a numbered batch (e.g. PB-12, where P is the maker’s letter) with what was baked, any <b>prep runs</b> of semi-finished items (dough, filling), a note, who made it, the stock it used and made, and its cost.</p>
    <ol><li>Open <b>New batch</b> (Bake board, Production or here). Pieces are suggested from what’s needed; prep runs from what’s short.</li>
    <li>Adjust with − and +, add a note, <b>Save batch</b>. Stock is taken off by BOM at this location.</li>
    <li>Later, open the batch to <b>Record spoiled</b> pieces or edit the note.</li></ol>
    <p><b>Undo</b> reverses its stock moves and keeps it in the list marked undone. Cost per good piece = materials used, less the value of prep made, divided by pieces not spoiled.</p>` },
  { id: "bom", view: "bom", title: "BOM and Plan & explode", tags: "bom bill of materials multilevel tree semi-finished recipe yield cost margin plan explode requirement buy list", body: `
    <p>A <b>BOM</b> lists what goes into one piece of a menu item: raw materials, packing and semi-finished items. A semi-finished item has its own recipe for one <b>run</b> and says how much a run makes, and can use other semi-finished items, so BOMs can be several levels deep.</p>
    <ul><li><b>Finished items</b>: each item’s full tree with quantity and cost at every level, total cost and margin.</li>
    <li><b>Semi-finished</b>: each prep item’s recipe and where it’s used.</li>
    <li><b>Plan & explode</b>: for a day, the pieces to bake, the semi-finished runs to make (stock on hand used first) and the raw and packing materials needed, with what’s short and a buy list.</li></ul>
    <p>Edit a menu item’s BOM in Menu & recipes; a semi-finished item’s recipe in its page in Inventory. A recipe that would use itself is refused.</p>
    <p><b>Upload BOM</b> (admin): load an Excel or CSV sheet with Parent, Component, Qty and Unit (Template gives the layout). Any component or parent not found in the app is asked about before saving: pick the inventory item it means (remembered for next time), add it as new, or skip those rows.</p>` },
  { id: "shelf", title: "Shelf life and past-shelf-life pieces", tags: "shelf life expiry expired discard stale cookies 3 days month batch unsold", body: `
    <p>Each menu item has a shelf life in days, counting the day it was baked. If you don’t set one, cookies keep 30 days and everything else 3 days (Menu & recipes → item → Shelf life).</p>
    <p>The app follows each batch: delivered orders use up the oldest pieces first. When pieces of a batch are still unsold at the end of their shelf life, a <b>Past shelf life</b> prompt opens when the app opens, and again whenever it comes back after half an hour away, until every line is dealt with:</p>
    <ul><li><b>Discard</b>: the pieces are thrown away and recorded as discarded on the batch.</li>
    <li><b>Update count</b>: enter how many are really there; the rest are recorded as sold or used without a record. Any left still need discarding.</li></ul>
    <p>The bake board shows a red banner while anything is waiting. A batch’s page shows unsold pieces and the last good day.</p>` },
  { id: "stock", view: "stock", title: "Inventory: raw, packing and semi-finished", tags: "inventory stock materials rm pm sf ingredient reorder low out bought wasted count barcode supplier location category", body: `
    <p>Inventory has a tab for each kind of item: <b>Raw materials</b> (bought), <b>Packing</b> (bought) and <b>Semi-finished</b> (made here from a recipe), plus <b>All</b>. Within a tab, items are grouped by <b>category</b> (Dairy, Flour & grains, Boxes…), which you set on each item. Each is measured in g, ml or pieces; quantities can be typed in kg or L.</p>
    <p>Filter by category, level (low, out) and, with ERP and several locations, by location. Scanners in keyboard mode type into the search to find a barcode. Open a material for its stock, cost, where it’s used and its history; <b>Bought</b> (or a GRN in ERP), <b>Make</b> for semi-finished, <b>Wasted</b> and <b>Count</b>.</p>
    <p><b>Shopping list</b>: bought materials at or below their reorder level, brought back to twice that level.</p>
    <p>Costs: bought materials use the last purchase price; semi-finished cost rolls up through their recipe. With tax on, the admin sets per material whether purchase tax is recoverable or added to cost.</p>` },
  { id: "invoice", title: "Upload a purchase invoice", tags: "invoice upload supplier bill purchase grn map match item names excel csv paste pdf photo camera scan ocr claude", body: `
    <p>Inventory, Purchases or Import & export → <b>Upload invoice</b>.</p>
    <ol><li>Enter the supplier and invoice number (or leave them for the app to read from the bill).</li>
    <li><b>Take a photo or choose a PDF</b>, choose the supplier’s <b>Excel or CSV</b>, or <b>paste</b> the item lines.</li>
    <li>Items the app doesn’t recognise are listed with the closest inventory items. Pick the item each one is, add it as a new raw or packing material, or skip it. Your choice is remembered, so the same supplier name matches by itself next time.</li>
    <li>A GRN opens with the lines filled in. Check quantities and units, then save it to add the stock.</li></ol>
    <p><b>How photos and PDFs are read.</b> PDFs from billing software are read from their own text, on the phone. Photos and scanned PDFs go through text recognition on the phone (the first time it downloads about 10 MB). Clear, flat, well-lit photos read best. The text that was read is shown on the check screen; <b>Fix the text and read again</b> lets you correct it.</p>
    <p><b>Read with Claude</b> (optional): for crumpled, faded or handwritten bills, add a Claude API key in the invoice sheet. The photo or PDF is then sent to Anthropic’s Claude to read, and each invoice costs a few rupees on your Anthropic account. The key stays on that device only and isn’t synced; remove it there any time.</p>
    <p>With no unit on the invoice, quantities are read in kg, L or pieces.</p>` },
  { id: "grn", view: "grn", title: "Purchases (GRN)", tags: "grn goods received note purchase supplier invoice tax receive stock", body: `
    <p>Record each delivery from a supplier as a <b>GRN</b>: supplier (new names are added to your supplier list), invoice number, date, the location receiving it, and each item’s quantity, amount and tax %. Saving adds the stock at that location.</p>
    <p>The list shows this month, 30 days or all, with totals and spend by supplier. <b>Undo</b> takes the stock back off and keeps the GRN marked undone.</p>` },
  { id: "xfer", view: "xfer", title: "Transfers", tags: "transfer send receive in transit short kitchen outlet", body: `
    <ol><li><b>Send</b>: from the kitchen, choose the outlet; finished goods are suggested from what it’s short of. Add materials (boxes, cream) if needed. Stock leaves the sender and the transfer is <b>In transit</b>.</li>
    <li><b>Receive</b>: at the outlet (Bake board or Transfers), count what arrived and lower any line that is short, with a note. Only what is received counts at the outlet; shortfalls stay on the transfer as <b>Received short</b>.</li></ol>
    <p>Undo reverses everything and keeps the transfer marked undone.</p>` },
  { id: "fg", view: "fg", title: "Finished goods", tags: "finished goods fg stock location adjust count wasted opening", body: `
    <p>Pieces of each item at each location, counted from the day ERP started: good pieces from batches, plus transfers received, less transfers sent and delivered orders.</p>
    <p><b>Adjust</b>: <b>Count</b> sets what is really on the shelf; <b>Wasted / expired</b> takes pieces off. Do an opening count on the day ERP starts. Negative numbers mean something was sold before it was recorded.</p>` },
  { id: "menu", title: "Menu & recipes", tags: "menu items price category short names aliases keep ready par on sale tax", body: `
    <p>Each item has a price, category, short names customers use (for reading WhatsApp messages), a keep-ready level for walk-in sales (per outlet with ERP), a tax rate if different from the default, and its BOM with cost and margin.</p>
    <p>Switch an item off to stop selling it; past orders keep it. Removing it is for admins only.</p>` },
  { id: "reports", title: "Sales & profit", tags: "reports sales profit margin best sellers channel wastage repeat customers tax", body: `
    <p>For this week, this month, 30 days or all time: sales and orders, still to collect, spent on stock, gross margin (on items with a BOM), wastage value, repeat customers, tax on sales and pieces baked. Also sales by day and channel, best sellers with margin, and top customers.</p>` },
  { id: "users", title: "Users & roles", tags: "users people add pin email share folder mode location", body: `
    <p>Admins add people with a name, role, whether they use Restaurant, ERP or both, where they usually work, their Google email (for their own phone) and an optional 4-digit PIN for shared phones (<b>Switch user</b>). Each person’s order and document numbers carry their own letter so phones never clash offline.</p>` },
  { id: "settings", title: "Business settings", tags: "settings logo name colour upi tax gst locations outlets kitchen tables occasions festive", body: `
    <ul><li>Logo, name, tagline, brand colour, festive border.</li>
    <li>UPI ID and name, used in messages and reminders.</li>
    <li><b>Tax</b>: on/off, name (GST), default rate, prices including or excluding tax, CGST + SGST split, GSTIN.</li>
    <li><b>Locations</b>: add kitchens and outlets, rename them. A location with records can’t be removed.</li>
    <li>Dine-in tables at the counter; occasions to tag orders (e.g. Diwali).</li></ul>` },
  { id: "data", view: "data", title: "Import & export", tags: "import export csv excel template upload download bulk", body: `
    <p>For each type of data: <b>Export</b> downloads what’s in the app as a CSV file (opens in Excel or Google Sheets); <b>Template</b> downloads the columns with notes and an example; <b>Import</b> loads a filled CSV (or .xlsx).</p>
    <ol><li>Download the template and fill one row per record below the header. Lines starting with # are notes and are ignored.</li>
    <li>Import it. A check screen shows what will be added, updated or skipped and any rows with problems.</li>
    <li>Confirm. Nothing changes until you do.</li></ol>
    <p>Menu items, materials and suppliers are matched by name (and remembered other names) and updated; a new name that looks like an existing one is asked about first; BOM import replaces the BOM of each item listed; stock and finished-goods imports are counts (they set the quantity); orders already in the app (same order number) are skipped. Import is for admins; export needs the export permission.</p>` },
  { id: "backup", title: "Backup, cloud sync and Excel", tags: "backup restore sync google drive excel export daily report", body: `
    <p><b>Backup & restore</b> saves a file with every change ever made; loading one adds to what is there. <b>Cloud sync</b> keeps phones up to date through a shared Google Drive folder (setup in the README). <b>Export to Excel</b> writes one workbook with orders, payments, customers, batches, BOM, GRNs, transfers, stock and menu; with sync on, a copy is saved to Drive daily.</p>` },
  { id: "keys", title: "Computer and keyboard", tags: "desktop keyboard shortcuts sidebar table", body: `
    <p>On a screen 1024 px or wider: a sidebar with every screen your role can open, forms open on the right, and lists show as tables. Keys: <b>N</b> new order (or new GRN / transfer on those screens), <b>/</b> search, <b>Enter</b> opens a highlighted row, <b>Esc</b> closes a form. At the Counter, type in the search and press Enter to add the first match.</p>` },
  { id: "checks", title: "Checks before creating something new", tags: "duplicate similar same customer flat phone verify confirm new record", body: `
    <p>Before a new record is created, the app looks for one that is probably the same and asks first:</p>
    <ul><li><b>Customers</b> (new order, WhatsApp import, Counter takeaway with a name): a flat or phone number already used by someone else, or a very similar name. Choose that customer, or confirm it really is a new one (say, family in the same flat).</li>
    <li><b>Menu items, materials and suppliers</b>: a similar name already exists (e.g. “Buttter” and “Butter”). Use the existing one, or add it as new.</li>
    <li><b>Imports and invoices</b>: new names that look like existing ones, and names not found at all, must be answered on the check screen before anything is saved.</li></ul>` },
  { id: "faq", title: "Questions and fixes", tags: "help problem wrong negative stock sync update offline", body: `
    <ul><li><b>“A new version is ready”</b>: tap Update.</li>
    <li><b>Stock went negative</b>: something was used before its purchase was recorded. Record the GRN, or do a Count.</li>
    <li><b>Batch shows no cost</b>: the item has no BOM, or a material has no price yet.</li>
    <li><b>Sync says Needs attention</b>: More → Cloud sync → Sync now, and sign in again.</li>
    <li><b>Wrong entry</b>: payments, GRNs, transfers and batches are reversed or undone, never edited, so history stays complete.</li></ul>` }
];
H.helpTopics = TOPICS;

V.help = () => {
  const q = (S.query.help || "").toLowerCase().trim(); const open = S.helpTopic;
  const inTitle = t => q && t.title.toLowerCase().includes(q);
  // Title matches first and opened; then topics that mention the words.
  const list = TOPICS.filter(t => !q || (t.title + " " + t.tags + " " + t.body.replace(/<[^>]+>/g, " ")).toLowerCase().includes(q)).sort((a, b) => inTitle(b) - inTitle(a));
  return `<div class="band"><div class="page-title"><h1 class="h">Help</h1></div><div class="bandedge"></div></div>
  <div class="tools"><input class="search" data-search="help" type="search" placeholder="Search help, e.g. GRN, tax, batch" value="${esc(S.query.help || "")}" aria-label="Search help"></div>
  <div class="helplist">${list.map(t => `<details class="bakecard help" id="help-${t.id}"${t.id === open || inTitle(t) || (q && list.length <= 3) ? " open" : ""}><summary><span class="grow">${esc(t.title)}</span>${ICON.down}</summary>
    <div class="helpbody">${t.body}${t.view && H.canOpen && H.canOpen(t.view) ? `<button class="btn btn-ghost" data-go="${t.view}">Open ${esc(t.title.split(" (")[0].split(" and ")[0])}</button>` : ""}</div></details>`).join("") || `<div class="empty"><strong>Nothing matches</strong>Try another word.</div>`}</div>`;
};
// Opens Help on the topic for the current screen.
A.help = () => { const v = S.view; S.helpTopic = TOPICS.some(t => t.view === v) ? TOPICS.find(t => t.view === v).id : ({ more: "start" }[v] || ""); S.view = "help"; H.render(); window.scrollTo({ top: 0 });
  if (S.helpTopic) requestAnimationFrame(() => { const el = document.getElementById("help-" + S.helpTopic); if (el) el.scrollIntoView({ block: "start" }); }); };
