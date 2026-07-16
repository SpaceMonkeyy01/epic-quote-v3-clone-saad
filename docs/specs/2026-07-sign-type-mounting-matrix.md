# SPEC: Sign-type × mounting matrix — wizard intelligence redesign

Status: DRAFT (awaiting data + approval)   Owner: Sami   Source sheet: QUOTE ESTIMATOR.xlsx → "FA" + "Sign Type Mapping"

## 1. Intent
Today the wizard shows a flat list of ~40 pre-combined sub-types where the mounting is baked into
the name (`HALO LIT CHANNEL LETTERS`, `…WITH RACEWAY`, `…WITH BACKER`, `…WITH ACM BACKER` are four
separate entries). The boss's standard sheet models it as a **matrix**: the rep picks a **base sign
type**, then a **mounting**, and the spec (returns, raceway/backer line, mounting line, side-view
diagram, package) is derived from that (type × mounting) pair. Many current mappings are wrong on
side-views, mountings, depths and illumination; this redesign makes the sheet the single source of
truth and generates correct specs from it.

## 2. Behavior contract
- GIVEN the wizard, WHEN the rep opens sign-type selection, THEN they first pick a **main category**
  (CHANNEL LETTERS, FLAT CUT LETTERS, CABINETS, BLADE SIGNS, NEON SIGNS, MONUMENT & PYLON, OTHER),
  then a **base sign type** inside it. (Same two-level UX as now, just base types not pre-combined.)
- GIVEN a base type is chosen, WHEN it supports multiple mountings, THEN a **Mounting** question
  offers exactly that type's mounting set (e.g. channel letters → Flush / Raceway 2" / Backboard
  Cabinet 2" / Flat Aluminum 2.5mm / Flat ACM 4mm / Flat Acrylic 8mm). Self-contained types
  (cabinets, monuments, pylon, blade) have a single/`N/A` mounting and skip the question.
- GIVEN flat-cut letters, WHEN chosen, THEN a **Thickness** axis also applies (1/8", 1/4", 3/8",
  1/2", 3/4"…) in addition to mounting.
- GIVEN (type × mounting[ × thickness]) is selected, WHEN the spec renders, THEN RETURNS,
  RACEWAY/BACKER line, MOUNTING line, side-view diagram and package reflect that exact combination.
- GIVEN an OLD saved quote whose sign type was a pre-combined name, WHEN it is reopened, THEN it
  still renders correctly (back-compat mapping — see §5). No saved quote may break or silently change.
- Unhappy paths: unknown/legacy type → falls back to a base type + best-guess mounting, never blank.
  A type with no side-view image yet → renders spec without the diagram, not an error.

## 3. Vertical slice
[ ] UI — two-level type picker (base types) + new Mounting step + Thickness step for flat-cut.
[ ] Data — new `catalog.js` model: base types + mounting overlays (from the approved CSV).
[ ] Spec builder — `buildSpecLines` derives lines from base + mounting overlay.
[ ] Side views — `sideviews.js` keyed by (type × mounting) → one of the 4 image sets.
[ ] Back-compat — legacy pre-combined names map to (base type + mounting).
[ ] Empty/error — missing image or unmatched legacy type degrade gracefully.

## 4. Impact map (consumers found via find-references — all must be updated together)
- `frontend/src/generator/catalog.js` — `T` array + `SIGN_GROUP_ORDER` + `signGroupOf` + `MOUNT_OPTS`
  (SOURCE OF TRUTH; new model lands here).
- `frontend/src/generator/questions.js` — `buildQuestions`: mounting becomes a primary axis; returns/
  raceway/backer become mounting-derived; add thickness question for flat-cut.
- `frontend/src/generator/proposal.js` — `buildSpecLines`: build from base + mounting overlay.
- `frontend/src/generator/sideviews.js` — `SIDE_VIEWS` keys + `SIGN_TO_SIDEVIEW` → keyed by (type ×
  mounting); wire in the 4 new image sets.
- `frontend/src/generator/QA.jsx` — renders `buildQuestions` output (mounting/thickness questions).
- `frontend/src/pages/Generator.jsx` — sign-type picker (L1005-1055), custom-spec picker (L1147+),
  `pickSideView` calls (L639, L1162), `buildSpecLines` call (L1157). Add mounting/thickness steps.
- `frontend/src/components/Proposal.jsx` — live preview + print, `buildSpecLines`, `SIDE_VIEWS`.
- `frontend/src/pages/AllQuotes.jsx` — imports `T` (sign-type dropdown/filter) — verify still valid.
- Backend: `quotes.generated_data` stores the chosen type + answers per part; AI sign-type matching
  keys off `t.n`. Renaming types ripples to both — see §5.

## 5. Money/Authz/Deletion + data-integrity adversarial questions
- **Saved-quote breakage (highest risk).** DECISIONS.md + `catalog.js` header: "sub-type names key off
  saved quotes + AI matching." Collapsing `HALO LIT…WITH RACEWAY` into `HALO LIT × Raceway` orphans
  every existing quote that stored the old name. MUST ship a legacy→(base+mounting) alias map so old
  `generated_data` rehydrates unchanged. Verify against real saved quotes before shipping.
- **Spec drift.** A wrong returns/depth or raceway line changes what's quoted/built. Every (type ×
  mounting) spec is validated against the approved CSV, not inferred.
- **Price.** No price math changes here; but the spec text feeds the proposal the customer signs —
  treat wrong specs as a correctness defect, not cosmetic.

## 6. Proof plan
- Golden-file test: for each approved (type × mounting), `buildSpecLines` output === the sheet's spec.
- Back-compat test: seed a quote with each legacy pre-combined name → reopens with correct base +
  mounting + identical rendered spec.
- Manual: drive the wizard through one channel-letter type across all 6 mountings; screenshot each
  proposal + side view.

## 7. Rollout
Frontend-only catalog/logic + new side-view PNGs into `backend/.../storage/app/public/side_views/`.
No migration if legacy alias map is complete (old `generated_data` untouched). Both remotes.

## 8. DATA CONTRACT — what's needed before implementation (blocking)
Fill `docs/sign-matrix/sign_matrix_template.csv` (117 rows already laid out; 12 specs + 26 base
fields pre-seeded from your sheets). Per row = one (type × mounting[ × thickness]) combo:
- `illumination, face, returns, trim_cap, raceway_backer, colors_asked, colors_fixed, dims_label,
  application` — the spec fields (or put the whole block in `full_spec`).
- `side_view_image` — the PNG filename for this combo (the 4 image sets).
- `package` — A/B/C/D (and a legend of what each package includes).
Open questions to confirm: (a) do all 9 channel-letter types share the same 6-mounting overlay, or do
some differ? (b) the 4 side-view image sets — which set maps to which mounting/type? (c) package
A/B/C/D contents.
