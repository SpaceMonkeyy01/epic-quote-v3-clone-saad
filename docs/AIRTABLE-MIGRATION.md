# Airtable → Estimator Migration — Zero-Abstraction Working Document

**Goal (from the team meeting):** kill the existing Airtable dashboard / quote creation / managing / history and move the whole team onto the Estimator. Hard requirement: the Estimator must consume **every** Airtable feature the team actually uses AND be better — no desynchronized behavior, no abstraction, whatever it costs.

**How this document works** (per Sami's rules):
1. Section A = what the Estimator already has (native terms).
2. Section B = what the Airtable base(s) contain (filled during the read-only tour).
3. Section C = reconciliation: every Airtable feature → how it lands in our infra.
4. Section D = Sami's known asks, pre-mapped.
5. Section E = the phased build plan (updated as B/C fill in).
6. Section F = open questions for Sami (anything vague/uncertain stops here, per rule 4).

Status: **A and D drafted. B/C/E-details blocked on Airtable read access.**

---

## A. What the Estimator already has (current inventory, native terms)

### A1. Quote intake ("+ New quote" modal)
- Two modes chosen at intake: **Quote Generator (AI)** and **Custom Quote Creator (manual mode)**.
- AI mode: multi-file upload (drawings PDF/image, all files feed the AI) or paste-text extraction; Sales Rep (preset list + type-any-name "Other") and Payment link captured up front; Company required.
- Quote IDs auto-generated `EC{counter}` server-side; custom IDs must be EC+digits, case-insensitive-unique. Counter already **continues past Airtable's highest ID** when AIRTABLE_* env vars are set (scaffold live, credentials pending).

### A2. The wizard (Generator page)
- AI mode flow: Client Information → Project (AI summary of every retrieved field, "—" for unknowns, full-reading expander, Re-read, Replace-drawing with auto re-read) → Select Sign Type (41-type catalog + team custom types + type-your-own, saved for the whole team) → Specifications (page-per-type Q&A: split H×W(/D) dimension boxes AI-filled or required-manual, price required > $0, chips for trim/mount/illumination/colors) → Artwork & Notes → **Preview**.
- Manual mode flow: Client Information → Custom Specifications (full catalog dropdown + team types + new-type-with-template, dims boxes synced into spec text, price gate, special requirements) → Preview.
- **Live preview**: the real, editable proposal renders beside every step and updates ~1s after changes; edits in the panel auto-save and survive.

### A3. The proposal (preview step / live panel)
- Print-perfect page matching the Canva template: company/client info blocks, item table, SPECIFICATIONS, PACKAGE INCLUDES (centered, captioned INSTALLATION TAPE / POWER SUPPLY), SIDE VIEW (tiling, team library with named uploads, explicit "No side view" that removes the section), totals + 50/50 deposits, terms, CLICK-HERE-TO-MAKE-PAYMENT (validated links only).
- Everything editable in place; per-block dirty tracking (wizard-derived text follows the wizard unless hand-edited); ↻ Rebuild spec text; color swatches auto-anchored to FACE/RETURN color lines + color-picker from artwork; movable **size arrows** auto-seeded from dimensions over the artwork; artwork auto-cropped out of the customer drawing by the AI (padded, re-picked on Re-read, manual uploads never touched).
- Output: real vector **Save as PDF** (browser print) and PNG image (letterbox-corrected).

### A4. Dashboard (admin cockpit)
- KPIs: Quotes · last 30 days (+delta vs prior 30, sparkline), Pipeline value, Avg quote value, Needs attention.
- Needs-attention queue (status → next action, days waiting), clickable pipeline bar per status, recent-quotes table with search + status filter, extra "also waiting on…" chips.

### A5. All Quotes
- Search, status filter, inline edits (company/client/contact/rep), one primary **status** (10 statuses) + multi "waiting on…" chips (tags), file links (PDF/Art/Crunch), View / Edit / **History** / Delete (confirm).

### A6. Users & roles
- Roles today: **admin / manager / sales_rep** (role dropdown per user, reset PW, delete — deletion purges the user's activity trail). Non-admins only see their own quotes (`visibleTo`); admin-only pages: Users, Sales Reports, Activity Log.

### A7. Activity Log & analytics
- Every action recorded (create/edit/delete/status/tags/file uploads/AI runs/catalog saves/logins). Filters: user / quote ID / action; per-user analytics cards including zero-action members; `/activity?quote=…` deep link.

### A8. Sales Reports
- Per-rep (preset + every custom rep found on quotes): received / converted (Done) / conversion %, rolling 7 and 30 days.

### A9. Storage & integrations
- Uploads → Cloudinary (permanent CDN) with local-disk fallback; drawings viewable in-app (CDN-rasterized PDFs/AI files).
- Groq AI: extraction (multi-image), specs, side-view suggestion, artwork bounding box.
- Airtable sync scaffold (A1). Shopify payment-link automation: agreed design, awaiting store domain/token + deposit-vs-full decision.

### A10. Known gaps on our side (relevant to "better than Airtable")
- No spreadsheet-style grid editing (bulk edit, column sort on every column, keyboard navigation, copy/paste ranges).
- Price input is a plain number field (no currency masking/auto-format on re-entry — Sami's rule 7 example).
- No per-role tailored views (designer vs payment-checker etc.) — everyone sees the same pages, only admin vs non-admin differs.
- No order-fulfilment/delivery stages past "Done"; no due dates/assignments/attachments-per-stage.
- No notifications/reminders (Airtable often has automations).
- No CSV/Excel export.

---

## B. What's in Airtable (filled by the read-only tour — PENDING ACCESS)

For each base: tables → fields (name, type, options/formulas) → views (grid/kanban/calendar/gallery, their filters/sorts/groupings = the de-facto role views) → automations/forms if visible → record volume. Structure only; confidential values stay out of this doc.

## C. Reconciliation table (PENDING B)

| Airtable feature | Who uses it | Estimator equivalent today | Gap | How we build it (our infra) | Phase |
|---|---|---|---|---|---|

---

## D. Sami's known asks, pre-mapped to our infra

**D1. Admin dashboard, 100% team transparency** — extend the existing Dashboard + Activity analytics into a per-member drill-down: per-rep KPIs (received/converted/value, response times from status history), live "what is each person working on now" from Activity, per-quote timelines. Infra: `ActivityLog` + `StatusHistory` already store the raw events; new admin page composes them.

**D2. Role-based views (designer / quote generator+editor / payment checker / records+history)** — mirror of Airtable views. Infra: extend the `role` field beyond admin/manager/sales_rep, then per-role home pages that are *filters over the same quotes* (designer sees Artwork-Needed queue with drawings; payment checker sees Need-Payment-Link-Sent/paid states with the payment link tools; records role gets read-only History/All-Quotes). Exact roles copied from the Airtable views during the tour — not invented.

**D3. Quote → order fulfilment → delivery lifecycle** — statuses currently end at Done. Add post-quote stages (order confirmed → production → QC → shipped → delivered — exact stages from Airtable) with the same pipeline/dashboard treatment. Infra: extend STATUS_OPTIONS + `StatusHistory`; the confirm-order endpoint already exists as a stub.

**D4. Spreadsheet-grade table utils (rule 7)** — All Quotes (and any new grids) get: column sorting everywhere, column show/hide, sticky header, keyboard navigation, inline edit-on-click for every cell, copy/paste, multi-row select + bulk status/tag/delete, CSV export, currency-masked price cells (digits only; clearing and retyping reformats — Sami's explicit example), date formatting, row numbering. Build once as our own grid component, reuse on every table.

**D5. Zero desync (rule 5)** — during transition both systems live: two-way sync (A1 scaffold) grows to full field mapping (status, price, rep, client fields, timestamps) with webhook-or-polling pull from Airtable + push on every estimator write, conflict rule last-write-wins with the Activity Log recording every sync. After cut-over: one-time full import of ALL historical Airtable records into the estimator (history preserved), then Airtable goes read-only until killed.

---

## E. Phased plan (skeleton — final content after B/C)

- **Phase 0 — Access + tour**: read-only Airtable access, full structure survey, fill B/C, resolve F questions with Sami. Output: this doc completed and approved.
- **Phase 1 — Sync**: AIRTABLE_* credentials in Render; full field mapping both ways; historical import dry-run on local.
- **Phase 2 — Grid**: the spreadsheet-grade table component (D4) replacing the All Quotes table; price masking everywhere.
- **Phase 3 — Roles & views**: role model + per-role home pages copied from Airtable views (D2).
- **Phase 4 — Admin transparency dashboard** (D1).
- **Phase 5 — Fulfilment lifecycle** (D3) + any Airtable automations we must replicate (notifications/reminders).
- **Phase 6 — Cut-over**: full import, parallel-run checklist, Airtable read-only, team sign-off, kill.

## F. Open questions for Sami

1. *(access)* — see chat: the connector didn't reach this session.
2. Which Airtable plan are they on? (Determines whether automations/interfaces exist that I can't see via API and must be described by the team.)
3. Are there Airtable **forms** the team or customers fill? (Those become estimator pages.)
4. Who besides the quote team uses the base (production floor? accounting?) — decides which roles exist at cut-over.
5. During parallel-run, which system is the source of truth when both edit the same quote within the same minute? (Proposed: last write wins + logged; confirm.)
