# Changelog

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
