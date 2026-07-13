# Decisions log (ADR-lite)

One dated line per architectural / irreversible decision, with the WHY. Append-only.
When a decision is reversed, add a new line — don't rewrite history.

- **2026-06-19** — Rebuild as Laravel + React (V3) instead of extending the Flask V1: the
  team needs auth, roles, a real DB, and a deployable service; V1 stays the feature floor
  (V3 must remain a strict superset).
- **2026-06-24** — Proposal export is client-side html2canvas + jsPDF (HD_SCALE 3), not
  server-side rendering: the proposal is a live-edited DOM; capturing exactly what the rep
  sees beats re-rendering it on a server (Gotenberg remains a future option).
- **2026-07-06** — Uploads go to Cloudinary when configured, local public disk otherwise:
  Render's disk is wiped on deploy, which is how the team lost old drawings.
- **2026-07-09** — Field-level versioning via a model observer (every `save()` recorded),
  full snapshot per revision, 60s same-user merge window. Column is `field_changes`, not
  `changes` — Eloquent has an internal `$changes` property that silently shadows it.
- **2026-07-10** — Revisions are grouped into **checkpoints** (`{quote_id}-rev{n}`), minted
  by "Done" and by payment creation, each carrying one rendered proposal image; restore
  applies a checkpoint's snapshot through `save()` so restores are themselves versioned.
- **2026-07-10** — Database moved SQLite → local MySQL via `db:copy-from-sqlite` (IDs
  preserved, counts verified). Company-name duplicates that MySQL's collation considers
  equal (case/trailing-space/ignorable chars) are merged at copy time, contacts remapped.
- **2026-07-13** — Payment links are single-item **cart permalinks** (`/cart/{variant}:1`),
  never product pages: Shopify clears the existing cart, so a customer can never be billed
  for a queue of previously opened links.
- **2026-07-13** — Proposal images live under a bounds contract (`fitBounds` in AdjImg):
  an image may never leave its section box; oversize shrinks keeping aspect ratio.
- **2026-07-13** — Engineering rules codified in CLAUDE.md ("humane code"): no abstraction
  before the third use, why-comments, edit-in-place, one source of truth per value,
  idempotent data commands, GOLDEN RULE iteration reports.
- **2026-07-13** — Multi-sign quotes: a quote is an ordered list `generated_data.parts[]`
  (A, B, C…), one client, one combined total (`quote.price` = Σ parts). The preview stacks a
  full proposal page per sign; per-part prices are hidden — only the last page shows the
  combined total, deposit, payment and downloads. One Shopify product per quote: total amount,
  one clean image per sign, deduped title "A & B FOR Company". The version image stitches every
  page. Legacy single-sign quotes lazy-wrap to `parts[0]` on load — no migration. A top-level
  mirror of `parts[0]` is still written to `generated_data` (NOT removed): the backend price
  fallback for truly-legacy rows and PaymentLinkController's product body_html read it. It is a
  documented compat field, not dead data — the first part is always a valid single sign.
