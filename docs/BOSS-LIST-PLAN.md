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
| P0.2 | #25 Columns dropdown renders correctly (no grid overlap/push) | ⬜ | |
| P0.3 | #24 Sales-report chart: per-bar hover details panel | ⬜ | |
| P0.4 | #19 price reformat bug (delete+retype) fixed in MoneyInput globally | ⬜ | |
| P0.5 | #15 dimensions numeric-only (reuse the money/number input) | ⬜ | |
| P0.6 | #7 delete admin-only (button + server destroy()) | ⬜ | |
| P0.7 | #13 repless quotes visible to whole team + rep truly optional at intake | ⬜ | |
| P0.8 | #11 move "New quote" button to All Quotes (off Dashboard) | ⬜ | |
| P0.9 | #9 exiting a quote returns to the page you came from | ⬜ | |
| P0.10 | #21 clicking the artwork area opens the file picker | ⬜ | |
| P0.11 | #1 rename proposal "Side Views" → "Dimensions" | ⬜ | |

## Phase 1 — Contact split (#22) + Company autofill (#12)
| # | Item | Status | Evidence |
|---|---|---|---|
| P1.1 | #22 Contact → Phone (no letters) + Email; migrate + ripple (intake/edit/proposal/CSV) | ⬜ | |
| P1.2 | #12 Company autofill: type a known company name → prefill its saved values | ⬜ | |

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

## Learnings / notes
- (append as discovered)
