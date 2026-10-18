# Changelog

## 2.10.0 — 18 Oct 2026
- Editing locks: opening a saved order, menu item, material, PO, work order, transfer receipt, batch, person or the business settings locks it for everyone else until it's saved or closed. Others see who is editing and since when (and a 🔒 line on the record's page); the admin can take over. Locks lapse 8 minutes after the editor's app goes quiet. Because devices sync about once a minute, saving also checks whether someone else saved the record after it was opened and asks before overwriting
- Day book in Tally's shape: Sales, Receipt, Purchase and Payment vouchers with ledger entries (party, sales/purchase, CGST/SGST per rate, round off, cash/bank), a Day Book view, Tally XML for ledgers (Sundry Debtors/Creditors with GSTIN, account ledgers) and for vouchers, and an Excel copy in Day Book columns. Ledger names are set once to match the Tally company
- Grid or lines on every list screen and the Customers and Menu drawers: Today, Payments, Delivery run, bake boards, BOM and Import & export gain table views; Planning, Finished goods and Reports gain card views. Tables in drawers sort and filter too

## 2.9.0 — 18 Oct 2026
- Purchase orders: raise, approve (admin or management; managers can raise but not approve), send to the supplier on WhatsApp, receive in one or more GRNs against the PO with a warning when the bill's rate differs, or close short. Planning's indent and a reorder banner draft POs per usual supplier for what's short after stock and anything already on order, rounded up to whole packs at each supplier's last price
- Suppliers & payables: what is owed to each supplier from their GRNs, overdue by credit days, ledger with running balance, payments (bank, UPI, cash, cheque with reference) that settle the oldest bills first, reversals, WhatsApp statements
- Work orders: created from Planning or a batch card; materials issued from the store (warned when the store shows less); completed with good and spoiled pieces, semi-finished runs and unused returns. The batch is recorded at what was really used, with variance against the BOM for the actual output by material, in quantity and value. Undoing the batch returns everything issued
- Costing: weighted average of stock on hand by default (or last purchase price in Business settings)
- Buying packs per material (bag of 50 kg, carton of 100) as units on POs and GRNs
- Material lots and expiry: GRN lines take a best-before date (filled from the material's usable days) and a lot number; stock is used oldest first; expired and expiring lots show a banner and a filter in Inventory and can be discarded
- Cost & stock reports: food cost, wastage, production variance, stock ageing, buying (spend by supplier and price movement), tax on sales against claimable tax on purchases, and a day-book CSV for the accountant
- GRNs, purchase orders, payables and work orders are available without ERP mode too, under Stores and Make

## 2.8.0 — 18 Oct 2026
- Planning screen: for any date, finished goods to make (suggested from pre-orders and kept-ready levels, or outlet needs in ERP; editable and saved for everyone), semi-finished to make level by level in whole runs, and the indent of raw and packing materials through every BOM level, as a purchase indent (shortfall) or a store issue (full quantity). Share, copy or print; print the whole day's plan
- Batch cards: pick a menu item or semi-finished material and type a batch size; every ingredient is recalculated at once, step by step with a total, cost and stock check. Semi-finished made in the batch or taken from stock. Print with tick boxes and sign-offs, share, or record the batch
- New batch: piece counts and semi-finished runs can be typed, and materials recalculate as you type
- Screens grouped into Orders, Make and Stores: one bottom-bar button each on phones (opens the screen used last, with a strip of the others on top), headed sections in the desktop sidebar
- Grid or lines switch on orders, batches, inventory, production, GRNs and transfers (inventory gains a table view). Every table sorts by any column and, when longer than a few rows, filters per column, with number comparisons such as "> 2 kg"
- BOM editor: + New material creates a material that isn't in inventory and adds it as a line
- Fixed: adding a line in a BOM (or any change in a drawer) jumped back to the top; drawers now keep their place and the cursor. Pages keep open cards and scroll positions in inner panes when they refresh
- Fixed: saving a material or menu item whose name already had a namesake (for example from an import or two devices) said it already exists; only a new or changed name is checked now, and a clash offers to open the existing record. Saving says "Changes saved"; saving from the BOM screen returns there
- Plan & explode moved from BOM to Planning

## 2.7.0 — 18 Oct 2026
- Fixed: Pick date on Today (and other date chips) didn't open on desktop browsers
- Mark as delivered: "Delivered, not paid yet" is now the first option
- Shelf life per menu item (default 30 days for cookies, 3 days for everything else). Unsold pieces are followed batch by batch (oldest sold first); anything past its shelf life raises a prompt when the app opens, and when it comes back after 30 minutes away, until each line is discarded or its count updated. Bake boards show a banner; batches show unsold pieces and the last good day
- Stock is now Inventory, with tabs for raw materials, packing and semi-finished, and categories within each (Dairy, Flour & grains, Boxes…)
- Upload a purchase invoice from a photo or PDF: text PDFs are read directly and photos or scanned pages by on-device text recognition (pdf.js and Tesseract, loaded on first use); optionally Claude (claude-opus-5-5) reads hard photos with an API key kept on that device only. Also from Excel, CSV or pasted lines: supplier item names are matched to inventory items (remembered for next time) or added as new, then a GRN opens filled in
- Upload BOM from Excel on the BOM screen: components and parents not found are matched to inventory or created before saving
- Checks before creating new records: customers (same flat or phone under another name, or a near-identical name), menu items, materials and suppliers (similar names), and new names in imports, are confirmed first

## 2.6.0 — 18 Oct 2026
- Help: every screen and module explained (setup, roles and modes, Counter, orders, payments, bake board, production, batches, BOM, stock, GRNs, transfers, finished goods, settings, import & export, backup, keys, fixes). Searchable; opens on the topic for the screen you're on; each topic links to its screen. In the sidebar and More
- Import & export by data type: Export (CSV) for menu items, materials, BOM, material stock, finished goods, suppliers, orders, customers, payments, batches, GRNs and transfers. Template download for each importable type, with notes and an example. Import (CSV or .xlsx) for menu items, materials, BOM (multilevel), stock counts, finished-goods counts, suppliers and orders, with a check screen listing what will be added, updated, skipped or rejected (by line) before anything changes. Admin only for import

## 2.5.0 — 18 Oct 2026
- Transfers have a receive step: sending takes stock off the sender and marks it in transit; the receiving location confirms what arrived line by line, with a note for anything short. Only received quantities count at the destination; shortfalls stay on the transfer and show as "Received short". The outlet bake board lists what's on the way with a Receive button, and pieces on the way aren't asked for twice
- Purchase tax per material (admin only, in the material editor): recoverable (kept out of stock cost) or not recoverable (added to the cost of stock, recipes and batches). GRN lines say which applies

## 2.4.0 — 18 Oct 2026
- ERP mode alongside Restaurant mode. The admin sets each person to Restaurant, ERP or both (Users & roles); people with both get a switch in the sidebar or More. While nobody has ERP, the app works exactly as before
- Locations: a central kitchen and any number of outlets (Business settings → Locations). Each device picks where it is; orders, batches and stock moves belong to that location
- Purchases as GRNs: supplier, invoice number, receiving location, items with quantity, amount and tax; adds stock at that location; undo keeps it in the list marked undone; spend by supplier
- Production (ERP home): per kitchen and day, what every outlet is short of (pre-orders + kept-ready levels − what it holds) less finished goods already at the kitchen; record a batch from it or send to an outlet
- Transfers: finished goods and materials from one location to another, suggested from what the outlet is short of; reversible
- Finished-goods stock by location, counted from the day ERP started: batches in, transfers, delivered orders out, with counts and wastage adjustments
- Outlet bake board in Restaurant mode: what's on hand at this outlet, pre-orders to hand over, kept-ready levels, what's short, and a message to ask the kitchen
- Tax: on/off, name, default rate, per-item and per-material rates, prices inclusive or exclusive, CGST + SGST split, GSTIN. Order messages, bill summaries, the order screen, the counter ticket and GRNs show it; old bills keep the rates they were made with
- Fixed: on desktop the sidebar covered the New-order button; a drawer could reappear after saving

## 2.3.0 — 18 Oct 2026
- Counter (first screen for admin, management, manager and counter): punch walk-in orders as Takeaway (paid by UPI, cash or card in one tap) or Dine-in at a table. A table keeps an open bill you can add to and settle later; busy tables show their running total. Swiggy and Zomato sales moved here. Menu search: type and press Enter to add. Replaces Quick sale
- Materials split into raw materials (RM), packing materials (PM) and semi-finished items. Stock filters by type; purchases and the shopping list cover RM and PM only
- Multilevel BOM: semi-finished items have their own recipe and yield and can use other semi-finished items. Menu BOMs can use any material. Costs roll up through every level; a recipe that would use itself is refused
- BOM screen: each item's full tree with quantity and cost at every level; Plan & explode turns a day's bake board into semi-finished runs to make (stock on hand used first) and raw and packing materials needed, with what's short and a buy list
- Batches can include prep runs of semi-finished items, suggested from the plan; stock moves record what was used and made, and the batch cost is the net cost of its pieces
- Undoing a batch keeps it in the register, marked undone, instead of deleting it
- Business settings: number of dine-in tables
- Excel export: material type and supplier on Stock, new BOM sheet

## 2.2.0 — 17 Oct 2026
- Desktop layout: on screens 1024 px and wider, a sidebar lists every screen the role can open, forms open as side drawers, and Orders and Batches show as tables with totals. Keys: N for a new order, / to search
- Batches: every recorded bake is now a numbered batch (e.g. PB-12) with its note, who made it, stock used and ingredient cost priced at the time. A new Batches screen lists them by period with pieces, spoiled pieces and cost per good piece. Spoiled pieces come off the bake board count. Batches go into the Excel export and the Sales & profit report
- More order types: Instagram, Bulk / event and Other join WhatsApp and Phone as pre-orders (bake board, delivery run, payments). The Orders list filters by channel, covering walk-in, Swiggy and Zomato sales too

## 2.1.0 — 17 Oct 2026
- Bill summary on every order: items with quantity, rate and amount, then Total, Discount and Total payable; copy marks the order “Bill summary sent”, flagged again if the order changes later

## 2.0.0 — 17 Oct 2026
Rebuilt on the agreed build specification.
- Event-based data: every change recorded with who and when; payments and stock as ledgers with reversals
- Six roles with their own home screens and module access; optional PINs for shared phones
- Bake board with pre-orders, par levels, bakes and counter sales; recipe-based stock deduction
- Order lifecycle (received to delivered, or cancelled) with full change history
- WhatsApp order import with confirm screen, unmatched-word checks and learnable short names
- Quick sale for walk-in, Swiggy and Zomato; delivery run by wing and floor
- Sync through a shared Google Drive folder (one file per phone), daily Excel copy, backup, Excel export
- Brand colour setting; red reserved for problems; festive border optional

## 1.0.0 — 17 Oct 2026
First standalone release (Bakery POS).
