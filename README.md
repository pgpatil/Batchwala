# Batchwala

Orders, bake planning, deliveries, payments and stock for a home bakery, in one phone app. Built first for Neena’s Magic. *Batchwala* is a working name: change it in `js/config.js`, `manifest.webmanifest` and `index.html` once a trademark check is done.

It is a Progressive Web App: it opens from a link, installs to the home screen, works offline and needs no app store. It runs on Android phones, iPhones, tablets and Android handhelds (PDAs).

## What’s in version 2

| Area | What it does |
| --- | --- |
| Today | Day picker, deliveries in flat order with a confirm step, pieces to bake, money collected |
| New order | Tap-to-add menu, saved customers, channel, offer %, occasion tag |
| From WhatsApp | Paste or share a customer’s message; the app reads customer, flat, items and date, then shows a confirm screen. Unmatched words must be matched or ignored before saving, and can be remembered as short names |
| Counter | First screen for the counter: Takeaway (charge by UPI, cash or card) or Dine-in at a table with an open bill to add to and settle; Swiggy and Zomato sales too. Type to search the menu, Enter adds |
| Bake board | Per item: pre-ordered, kept ready (par level), baked, spoiled, sold at counter, left, and how many still to bake |
| Batches | Every bake recorded as a numbered batch: pieces per item, prep runs of semi-finished items, spoiled pieces, note, who made it, stock used and made, and net cost. Undone batches stay in the register, marked |
| Orders | Every order from every channel (WhatsApp, Phone, Instagram, Bulk / event, Other, Walk-in, Swiggy, Zomato), filtered by period, channel and occasion |
| Navigation and views | Screens grouped into Orders, Make and Stores (one bottom-bar button each on phones, sidebar sections on desktop). Grid or lines on list screens; every table sorts by any column and filters per column, with number comparisons. N for new order, / to search |
| Delivery run | Today’s pre-orders by wing and floor; Delivered + paid by UPI or cash in one confirm |
| Bill summary | Per order: items with quantity, rate and amount, then Total, Discount and Total payable. Copy marks it “Bill summary sent”; editing the order afterwards flags it |
| Payments | Balances by customer, one-tap UPI or cash, part payments oldest-first, reversals instead of edits, WhatsApp reminders with your UPI ID |
| Inventory | Tabs for raw materials (RM), packing (PM) and semi-finished items, with categories; upload a supplier invoice (photo, PDF, Excel or pasted) to fill a GRN, matching their item names to yours. Raw materials (RM), packing materials (PM) and semi-finished items in g, ml or pieces; purchases with price and supplier, wastage, stock counts, reorder levels, shopping list, barcode search |
| BOM | Multilevel bills of materials: menu items use raw, packing and semi-finished materials; semi-finished items have their own recipe and yield and can use other semi-finished items. Costs roll up through every level. In the BOM editor, new materials can be created on the spot |
| Planning | For a date: finished goods to make (suggested, editable, shared), semi-finished to make level by level, and the indent (purchase shortfall or full store issue) through every BOM level. Batch cards scale any product to any batch size, step by step, printable. A requirement calculator works out materials for any mix of products (e.g. a bulk order) without recording anything |
| Purchasing | Purchase orders with approval, drafted from the indent or reorder levels, received through GRNs (in parts, with rate checks), buying packs, supplier payables with credit days, payments and statements |
| Work orders | Production issued from the store and completed with actual output and returns; batches costed at what was really used, with variance against the BOM |
| Costing and lots | Weighted-average material cost (or last price); GRN lots with best-before dates, used oldest first, expiry alerts and discards |
| Cost & stock reports | Food cost, wastage, variance, stock ageing, buying and price movement, tax summary, and the day book as Tally vouchers (Day Book view, Tally XML for ledgers and vouchers, Excel) |
| Day close | Each person counts cash, UPI and card at day end against what the app recorded for them, with float, paid-outs and short / over |
| Invoices and receipts | A4 GST tax invoice with HSN, CGST / SGST, round-off and amount in words, numbered per financial year and device (INV-2627-PA-0007); 58 / 80 mm counter receipts, optionally after every sale |
| Advances and refunds | Customer advances held as credit and used on unpaid orders; refunds on cancelled or overpaid orders; pre-order details (time slot, cake message, weight, flavour, advance due) |
| Stock-take | Count a whole location in one sheet with a reason for every difference, saved as one numbered stock-take; printable count sheet |
| Purchase returns | Debit notes against a GRN or any supplier: stock off at cost, supplier balance reduced, Debit Note voucher for Tally |
| Payables | Payments against chosen bills, supplier advances, ageing (0–30 / 31–60 / 61–90 / 90+) and bills due this week |
| Recipe versions | A recipe change can start on a date; past food cost and work-order standards keep the recipe in force at the time |
| Editing locks | A saved record being edited is locked for others until saved or closed (lapses after 8 quiet minutes; admin can take over); saves check for changes made meanwhile |
| Menu | Prices, categories, short names for WhatsApp reading, par levels, recipes with cost and margin |
| Reports | Sales by day and channel, best sellers with margin, wastage value, repeat customers |
| ERP mode | For people the admin gives ERP: Production per kitchen, Purchases as GRNs, Stock by location, Transfers kitchen → outlets, Finished goods by location, Batches and BOM. Restaurant mode keeps the counter, orders, payments, deliveries and the outlet’s bake board. Nobody on ERP = the original single app |
| Locations | One central kitchen and any number of outlets; each device chooses where it is. Transfers are sent, then received at the other end with what actually arrived |
| Tax | Optional GST (or any name): default and per-item rates, inclusive or exclusive prices, CGST + SGST split, GSTIN; shown on every bill, message and GRN. Per material, the admin sets whether purchase tax is recoverable or added to cost |
| Users & roles | Admin, Management, Manager, Kitchen, Delivery, Counter; each opens on its own home screen. Each person uses Restaurant, ERP or both. Optional 4-digit PIN for shared phones |
| History | Every change records who made it and when; any order shows its full history |
| Shelf life | Per item (cookies 30 days, others 3 by default); a prompt on opening the app to discard or recount anything unsold past its shelf life |
| Checks | Before a new customer, item, material or supplier is created, similar existing ones are shown to confirm first |
| Help | In-app help for every screen and module, searchable, opening on the screen you’re on |
| Import & export | CSV export by data type; templates; import of menu, materials, BOM, stock and finished-goods counts, suppliers and orders with a check screen first |
| Data | Saved on the phone first; optional sync through a shared Google Drive folder; daily Excel copy and weekly automatic backups (last four kept, restorable) in that folder; backup file; Excel export. Order and document numbers carry a device letter once a team has two phones, so offline phones never clash |

## Roles

| Role | Home | Can |
| --- | --- | --- |
| Admin | Counter | Everything, including users, business settings, sync, backup and deleting records |
| Management | Counter | Orders, bake board, delivery, payments, stock, menu and prices, customers, reports, Excel export |
| Manager | Counter | Day-to-day operations; can’t change prices or export |
| Kitchen | Bake board | Batches with prep, spoiled pieces, BOM (no costs), wastage and stock counts; no money or phone numbers |
| Delivery | My run | Mark delivered, collect payment |
| Counter | Counter | Takeaway, dine-in and aggregator sales |

In ERP mode the homes are Production (Admin, Management, Manager, Kitchen) and Finished goods (Delivery, Counter).

With Google Drive sync, these rules are enforced by the app, not by Drive: anyone with access to the shared folder could edit its files directly. That is fine while the team is the owners. Before staff join, move the data to a database with enforced permissions (see “Moving the data later”).

## Put it online with GitHub Pages

1. Create a repository on [github.com](https://github.com), for example `batchwala`. A free plan needs it **Public** for Pages; the code holds no customer data.
2. **Add file → Upload files**, drag in everything from this folder keeping the folders as they are, and commit.
3. **Settings → Pages**: Source *Deploy from a branch*, branch `main`, folder `/ (root)`.
4. Your link appears after a minute or two, e.g. `https://yourname.github.io/batchwala/`.

Keep backup files and customer data **out of the repository**.

## First run

Open the link on your phone, tap **Start fresh**, enter your name and the business name. You become Admin. Then **More → Backup & restore → Load a backup file** and pick your existing backup: files from the earlier Bakery POS and from the Claude tracker convert automatically. Install to the home screen from Chrome (Install app) or Safari (Share → Add to Home Screen).

## Cloud sync with Google Drive (one-time setup, admin)

Google’s console screens change from time to time; names below may differ slightly.

1. Go to [console.cloud.google.com](https://console.cloud.google.com), create a project (e.g. “Batchwala”).
2. **APIs & Services → Library**: enable **Google Drive API**.
3. **OAuth consent screen**: choose *External*, fill the app name and your email, leave it in **Testing**, and add your and Neena’s Google emails as **test users**.
4. **Credentials → Create credentials → OAuth client ID**: type *Web application*. Under **Authorised JavaScript origins** add `https://yourname.github.io`.
5. Copy the client ID. Paste it into `js/config.js` (`GOOGLE_CLIENT_ID`) in GitHub, so every phone has it.
6. In the app on your phone: **More → Cloud sync → Connect Google Drive**. It creates the folder **Batchwala data** in your Drive.
7. **More → Users & roles**: add Neena with her Google email and role Management, then tap **Share the data folder with…**.
8. On Neena’s phone: open the link, **Join with Google**. She signs in and the app opens as Management.

While the app stays in Testing mode, Google shows an “unverified app” warning at sign-in; that is expected for a private app with listed test users. Sign-in lasts about an hour at a time; if sync shows “Needs attention”, tap **Sync now** to reconnect.

How sync works: each phone writes only its own file per month (`events_<phone>_<month>.jsonl`) in the folder and reads the others’ files, every minute and after each change. Two people working at the same time never overwrite each other. Payments and stock are added as new entries, never edited, so they always add up. If two phones edit the same order’s details at once, the later edit wins. A readable `Report_<date>.xlsx` is saved to the same folder once a day.

## Moving the data later

All storage goes through `js/sync.js`, which needs only an adapter that can list, read and write files (`js/storage/drive.js` is the Google Drive one). OneDrive needs a similar adapter. A database needs an adapter that writes the same events into a table. Because every change is an event with an ID, time and person, moving is a copy of the history, not a redesign.

## Using it on a PDA or scanner

Android handhelds install it through Chrome. Built-in scanners in keyboard mode type into the Stock search box, which matches ingredient barcodes. To publish on the Play Store later, wrap this code with [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap) or [Capacitor](https://capacitorjs.com).

## For developers

No build step: plain HTML, CSS and JavaScript modules. Run locally with `python3 -m http.server 8000`.

| File | Role |
| --- | --- |
| `js/events.js` | Event store on IndexedDB; current state is the fold of all events |
| `js/sync.js`, `js/storage/drive.js` | Sync engine and Google Drive adapter |
| `js/roles.js` | Roles and permissions |
| `js/model.js` | Totals, balances, customers, stock, multilevel costing and explosion, batches, bake board |
| `js/orders.js` | Today, Orders, order detail and history, order form |
| `js/money.js` | Payments, customers, reports |
| `js/inventory.js` | Bake board, recording a batch, stock, menu and recipes |
| `js/batches.js` | Batches register and batch detail |
| `js/pos.js` | Counter: takeaway, dine-in tables, Swiggy and Zomato |
| `js/bom.js` | BOM trees and the plan & explode view |
| `js/erp.js` | Production, GRNs, transfers, finished goods, outlet bake board |
| `js/help.js` | In-app Help topics |
| `js/data.js` | Import & export by data type, templates, purchase invoices |
| `js/match.js` | Name matching and checks before creating new records |
| `js/ocr.js` | Reading invoice photos and PDFs: pdf.js, Tesseract, optional Claude |
| `js/ops.js` | Delivery run, WhatsApp import, New-order menu |
| `js/waparse.js` | Reads a WhatsApp message into a draft order |
| `js/admin.js` | More, first run, users, settings, sync, backup, Excel |
| `tests/` | Fake shared folder for testing two-phone sync locally |
| `sw.js` | Offline cache; **bump `VERSION` on every release** |

Invoice reading loads pdf.js, Tesseract and the Anthropic SDK from jsDelivr on first use (versions pinned in `js/ocr.js`). To test against a local mirror, set `localStorage.setItem("bw.cdn","http://127.0.0.1:8766/npm")`. The optional Claude reading calls the Anthropic API from the browser with a key stored on the device (IndexedDB meta, not synced); it is meant for the owner’s own devices.

To test sync without Google: run `python3 tests/fake_drive.py . 8767`, open two browser profiles at `http://127.0.0.1:8767`, and in each run `localStorage.setItem("bw.testAdapter","http://127.0.0.1:8767")` in the console, then reload.
