# Epic Quote V3 — Platform Map

Plain-English map of the whole tool. Zero shortcuts. This is the shared reference we both check against before any change.

Last built: 2026-06-30. Rebuild this when the app changes.

Stack in one line: React screens in the browser, a Laravel server holding the data, one database, AI specs come from Groq.

---

## 1. What this tool is for

Internal tool for the Epic Craftings team to make sign quotes. A rep takes a customer's drawing or brief, the tool (with AI help) fills in the sign type and specs, builds a printable proposal, and tracks every quote through a pipeline of statuses until it's done. Not for customers. One-time quote creation, no client login.

---

## 2. Who can log in

Accounts are seeded on every deploy. Two privilege levels only:
- **admin** — sees everything (all quotes, Users, Sales Reports, Activity Log).
- **everyone else (sales_rep, manager)** — sees only their own quotes, no admin pages. Note: "manager" has NO extra power; it is treated the same as a rep.

Guaranteed login (hardcoded in the seeder, resets every deploy): `test@123.com` / `123456789!`. This is a security issue, flagged in section 9.

Seeded people: rod + ed (reps), sami (manager, no admin powers despite the "Awaiting Sir Sami Response" status existing), and admins alishan, faraz, musavir, khola, khansa, usmanaltaf. Their passwords come from environment variables; if unset, a random one is printed once at boot.

Only two names count as real sales reps for assignment and reports: **Rod Muffet** and **ED**.

---

## 3. The pages (every screen, who can open it)

| URL | Screen | Who |
|---|---|---|
| `/` | redirects to `/login` | anyone |
| `/login` | Sign in | anyone |
| `/dashboard` | Dashboard (home) | logged in |
| `/quotes` | All Quotes table | logged in |
| `/quotes/{id}/generate` | Quote builder (the wizard) | logged in |
| `/companies/{id}` | Company detail | logged in, but **not built — shows "coming soon"** |
| `/users` | Users | admin only |
| `/reports` | Sales Reports | admin only |
| `/activity` | Activity Log | admin only |
| anything else | redirects to `/dashboard` | logged in |

Left sidebar (always on, after login): logo, Dashboard, All Quotes, then Users / Sales Reports / Activity Log (admins only), then the person's name + role + Log out.

---

## 4. Page by page

### 4.1 Sign in (`/login`)
Left: a blueprint-style graphic with "Estimator" tag and the line "Create quotes, send proposals, and manage the pipeline." Right: logo, "Sign in to continue", Email-or-username field, Password field with show/hide eye, "Forgot password?" (just shows "Ask your administrator to reset your password" — no real reset), Log in button, "EPIC CRAFTINGS TEAM" divider, "Need access? Contact your administrator." On small screens the left panel hides. On success it goes to the dashboard.

### 4.2 Dashboard (`/dashboard`) — the home page
Top: title "Dashboard" + a `+ Add Quote` button (opens the New Quote popup, section 4.4).

Four number tiles (not clickable):
1. Quotes (this month) — count of quotes this month.
2. Total Amount (month) — sum of this month's prices, with `$`.
3. Pending — count of quotes not yet "Done".
4. Conversion — percent of quotes that became orders, with `%`.

Then a grid of status tiles, one per status (the 10 in section 5). Each shows the status name + how many quotes are in it. These ARE clickable: clicking one filters the quote grid below to that status; clicking it again clears.

Toolbar: a search box (searches quote ID, company, job, client) and a status dropdown ("All statuses", "Pending (not Done)", then each status).

Below: a grid of quote cards (section 4.3). Shows "Loading…" or "No quotes found." when empty.

### 4.3 Quote card (the tile shown on the dashboard)
Shows: quote ID, company name (bold), price (`$`, defaults to 1,200 if blank). Then Job and Client lines if present. Then a rep badge ("No rep" if none) + the created date.

Controls on the card:
- Status dropdown — change the status right there.
- Tags — existing tags each with an `×` to remove; a `+ tag` to add. Catch: the tag choices are the SAME list as the statuses, which is odd (section 9).
- Buttons: "Make Quote" (or "Continue / Edit" if the quote was already started) → opens the wizard; "Company" → the unbuilt company page; "Delete" → confirm then delete.

### 4.4 New Quote popup (from the dashboard `+ Add Quote`)
Step 1 — pick how to start:
- **AI Mode** — upload the customer's PDF/image (or paste the brief); AI reads it and pre-fills sign type + specs.
- **Custom** — write the spec yourself, straight to the questions, no AI.

Step 2 — the details form. Fields: customer file (AI mode reads it immediately to auto-fill), Company Name, Client Name, Contact, Address, Job Name, Sales Representative (admins pick from the list; reps are locked to themselves), a brief/special-requirements box (AI mode can "auto-fill fields from this text"), an optional Payment link, and (Custom mode) an optional file.
Auto-fill only fills BLANK fields — it never overwrites what you typed.
On submit it creates the quote (gets an auto ID like EC100001, price defaults to 1,200, status "To Do") and jumps into the wizard carrying the chosen mode in the link.

### 4.5 The quote builder / wizard (`/quotes/{id}/generate`)
Two modes, chosen at creation:
- **AI / Generator mode** steps in order: Project → Sign type → Specs → Artwork → Proposal. (There is also a Client step, only reachable by pressing Back from Project.)
- **Custom mode** steps: Custom specs → Proposal.

Top of every step: the title, the quote ID + company, an Exit button, and a progress bar.

**Client step** (Back-only): Company name, Client name, Contact, Address, Job name. Next saves these to the quote.

**Project step**: Special Requirements box; the customer file (view attached / replace); a `⚡ Generate Specs with AI` button. After AI runs it shows the read-back of everything it found (client, end customer, sign type, dimensions, returns, trim cap, mounting, illumination, face/return color, application, price, notes, plus the full extracted spec). Next saves the requirements and moves on.

**Sign type step**: a searchable list of sign types; the AI-suggested one is marked `⚡ AI suggested`. Pick one, Next. WARNING: this Next button is where the edit-by-back bug lives (section 9) — it re-seeds the spec answers and can wipe them.

**Specs step**: the per-sign-type questions (section 4.6), pre-filled from AI where possible. Next: Upload Artwork.

**Artwork step**: shows the current artwork; upload an image; Skip or Next. Next saves progress (this is the first point the specs actually get saved).

**Custom specs step** (custom mode): quick template buttons (Halo Lit Channel Letters, Illuminated Cabinet, LED Neon, Flat Cut Letters, Push Thru Cabinet), then Item Description, Dimensions, Price, Application (Exterior/Interior), and a big Specification Text box. Next saves and goes to the proposal.

**Proposal step**: the live, editable proposal (section 4.7). "Save & Return to Dashboard" saves and leaves.

### 4.6 The spec questions (per sign type)
Always asks dimensions first. Then, depending on the sign type: illumination, mounting, returns/thickness, trim cap, neon colors, face/return colors (Black/White), color specs, application, and price (defaults to 1,200). Monument/free-form types get a shorter set. Answers flow straight into the proposal's specification block and seed the color swatches.

### 4.7 The proposal (the printable document)
A fixed letter-size sheet, everything editable in place: contact block, the info grids (company/client/contact/address and proposal ID/date/job), item description, unit/total price, the specifications body, notes, subtotal, the two 50% deposit lines, terms, and the payment line. If a payment link exists it becomes a "CLICK HERE TO MAKE PAYMENT" button; if not, that line is editable text.

Extras on the proposal:
- **Color swatches** — draggable chips; pick a color with the native picker, type a name/PMS, or use the **eyedropper** to grab a color straight off the artwork (with a magnifier loupe). Add more with "+ Add color swatch".
- **Side views** — pick from the side-view image library; the AI suggests one. Each placed image is Canva-style: select, drag, resize from corners, rotate.
- **Package images** — Installation Template + Power Supply, also movable.
- Save edits, download PNG, download PDF (PDF is built in the browser for now).

Everything you move/edit/pick is saved into the quote so it comes back next time.

---

## 5. The quote lifecycle (the 10 statuses, in order)
To Do → In Progress → Artwork Needed → Quote Approval Needed → Need Payment Link Sent → Need To Share With Customer → Awaiting Customer Response → Awaiting Rod Response → Awaiting Sir Sami Response → Done.

New quotes start at "To Do". "Pending" = anything not "Done". Every status change is timestamped in history.

---

## 6. What the data holds

**A quote** stores: quote ID, order ID, company (name + link), client name, contact, address, job name, special requirements, the customer file, sales rep, source, status, tags, price (default 1,200), mode (generator/custom), artwork, crunched artwork, payment link, who created it, who finalized it, and a big `generated_data` bundle.

**The `generated_data` bundle** (the wizard's working memory) holds: mode, the chosen sign-type name, the question answers, the AI result, the artwork path, the chosen side views, the full proposal layout/edits, the payment link, and the job name.

**Other tables**: companies + their representatives, quote line-items (built but UNUSED — specs live in the bundle instead), status history, orders, payments, an activity log, and a settings key/value store (counters, logo).

---

## 7. The server endpoints (what the browser calls)

- Public: `GET /health`, `POST /login`.
- Account: `POST /logout`, `GET /me`, `GET /constants` (statuses, reps, sources, roles, sign types).
- Quotes (logged in, but reps only see their own): list, create, view, edit, delete, change status, change tags, upload customer file, upload artwork, upload crunched artwork, get/save the generated bundle. Payment-link get/put, confirm-order, and server PDF download are **stubs (not implemented)**.
- AI: `generate-specs` (reads the file/brief, returns the spec JSON), `extract-party` (pulls company/client/contact/address/job from a file or text).
- Dashboard + reports: `GET /dashboard`, `GET /reports/sales-reps` (admin), `GET /activity` (admin).
- Settings: get/set logo, list side views.
- Users (admin): list, create, view, update, delete, change password.

---

## 8. Admin-only pages

- **Users** — table of username, full name, email, role, last login. Inline-edit name/email/role, Reset PW (prompts for a new one), Delete (not yourself), and an Add User popup.
- **Sales Reports** — per rep (Rod, ED): this-week and this-month blocks showing quotes received, converted, and conversion %.
- **Activity Log** — last 150 actions: when, who, action, details.

---

## 9. Known broken or half-built things (fix list)

These are real, found in the code. The golden-rule "problems that still exist" list starts here.

1. **Edit-by-back wipes specs.** Opening a started quote drops you on the Proposal; to change anything you press Back through the steps. Pressing Back to the Sign-type step and Next again re-runs one line that resets the answers — if the AI data wasn't saved, your specs become blank; even with AI, it overwrites manual edits. This is the #1 complaint and is a single hot line in the wizard (Generator.jsx, the Sign-type Next button).
2. **Reopening a quote never re-runs AI or side-view/sign-type matching.** Those only run during the first AI pass. On reopen they're only read back from saved data, so nothing recomputes.
3. **AI result isn't saved until a later step.** Running AI alone saves nothing; it's only stored when a save happens further on. If a session ends before that, the AI data is gone on reopen (which then triggers problem #1).
4. **Conversion / sales numbers read 0.** The dashboard and reports count "orders", but nothing in the app ever creates an order (confirm-order is a stub). So Conversion %, orders, and total sales value are effectively always 0.
5. **Stubbed features:** payment-link save, confirm-order, and server-side PDF download all return "not implemented". PDF is currently built in the browser only.
6. **Company page is "coming soon"** but quote cards still have a "Company" button that leads there.
7. **Tags reuse the status list.** You can only tag a quote with words that are also statuses, which is confusing and limits tagging.
8. **Sign-type list mismatch.** The proposal catalog has 41 sign types, but AI can only pick from 29. Some catalog types can't be auto-matched. (Memory said "41" — the AI side is 29.)
9. **Quote line-items table exists but is unused** — every spec lives in the JSON bundle, so multi-sign quotes and clean reporting aren't really supported yet.
10. **Hardcoded admin login** `test@123.com` / `123456789!` is committed and recreated on every deploy. Security risk.
11. **No real password reset** — "Forgot password?" just tells you to ask an admin.
12. **Artwork can silently fail to save.** If the upload errors, the browser still shows a local preview, but nothing is stored, so the artwork is missing on reopen.

---

## 10. Roadmap parking (fill in when the roadmap script arrives)
_Boss is sending a full roadmap for the platform + dashboard. Map each roadmap item to the pages/data above before building, run the golden rule, and update this file._
