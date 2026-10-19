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
    <p><b>Finding screens</b>: on a phone the bottom bar groups screens into <b>Orders</b> (Today, Orders, Delivery run, Payments), <b>Make</b> (Planning, Production or Bake board, Batches, BOM) and <b>Stores</b> (GRNs, Inventory, Transfers, Finished goods). Each opens the screen used last, with the others in a strip at the top. On a computer the sidebar lists them under the same headings.</p>
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
    <p><b>Record a batch</b> uses those quantities. <b>Send to outlets</b> opens a transfer suggested from each outlet’s shortfall. <b>Planning</b> shows the semi-finished to make, the indent and batch cards.</p>` },
  { id: "batches", view: "batches", title: "Batches", tags: "batch record new batch prep runs spoiled undo cost per piece", body: `
    <p>Each bake is a numbered batch (e.g. PB-12, where P is the maker’s letter) with what was baked, any <b>prep runs</b> of semi-finished items (dough, filling), a note, who made it, the stock it used and made, and its cost.</p>
    <ol><li>Open <b>New batch</b> (Bake board, Production or here). Pieces are suggested from what’s needed; prep runs from what’s short.</li>
    <li>Adjust with − and +, add a note, <b>Save batch</b>. Stock is taken off by BOM at this location.</li>
    <li>Later, open the batch to <b>Record spoiled</b> pieces or edit the note.</li></ol>
    <p><b>Undo</b> reverses its stock moves and keeps it in the list marked undone. Cost per good piece = materials used, less the value of prep made, divided by pieces not spoiled.</p>` },
  { id: "bom", view: "bom", title: "BOM", tags: "bom bill of materials multilevel tree semi-finished recipe yield cost margin new material", body: `
    <p>A <b>BOM</b> lists what goes into one piece of a menu item: raw materials, packing and semi-finished items. A semi-finished item has its own recipe for one <b>run</b> and says how much a run makes, and can use other semi-finished items, so BOMs can be several levels deep.</p>
    <ul><li><b>Finished items</b>: each item’s full tree with quantity and cost at every level, total cost and margin. <b>Edit BOM</b> opens the item.</li>
    <li><b>Semi-finished</b>: each prep item’s recipe and where it’s used.</li></ul>
    <p>In the BOM editor, <b>+ Add material</b> adds a line from inventory; <b>+ New material</b> creates a material that isn’t in inventory yet (name, type, unit) and adds it as a line, after checking for similar names. Price, supplier and reorder level can be filled in later in Inventory. A recipe that would use itself is refused.</p>
    <p><b>Upload BOM</b> (admin): load an Excel or CSV sheet with Parent, Component, Qty and Unit (Template gives the layout). Any component or parent not found in the app is asked about before saving: pick the inventory item it means (remembered for next time), add it as new, or skip those rows.</p>` },
  { id: "plan", view: "plan", title: "Planning: what to make, indent and batch cards", tags: "planning plan production fg sfg semi-finished indent requisition store issue purchase batch card batch size scale print explode mrp", body: `
    <p>Planning works out, for a day, everything the kitchen needs. Pick Today, Tomorrow or any date; the tabs follow the same plan.</p>
    <ul><li><b>Finished goods</b>: the pieces to make. The suggestion is pre-orders plus kept-ready levels less what’s baked (in ERP: what the outlets need less what the kitchen holds). Type any quantity, or add an item, to plan your own; the plan is saved for everyone. <b>Back to the suggestion</b> drops your changes.</li>
    <li><b>Semi-finished</b>: the dough, fillings and sauces needed for that plan, level by level, what’s in stock, and how much to make in whole recipe runs.</li>
    <li><b>Indent</b>: every raw and packing material the plan needs, through every BOM level, grouped by category. <b>To buy</b> shows only the shortfall (a purchase indent); <b>Store issue</b> shows full quantities to hand to the kitchen. Share, copy or print it.</li>
    <li><b>Batch card</b>: choose a product and type a batch size (pieces, or kg / L for semi-finished). Every ingredient is recalculated at once, step by step (semi-finished first) with a total. Choose whether semi-finished items are made in the batch or taken from stock. <b>Print card</b> gives a compact sheet, one table per step with tick boxes, and sign-offs; <b>Record this batch</b> opens New batch with these quantities.</li></ul>
    <p>Example: 40 Pizza Pinwheels at 60 g dough each need 2.4 kg dough (1.6 runs of a 1.5 kg recipe), which needs 1.6 kg maida and 32 g yeast, plus onion, corn, sauce, oregano, cheese, chilli flakes and boxes for 40 pieces.</p>
    <p><b>Requirement calculator</b>: for a quote or a bulk order, list any mix of products (menu items in pieces, semi-finished in kg / L), or pull in an order’s items, and see the semi-finished to make and every raw and packing material, combined. Choose whether stock on hand is used (showing what to buy after stock and anything on order) or ignored (full quantity), and whole recipe runs or exact quantities. With two or more products, a by-product table shows what each needs. Print, share, copy or draft purchase orders. Nothing is recorded as a batch or plan; the list stays on this device until cleared.</p>` },
  { id: "views", title: "Grid or lines, sorting and filters", tags: "grid lines list table view layout sort filter column cards", body: `
    <p>Every list screen has a <b>Grid · Lines</b> switch, and so do the Customers and Menu drawers. Grid shows cards; Lines shows a table. Screens that are tables by nature (Planning, Finished goods, Reports) show each row as a card in Grid. The choice is kept per screen on this device.</p>
    <p>In any table, tap a column heading to sort (up, down, then off); in Grid the headings appear as sort buttons above the cards. Tables with more than a few rows have a filter box per column: type text to match, or compare numbers with <b>&gt;</b>, <b>&lt;</b>, <b>&gt;=</b>, <b>&lt;=</b> or <b>=</b> (for example “&gt; 2 kg”). “Showing x of y” says when rows are hidden.</p>` },

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
    <p>Costs: bought materials use the last purchase price; semi-finished cost rolls up through their recipe. With tax on, the admin sets per material whether purchase tax is recoverable or added to cost.</p>
    <p><b>Cost</b> of bought materials is the weighted average of stock on hand (Business settings can switch to the last purchase price). A material can be <b>bought in packs</b> (bag of 50 kg, carton of 100): POs and GRNs then offer the pack as a unit. <b>Usable for</b> days fills the best-before date on GRNs; each GRN line becomes a lot, used oldest first. Expired or expiring lots show a banner and an <b>Expiring</b> filter, and can be discarded from the material’s page.</p>` },
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
  { id: "po", view: "po", title: "Purchase orders", tags: "po purchase order approve approval supplier indent reorder receive grn rate pack bag", body: `
    <ol><li><b>Raise</b>: New PO, or let the app draft them: Planning → Indent → <b>Draft purchase orders</b> (one per usual supplier, for what’s short after stock and anything already on order), or the reorder banner on this screen for materials below their reorder level. Quantities are rounded up to whole packs when a material is bought in packs, at the supplier’s last price.</li>
    <li><b>Approve</b>: drafts wait for an admin or management to approve (Managers can raise but not approve). Approved POs count as <b>on order</b> in Planning.</li>
    <li><b>Send</b> it to the supplier on WhatsApp, or copy it.</li>
    <li><b>Receive goods (GRN)</b> opens a GRN filled with what’s still pending. Each line shows if the bill’s rate differs from the PO. Receive in parts; the PO shows Part received until everything arrives, or <b>Close short</b> when nothing more is coming.</li></ol>` },
  { id: "sup", view: "sup", title: "Suppliers & payables", tags: "supplier payable owe credit days overdue payment ledger statement upi bank cheque", body: `
    <p>Every GRN is a bill from its supplier. This screen shows what you owe each one, what is overdue (bill date + the supplier’s <b>credit days</b>) and when the oldest bill fell due.</p>
    <p>Open a supplier to set phone, GSTIN and credit days, see unpaid bills and the ledger with a running balance, <b>record a payment</b> (bank, UPI, cash or cheque, with a reference), or share a statement on WhatsApp. Tick the bills a payment is for and it settles those first; otherwise it settles the oldest bills. Paying more than you owe leaves an <b>advance</b> with the supplier, used against the next bills. A wrong payment is reversed, not deleted.</p>
    <p><b>Ageing</b>: unpaid bills are grouped by age (0–30, 31–60, 61–90 and over 90 days from the bill date), per supplier and in the table. <b>Due this week</b> lists bills falling due in the next seven days.</p>` },
  { id: "dn", view: "dn", title: "Purchase returns (debit notes)", tags: "return supplier debit note dn damaged expired wrong item send back credit", body: `
    <p>When goods go back to a supplier, record a <b>debit note</b>: from the GRN (<b>Return goods</b>, limited to what that GRN brought in and hasn’t gone back already) or from Stores → Returns for any supplier. Give quantities, the rate and tax (filled from the bill) and a reason.</p>
    <p>Saving takes the stock off at what it cost, so the average cost doesn’t move, and lowers the supplier’s balance by the debit note total; a debit note against a GRN reduces that bill. In Tally it is a <b>Debit Note</b> voucher: supplier debited, purchases and input tax credited. A wrong one is undone (stock goes back in); a GRN with debit notes can only be undone after them.</p>` },
  { id: "wo", view: "wo", title: "Work orders and variance", tags: "work order production issue materials store complete variance yield return wip", body: `
    <ol><li><b>Create</b> from Planning (Create a work order for this plan), from a batch card, or New work order: pieces to make and semi-finished runs.</li>
    <li><b>Issue materials</b>: the standard quantities from the BOM are filled in; change them to what was really handed to the kitchen. Issued stock leaves the store at once. Issue more later if needed.</li>
    <li><b>Complete</b>: enter good and spoiled pieces, semi-finished runs made, and anything returned to the store unused. The batch is recorded with its real cost: <b>used = issued − returned</b>.</li></ol>
    <p><b>Variance</b> compares what was used with the BOM for what was actually made, material by material, in quantity and value. Positive means more was used than the BOM allows. Undoing the batch puts back everything the order issued and cancels the order.</p>` },
  { id: "insights", view: "insights", title: "Cost & stock reports", tags: "reports food cost wastage variance ageing buying price tax gst day book tally accountant export", body: `
    <ul><li><b>Food cost</b>: sales before tax, and each item’s standard material cost as a share of its price; plus what production actually cost per good piece.</li>
    <li><b>Wastage</b>: pieces spoiled and discarded per item, and materials written off with their value.</li>
    <li><b>Variance</b>: completed work orders, by material and by order.</li>
    <li><b>Stock ageing</b>: material lots on hand by age and best-before, and unsold finished goods.</li>
    <li><b>Buying</b>: spend by supplier and each material’s latest price change.</li>
    <li><b>Tax</b>: tax on sales against claimable tax on purchases, by month. A working summary, not a return.</li>
    <li><b>Day book</b>: every sale, receipt, purchase and supplier payment as Tally vouchers: a Day Book view, Tally XML to import, and an Excel copy.</li></ul>
    <p><b>Tally</b>: the Day book tab lists every voucher the way Tally’s Day Book does (date, particulars, voucher type, number, debit, credit) with its ledger entries. Set your Tally ledger names once (sales, purchase, tax prefixes, cash, bank, round off, counter sales). <b>Tally XML · ledgers</b> creates customers (Sundry Debtors), suppliers (Sundry Creditors, with GSTIN) and the account ledgers; <b>Tally XML · vouchers</b> brings in Sales, Receipt, Purchase and Payment vouchers with CGST/SGST on their own ledgers and round-off. Import ledgers first, then vouchers. Every voucher balances before it is written.</p>` },
  { id: "close", view: "close", title: "Day close", tags: "day close cash count drawer upi card float tally shortage excess end of day", body: `
    <p>At the end of the day each person closes their own takings. The app shows what it recorded for them by mode (cash, UPI, card), less cash refunds and cash paid to suppliers. Enter the <b>opening float</b>, any other cash <b>paid out</b>, and what you <b>counted</b> per mode; the difference shows at once as short or over.</p>
    <p>Save the close with a note. Past closes stay in the list (grid or lines) and can be printed or copied for the owner.</p>` },
  { id: "taxinv", title: "Tax invoices and receipts", tags: "invoice tax invoice gst receipt print hsn number series financial year counter printer", body: `
    <p><b>Tax invoice</b> on an order prints an A4 invoice: your name, address, GSTIN and state, the customer, each line with HSN, taxable value and CGST and SGST per rate (or one tax line, as set in Business settings), round-off and the amount in words. The number is given on first print from a series per financial year and device, e.g. INV-2627-PA-0007, and stays with the order.</p>
    <p><b>Receipt</b> prints a narrow slip for 58 / 80 mm counter printers. Turn on <b>print a receipt after each counter sale</b> in Business settings. Set the address, phone, state, invoice prefix and default HSN there too; an item can have its own HSN.</p>` },
  { id: "take", view: "take", title: "Stock-take", tags: "stock take count physical verification variance reason wastage counting sheet", body: `
    <p>Count every material at a location in one sheet. Type what you counted (in kg / L where that suits); the difference against the app shows at once, and each difference needs a reason (counting error, wastage, expired, missing…). Leave blank what you didn’t count. The count stays on this phone until you save, so it can be done over several sessions.</p>
    <p>Saving posts all the counts together as ST-numbered stock-take, with the value of the differences by reason. <b>Print a blank count sheet</b> to count on paper first.</p>` },
  { id: "credit", title: "Advances, credit and refunds", tags: "advance credit refund deposit prepaid excess overpaid cancel money back", body: `
    <p>On a customer’s page, <b>Take an advance</b> records money received before an order; <b>Use credit on unpaid orders</b> applies it to their unpaid orders; <b>Refund credit</b> pays it back. Money left over on a cancelled or overpaid order can be refunded or kept as credit.</p>
    <p>Cancelling a paid order offers to refund it. An order with money received can’t be deleted, only cancelled.</p>` },
  { id: "preorder", title: "Pre-orders and cakes", tags: "pre-order cake message weight flavour theme time slot advance due", body: `
    <p>In a new order, <b>Pre-order details</b> holds the delivery time slot, the message on the cake, weight or size, flavour or theme, and the advance to confirm. The order screen and message show them; the delivery run is sorted by slot; an advance not yet received shows as due.</p>` },
  { id: "recipever", title: "Recipe versions", tags: "recipe version change date effective from old recipe food cost standard correction", body: `
    <p>Changing the recipe of a menu item or semi-finished material asks <b>from when</b>. Give the day the new recipe starts, and sales and work orders before it keep the old recipe as their standard (food cost report, work-order variance). Choose <b>Correction</b> when the old recipe was simply wrong, and the past follows the new one. Earlier recipes are listed in the editor.</p>` },
  { id: "devices", title: "Order numbers on several phones", tags: "order number device letter duplicate offline numbering compact archive speed", body: `
    <p>With two or more phones in the team, each gets a letter, and numbers carry it: PA-58 from one phone, PB-12 from another. So two phones offline never give the same number. A single phone keeps plain numbers.</p>
    <p>Once a day the app also tidies its history (older superseded changes are dropped) so screens stay fast after a year of data.</p>` },
  { id: "locks", title: "Two people editing the same record", tags: "lock locked editing someone else conflict overwrite take over", body: `
    <p>When someone opens a saved order, menu item, material, PO, work order, transfer receipt, batch, person or the business settings to edit it, the record is <b>locked</b> for everyone else until they save or close it. Others see who is editing and since when, and the record’s page shows a 🔒 line.</p>
    <p>A lock lapses 8 minutes after the editor’s app goes quiet (phone locked, app closed), so nothing stays stuck. The admin can <b>take over</b> a record someone left open.</p>
    <p>Devices share changes through Google Drive about once a minute, and the app syncs again just before checking a lock. Two people opening the same record within those seconds, or while offline, can both edit; then saving warns that someone else saved it after you opened it, so you can go back and reopen, or save yours anyway.</p>` },
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
    <p>Menu items, materials and suppliers are matched by name (and remembered other names) and updated; a new name that looks like an existing one is asked about first; BOM import replaces the BOM of each item listed; stock and finished-goods imports are counts (they set the quantity); orders already in the app (same order number) are skipped. Import is for admins; export needs the export permission.</p>
    <p><b>Import and export</b>: menu items, materials, BOM, customers (phone, notes, advance held), suppliers (credit days, other names, opening balance), users & roles, locations, inventory and finished-goods counts, orders, payments (against order numbers, or advances), purchase orders, GRNs (past purchases add stock and become bills) and supplier payments (against chosen bills). Payments, GRNs and supplier payments already in the app are skipped, so an export can be imported again safely.</p>
    <p><b>Export only</b>: batches, transfers, work orders, stock-takes, purchase returns, day closes and every stock movement. These come from the app’s own steps (they move stock or money in ways an import would skip), so they are made in the app. Admins and PINs are set in More → Users; business settings travel with a backup file.</p>` },
  { id: "backup", title: "Backup, cloud sync and Excel", tags: "backup restore sync google drive excel export daily report weekly automatic", body: `
    <p><b>Automatic backups</b>: with cloud sync on, an admin’s phone saves a full backup to the Drive folder once a week by itself, keeping the last four (backup_1 to backup_4). If a week passes without one, admins see a reminder on More. <b>Restore</b> from any of them in More → Backup; restored data is shared with the other devices.</p>
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
