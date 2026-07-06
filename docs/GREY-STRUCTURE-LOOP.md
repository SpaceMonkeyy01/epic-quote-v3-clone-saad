# Grey-Structure Loop — self-correcting build agent

**/goal:** every functionality from the approved 19-task list built, verified in a real browser, and pushed — with zero data import. Loop ends when every iteration below is ✅ or explicitly ⛔blocked-on-Sami.

**Loop rules (each iteration):**
1. Do ONE iteration only — small enough for absolute attention.
2. VERIFY before ✅: `php -l` for backend, real-browser check for anything visible (G1), API probe for endpoints.
3. Push both remotes after each verified iteration (Render deploys from `second/main`).
4. Update this file: status, verification evidence (one line), anything learned.
5. If broken: fix within the same iteration or roll back the commit — never leave main red.
6. Stop rules: all ✅/⛔ → stop; same iteration fails 3 attempts → mark ⛔ with notes, move on, report to Sami.

**Memory:** this file is the single source of truth across sessions/compactions. Read it first on every wake.

---

## Iterations

| # | Task (approved list ref) | Status | Verification evidence |
|---|---|---|---|
| I1 | MoneyInput component (digits-only, $-formatted, clean re-entry) applied to wizard price + custom specs price (T3) | ✅ | browser: junk→1234.56, blur→$1,234.56, focus→plain, clamp 10M, Next-gate OK |
| I2 | New statuses: Rejected by Client, On Hold, Out of Scope + Test-quote flag excluded from all numbers (T6, T7) | ✅ | browser: 3 statuses in dropdown, On Hold persists after reload; TEST toggle → dashboard 9→8 quotes, pipeline −$1,200, 8→7 open; restored after. d157025 |
| I3 | Assigned-to: dropdown on All Quotes + "my quotes" filter + dashboard rows (T4) | ✅ | browser: team dropdown (10 users) on All Quotes, assign persists reload, My-quotes filter → only assigned row, dashboard Assigned column shows name; change logged in activity |
| I4 | Rush/Super Rush: setter UI + highlights + rush-first needs-attention + filter (T5) | ✅ | browser: Rush/Super Rush set + persist reload, colored badges on row, Rush-only filter → 2 rows, Super Rush jumps to top of needs-attention with badge; restored after |
| I5 | Breakeven production/shipping + auto profit $ and % (internal only) (T8) | ✅ | browser: BE 300+100 on $1,200 quote → Profit $800 (66.7%) auto, persists reload, clears to — when emptied; internal-only (never in proposal state) |
| I6 | Price approval: approved checkbox + who/when logged; approval lock blocks PDF/PNG/payment link (T9) | ✅ | browser: lock → PNG/PDF buttons disabled + banner, payment input disabled w/ hint; API: link stripped while locked, approve stamps Administrator+timestamp, link then sticks, buttons re-enable; restored |
| I7 | Follow-ups: fields + dashboard needs-follow-up queue + mark done (T10) | ✅ | browser: Follow-ups panel lists awaiting quotes oldest-first, inline notes persist reload, ✓ Sent drops row off queue instantly; restored after |
| I8 | Quote source at intake + filter (T11); the 3 note fields (T12); order-placed marker + date (T13) | ✅ | browser: intake source dropdown in Custom form, Referral filter → 1 row, 📦 tick stamps date + persists, 3 note lanes save on blur + survive reload; fixed update() rejecting source-clear; restored |
| I9 | Grid v1: reusable table — sortable columns, sticky header, row numbers (T1) on All Quotes | ✅ | browser: row numbers 1..n, Price ▲ asc/▼ desc/3rd click resets, empties sink last, thead position:sticky verified |
| I10 | Grid v2: column show/hide + inline cell editing + keyboard nav (T1) | ✅ | browser: ☰ Columns hides Breakevens+Contact (18→15 th), choice survives reload (localStorage), ArrowDown/Up hop rows in-column, Enter commits+moves down; inline edit already live |
| I11 | Grid v3: multi-row select + bulk status/assign/delete (T1) | ⬜ | |
| I12 | Grid v4: copy/paste + CSV export of filtered rows (T1, T2) | ⬜ | |
| I13 | Roles: quote_maker / account_manager / viewer + route guards + role-shaped home views (T14) | ⬜ | |
| I14 | Team transparency page: per-member cards, workload, drill-down (T15) | ⬜ | |
| I15 | Real time-to-Done from StatusHistory, per quote + per person (T16) | ⬜ | |
| I16 | Monthly reports: counts/amounts/conversion per real month + charts (T17) | ⬜ | |
| I17 | Side-view picker: category groups + search (T18) | ⬜ | |
| I18 | Sign-detail leftovers audit: trim/raceway/backer/wood color, font, return depth vs our Q&A (T19) | ⬜ | |
| I19 | Final sweep: rebuttal pass over everything built in I1–I18, fix findings | ⬜ | |

## Learnings / notes
- (append as discovered)
