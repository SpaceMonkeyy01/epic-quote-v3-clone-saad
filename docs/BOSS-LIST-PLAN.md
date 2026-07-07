# Boss List — 26-item execution plan

Same loop discipline as GREY-STRUCTURE-LOOP: ONE iteration at a time, verify in a real
browser + `php -l`, push BOTH remotes (origin + second), tick the row with evidence.
Never leave main red. Report problems-solved + problems-remaining each iteration.

## Locked decisions (from Sami, 2026-07-06)
- **Multi-sign**: one quote, parts labelled **A, B, C…**. Same quote/item number, each part
  has its OWN complete preview + unique details (spec, dims, qty, unit price, artwork).
  Per-quote stays shared: status, sales rep, approval, rush, company, revision history.
  Quote total = Σ(part qty × unit price). Dashboard pipeline value & reports sum the parts.
- **Repless quotes** (rep = N/A): visible to the WHOLE team.
- **Contact**: split into **Phone** (digits/space/()+-. only, no letters) + **Email** (optional, letters ok).
- **Preview ↔ wizard**: FULL round-trip — editing either side updates the other live.

## Default interpretations (flagged; reversible)
- #1 "side rows → Dimensions": rename the proposal's **Side Views** section/label to **Dimensions** (those drawings are dimension views). Confirm if wrong.
- #3 "stale canvas": to be identified live (candidates: duplicate live-preview vs preview-step render, or the always-mounted eyedropper canvas).
- #8 CSV new cols: Crunch dims, Dimensions, Text (=spec/sign copy), Proposal (=status/link), "All Quotes" (=export mirrors the grid's visible columns). Confirm "Text/Proposal/All Quotes" meanings.

---

## Phase 0 — independent quick wins (no dependency on the big model)
| # | Item | Status | Evidence |
|---|---|---|---|
| P0.1 | #23 sticky column headers in All Quotes actually stick on scroll | ✅ | browser: header delta 0 after scroll, no double-scroll; app shell now single-scroll (.main), grid table border-collapse:separate fixes sticky-th; dashboard/reports still scroll fine |
| P0.2 | #25 Columns dropdown renders correctly (no grid overlap/push) | ✅ | root cause: checkboxes inherited text-input width:100%/padding, stretching to 220px & shoving labels right. Global checkbox/radio reset + explicit 16px in picker → compact 170px panel, checkbox+label adjacent. Bonus: all row checkboxes now consistent gold |
| P0.3 | #24 Sales-report chart: per-bar hover details panel | ✅ | browser: hover any month → floating panel (created/quoted value/won/won value/conversion) + bar+label highlight; full-height hit area. Also fixed a P0.1 regression: .main flex-column squashed the chart panel (34px) → reverted .main to block, .fill-page fills height instead |
| P0.4 | #19 price reformat bug (delete+retype) fixed in MoneyInput globally | ✅ | browser: grid price cell idle="$10,000,000.00", delete+retype "4200"+blur → "$4,200.00" auto. Root cause: grid used plain type=number (no format); added money mode to EditCell (fmt idle / clean on entry) for price + both breakevens; wizard already used MoneyInput |
| P0.5 | #15 dimensions numeric-only (reuse the money/number input) | ✅ | shared cleanNum() in questions.js applied to setDim (QA wizard) + setCustomDim (manual mode) — letters/symbols stripped, one dot kept |
| P0.6 | #7 delete admin-only (button + server destroy()) | ✅ | API: rep deleting own quote → 403 "Only admins can delete quotes", admin → 200. Frontend row Delete now admin-only (was !readOnly); bulk delete already admin-only |
| P0.7 | #13 repless quotes visible to whole team + rep truly optional at intake | ✅ | API: admin creates rep="" quote → a random non-admin sees+opens it (200) but still 404 on a rep-owned quote. Rep validation relaxed (blank=N/A) in store()+update(); intake + grid rep dropdowns have "N/A"; non-admins still can't assign to others |
| P0.8 | #11 move "New quote" button to All Quotes (off Dashboard) | ✅ | browser: Dashboard shows "View all quotes →" (no New quote); All Quotes has "+ New quote" (opens AddQuoteModal). Modal+state moved from Dashboard to AllQuotes |
| P0.9 | #9 exiting a quote returns to the page you came from | ✅ | browser: opened EC100011 from All Quotes → Exit → landed /quotes (not /dashboard). Generator reads location.state.from (default /quotes); AllQuotes/Dashboard/AddQuoteModal pass from= on open |
| P0.10 | #21 clicking the artwork area opens the file picker | ✅ | artwork step is now a clickable dashed dropzone → opens the file picker (+ drag-drop); mirrors the proven hidden-input+.click() pattern used for the customer-file upload; build clean |
| P0.11 | #1 rename proposal "Side Views" → "Dimensions" | ✅ | browser: proposal section heading now "DIMENSIONS" (no "SIDE VIEW"); picker button "Choose dimensions", search + no-view labels renamed too |

## Phase 1 — Contact split (#22) + Company autofill (#12)
| # | Item | Status | Evidence |
|---|---|---|---|
| P1.1 | #22 Contact → Phone (no letters) + Email; migrate + ripple (intake/edit/proposal/CSV) | ✅ | API: contact "call 972-361-0700 ext"→"972-361-0700" (letters stripped, server+client), email column persists. Intake Phone+Email fields; grid Phone header + Email in CSV/modal; Generator client Phone+Email; proposal shows PHONE + conditional EMAIL |
| P1.2 | #12 Company autofill: type a known company name → prefill its saved values | ✅ | browser: typing "Signarama" in intake autofilled Address "14430 Midway Rd…" + Phone "972-361-0700" from its last quote; datalist suggests known companies; only fills blank fields; GET /companies/suggest scoped to visibleTo |

## Phase 2 — Sign-type hierarchy (#14)
| # | Item | Status | Evidence |
|---|---|---|---|
| P2.1 | #14 catalog → parent type + sub-types (backer/raceway variants) in wizard/AI/manual/proposal | ⬜ | |

## Phase 3 — Line-items / multi-sign model (#5, #6, #18) — the spine
| # | Item | Status | Evidence |
|---|---|---|---|
| P3.1 | Activate QuoteItem model: parts A/B/C, per-part spec/dims/qty/unit price/artwork | ⬜ | |
| P3.2 | #5 editable quantity, total = qty×unit (read-only in preview) | ⬜ | |
| P3.3 | #6 multiple previews under one quote page, unique per part | ⬜ | |
| P3.4 | #18 installation as a charged line item beneath item details | ⬜ | |
| P3.5 | ripple: quote total, dashboard pipeline value, reports, CSV all sum parts | ⬜ | |

## Phase 4 — Proposal UX (#2, #3, #4, #16, #17)
| # | Item | Status | Evidence |
|---|---|---|---|
| P4.1 | #2 action buttons to the right of the preview | ⬜ | |
| P4.2 | #3 remove the stale/extra canvas | ⬜ | |
| P4.3 | #4 one-shot complete view (whole page fits, no dead scroll) | ⬜ | |
| P4.4 | #17 drop Additional Notes when Specifications overflow | ⬜ | |
| P4.5 | #16 full two-way wizard↔preview sync | ⬜ | |

## Phase 5 — Roles: designer (#10)
| # | Item | Status | Evidence |
|---|---|---|---|
| P5.1 | #10 designer role limited to design-related columns/fields | ⬜ | |

## Phase 6 — Revision history (#20)
| # | Item | Status | Evidence |
|---|---|---|---|
| P6.1 | #20 track every change; store each preview as revision 1,2,3… (all parts) | ⬜ | |

## Phase 7 — CSV + Team page (#8, #26)
| # | Item | Status | Evidence |
|---|---|---|---|
| P7.1 | #8 CSV: add Crunch dims/Dimensions/Text/Proposal/All-Quotes cols + resizable widths | ⬜ | |
| P7.2 | #26 Team page redesign (useful, not dull) | ⬜ | |

## Phase S — Shopify payment links (PRIME PRIORITY)
Decisions: product-page link; always 50/50 (deposit before ship, balance after) + full option; ≤$500 → full only; inventory tracked US qty 1 (as manual); image = clean preview (no price block); token via SHOPIFY_API_TOKEN env; product fields: title "{QuoteID} - {ItemDesc}", type=sign type, vendor "EpicCraftings", category best-effort, status unlisted, published online store.
| # | Step | Status | Evidence |
|---|---|---|---|
| S1 | Private ledger: payment_links table + searchable page (title/image/specs/company/dimensions/price/email-phone/kind/status/who) + mark paid/void | ✅ | browser: /payment-links lists rows, image thumb+lightbox, kind pills, ✓ Paid stamps date, Void; scoped to visibleTo; nav link added |
| S2 | "Can create payment links" per-user permission | ✅ | API: new user default False; grant→True; admin always True. Users page has a 💳 Links checkbox per user (disabled+checked for admins); User::canCreatePaymentLinks() gates create |
| S3 | Clean preview PNG (no subtotal/deposit block) for the product image | ✅ | [data-price-block] wraps exactly SUBTOTAL/50% DEPOSIT/50% SHIPMENT + pay button (no spec leak); render({clean}) hides it during html2canvas + restores; captureCleanImage() exposed via forwardRef/useImperativeHandle for S5; proposal still renders normally |
| S4 | Shopify product service (dormant till token): product + variants (Full/Deposit), image, unlisted, online store, ≤$500 rule → product-page link | ⬜ | |
| S5 | "Create payment link" button on the quote → pick Full/Deposit/Balance → creates + stores in ledger | ⬜ | |
| S6 | Paid detection: orders/paid webhook (or manual) → flip ledger + quote status | ⬜ | |
| S7 | Privacy + end-to-end verify + Shopify setup doc | ⬜ | |

## Learnings / notes
- (append as discovered)
