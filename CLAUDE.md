# Epic Quote Generator V3 — Engineering Rules

This file is law for every contributor, human or AI. It exists because AI-generated code
drifts toward a recognizable disease: short, over-abstracted, locally-clever fragments that
optimize for fitting in one response instead of for the person who opens the file six months
from now. We write **humane code** here. Read this before touching anything.

## What this system is

A signage quoting platform for Epic Craftings: intake → custom quote wizard → editable
proposal (fixed 816px canvas, Canva-style) → PDF/PNG export → Shopify payment links →
Airtable-style versioning (revisions grouped into checkpoints, each with a rendered proposal
image, restorable). Laravel 12 API (MySQL, Sanctum bearer tokens) + React 19/Vite SPA.
Deployed on Render from the `second` remote; every push goes to BOTH remotes
(`git push origin main && git push second main`).

The people who use it are sign-shop reps, not engineers. Every feature maps to something a
rep physically does: quote a sign, mark its colors, send a deposit link, revise after the
customer calls back. When code and the real-world workflow disagree, the code is wrong.

## Humane code — the standard

**1. Write for the reader, not the reviewer.** The unit of quality is: can a tired dev who
has never seen this file understand it without opening five others? Prefer one coherent
200-line file over five 40-line fragments that each "do one thing" but force a scavenger hunt.

**2. Comments explain WHY, never WHAT.** The codebase's established idiom — keep it:

```js
// Cart PERMALINK, not the product page: /cart/{variant}:1 makes Shopify CLEAR any
// existing cart. Product-page links let every link a customer ever opened pile into
// one cart — they'd be billed for the whole queue of deposits at once.
```

A comment carries a constraint, a bug story, or a business rule the code cannot express.
If a comment restates the line below it, delete it. Reference the incident that shaped the
code ("the vanished-artwork bug", "#15 cross-contamination blunder") — those stories are the
project's institutional memory.

**3. No abstraction before the third use.** Two similar blocks of code are cheaper than one
wrong abstraction. Extract a helper only when (a) the logic exists in 3+ places, or (b) the
logic is a genuine invariant (e.g. `fitBounds` — "an image may never leave its box"). Never
create a helper, wrapper, service, or "utils" entry to make a diff look tidy.

**4. Edit in place; don't spawn files.** The default action on existing behavior is to edit
the file that owns it. New files are for genuinely new subsystems (a new command, a new
page), not for "cleaner organization" of code that already has a home. Dead code is deleted,
not commented out — git remembers. (Exception: deliberately dormant features, like the AI
wizard mode, stay as clearly-labeled commented blocks with revival instructions.)

**5. Global coherence beats local elegance.** Every value has ONE source of truth and one
name everywhere:
- `quote.price` = the GRAND TOTAL (unit × qty + line items). Payment links, dashboards,
  reports all read it. Never a second "total" field.
- `generated_data` = the entire wizard/editor state. Partial saves merge; they never wipe.
- Proposal geometry lives in `proposal_state.__layout`; swatches in `__swatches`; version
  history in `quote_revisions` grouped by `quote_checkpoints`.
- The wizard's input fields are the source of truth over any template default (a spec
  template inherits typed dims/depth/application, never the reverse).

Before changing any shared value, ripple-map it: grep every consumer, list them in the
commit message, and update all of them in the same commit.

**6. Explicit over clever.** No metaprogramming, no chained ternaries past one level, no
single-letter names outside tiny loop bodies, no `array_reduce` gymnastics where a foreach
reads plainly. PHP is boring Laravel; JS is boring React (hooks, no state libraries beyond
the existing zustand auth store and react-query).

**7. Real data is hostile.** This system imports decade-old CSVs typed by salespeople:
emails in phone columns, emoji in addresses, invisible unicode making "duplicate" company
names, 1×1 broken thumbnails, corrupted encodings. Every importer/parser must be
**idempotent** (safe to re-run, verified by running twice), must **report counts**, and must
be tested against the ugliest real rows before shipping.

## Architecture map (where things live)

```
backend/
  app/Http/Controllers/Api/   one controller per resource; authz FIRST line of every method
  app/Services/               real domain logic (RevisionRecorder, CheckpointService,
                              ShopifyService, CloudinaryService) — stateless, static-ish
  app/Observers/              QuoteObserver → every save() is versioned; never bypass save()
  app/Console/Commands/       operational tooling (imports, cleaners, one-time fixes);
                              ALL must be idempotent + support --dry-run where destructive
  database/migrations/        append-only; never edit a shipped migration
frontend/src/
  pages/                      one file per screen (Generator.jsx is the wizard; big is fine)
  components/Proposal.jsx     the proposal canvas — the heart; its editable blocks are
                              write-once DOM (EBlock/EditCell) so React can't clobber typing
  generator/                  catalog (sign types = verbatim V1 data), spec-line builder
  api/                        one thin fetch-wrapper per endpoint; no logic here
```

Rules baked into that structure:
- **Authorization on every route**: `visibleTo`/`isVisibleTo` scoping, admin-only checks in
  the controller, cross-parent guards (a checkpoint of quote A fetched via quote B = 404).
  Never trust a client-supplied ID chain.
- **Whitelists for restore/import writes** — no mass assignment from stored blobs.
- **Sanitize on write AND render** (`stripActiveHtml` server-side, `sanitizeHtml` client-side)
  because proposal blocks are innerHTML.
- **Secrets live in `.env` only.** Never in code, commits, logs, or chat.

## The working loop (how we run iterations)

1. **Reproduce before fixing.** A bug report gets a live reproduction (preview browser, real
   API calls) before any code changes. If you can't reproduce, say so — don't fix blind.
2. **Root cause, not symptom.** "The tooltip drifts" → find WHY (offsetX vs wrapper %), fix
   the cause, and say the cause in the commit. A fix without a stated root cause is a guess.
3. **Verify end-to-end before claiming done.** Drive the actual flow in the browser/API and
   capture the evidence (values before/after). "It should work" is not a verification.
4. **The GOLDEN RULE report.** Every iteration ends with two plain-language lists:
   *problems solved* (with proof) and *problems remaining* (honestly, including new debts).
5. **Never regress.** V3 is a strict superset of every earlier version. Removing or
   weakening an existing behavior requires an explicit decision recorded in docs/DECISIONS.md.
6. **Ship = both remotes.** Commit, then `git push origin main && git push second main`.
   Dockerfile changes need a Render rebuild — say so in the report.
7. **Data changes ship as commands, not hand-edits** — an artisan command in the repo,
   idempotent, dry-runnable, so prod can replay exactly what local did.

## Commit & documentation style

- Commits: `type(scope): what changed` + a body that tells the STORY — root cause, the
  decision, what was verified, and any follow-up needed. A future dev reading `git log`
  should understand the journey without the chat transcript.
- `docs/DECISIONS.md` — one dated line per irreversible/architectural decision and why
  (ADR-lite). Examples already made: MySQL over SQLite, cart permalinks over product pages,
  checkpoint-grouped revisions, client-side html2canvas export.
- `docs/` holds living operational guides (Shopify setup, platform map). Update the guide in
  the same commit as the behavior change — stale docs are worse than none.
- No auto-generated doc dumps. A doc exists because someone will read it before acting.

## Team process (decided 2026-07-13)

- **Tests**: Pest tests are REQUIRED for anything touching money (price math, payment
  links), permissions, or restore/delete. Other backend tests when the logic warrants.
  Frontend stays manual-E2E-verified. `backend/tests/Feature/` is the home;
  `php artisan test` must pass before pushing backend changes.
- **Backlog**: GitHub Issues + milestones on the origin repo. Iteration reports reference
  issue numbers; every bug found gets an issue before it gets a fix.
- **Git flow**: direct-to-main until the first dev lands; then feature branches + PR review
  with branch protection. (Flip the switch in the repo settings on that day.)

## QA / problem-finding discipline

- Hunt flaws proactively across BOTH modes and all sibling features of anything you touch —
  a fix to the artwork box gets the same question asked of package tiles and side views.
- The nastiest inputs are the standard test set: 6-digit prices, qty edits after payment
  links exist, restored old versions, hand-edited proposal blocks, cropped/zoomed/1×1
  artwork, companies with invisible-unicode names.
- Anything touching money, authz, or deletion gets an adversarial pass: "how would I bill
  the wrong amount / see someone else's quote / lose data with this change?"

## Anti-patterns (the AI-isms this file exists to kill)

- Helper/abstraction created for a single call site.
- A new file when editing the owning file would do.
- Renaming/reformatting untouched code in a feature diff.
- Silent behavior changes — anything a rep would notice goes in the report.
- "Fixed" without a reproduction and a stated root cause.
- Catch-and-ignore around code that can fail for reasons the user must know about.
- Local fix that breaks a sibling (the change wasn't ripple-mapped).
- Shortening/compressing working code to "clean it up" — length is not a defect;
  incomprehensibility is.
