# Intelligent Extraction (Workstream B) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-identify sign type + side view + attachment from the customer drawing (Groq), restore the monument catalog and side-view library, and let the rep confirm — so quotes build with minimal typing.

**Architecture:** A deterministic sign-type→side-view map is the reliable prior; Groq `llama-4-scout` vision reads the drawing and proposes a side-view key; the frontend fuses them (agree → auto-select, else ranked candidates for one-click confirm). Monuments render a free-form AI spec body. All state persists in `generated_data`.

**Tech Stack:** Laravel 12 + Groq API, React 19 + Vite, SQLite.

## Global Constraints
- **Groq only**: `llama-3.3-70b-versatile` (text), `meta-llama/llama-4-scout-17b-16e-instruct` (vision). No Claude, no CLIP/embeddings.
- Both AI and Custom modes keep working; never break A.
- Reuse data — monument entries from `epic-estimator`, side-view PNGs from `epic-estimator/client/public/side-views/`. Don't recreate.
- Frontend has no test runner → manual verification. Backend has Pest.
- Repo `epic-quote-v3`, commit per task, push to `origin/main`. Never commit `.env`/sqlite/vendor/node_modules.
- Multi-line items are OUT (separate spec).

## File Structure
- `frontend/src/generator/catalog.js` — append 10 `mono` types.
- `frontend/src/generator/proposal.js` — `mono` branch in spec building.
- `frontend/src/generator/sideviews.js` *(new)* — `SIDE_VIEWS` list + `SIGN_TO_SIDEVIEW` map + `pickSideView()` fusion helper.
- `frontend/src/pages/Generator.jsx` — call detection, store chosen side-view + attachment.
- `frontend/src/components/Proposal.jsx` — side-view picker + render chosen side-views.
- `backend/app/Http/Controllers/Api/AiController.php` — vision returns `sideViewKey` + `sideViewConfidence`.
- `backend/storage/app/public/side_views/` — the construction PNGs (served by `/storage/{path}`, listed by `/api/side-views`).

---

### Task 1: Restore monument/cabinet types + free-form spec body

**Files:** Modify `frontend/src/generator/catalog.js`, `frontend/src/generator/proposal.js`

- [ ] **Step 1: Append the 10 monument entries** to the `T` array in `catalog.js` (lift verbatim — these match `epic-estimator/client/src/pages/QuoteGeneratorPage.jsx`):
```js
 {n:"DOUBLE-SIDED ILLUMINATED MONUMENT SIGN",mono:1,st:"DOUBLE-SIDED ILLUMINATED MONUMENT SIGN",illum:"led",pkgPower:1,mountDef:"BASE MOUNT",colors:[],desc:"DOUBLE-SIDED ILLUMINATED MONUMENT SIGN"},
 {n:"SINGLE-SIDED ILLUMINATED MONUMENT SIGN",mono:1,st:"SINGLE-SIDED ILLUMINATED MONUMENT SIGN",illum:"led",pkgPower:1,mountDef:"POLE MOUNT",colors:[],desc:"SINGLE-SIDED ILLUMINATED MONUMENT SIGN"},
 {n:"DOUBLE-SIDED NON-ILLUMINATED MONUMENT SIGN",mono:1,st:"DOUBLE-SIDED NON-ILLUMINATED MONUMENT SIGN",illum:"none",pkgPower:0,mountDef:"POLE MOUNT",colors:[],desc:"DOUBLE-SIDED NON-ILLUMINATED MONUMENT SIGN"},
 {n:"SINGLE-SIDED NON-ILLUMINATED MONUMENT SIGN",mono:1,st:"SINGLE-SIDED NON-ILLUMINATED MONUMENT SIGN",illum:"none",pkgPower:0,mountDef:"POLE MOUNT",colors:[],desc:"SINGLE-SIDED NON-ILLUMINATED MONUMENT SIGN"},
 {n:"ILLUMINATED MONUMENT SIGN",mono:1,st:"ILLUMINATED MONUMENT SIGN",illum:"led",pkgPower:1,mountDef:"POLE MOUNT",colors:[],desc:"ILLUMINATED MONUMENT SIGN"},
 {n:"DOUBLE SIDED MONUMENT SIGN WITH HALO LIT & FACE LIT CHANNEL LETTERS",mono:1,st:"DOUBLE SIDED MONUMENT SIGN WITH HALO LIT & FACE LIT CHANNEL LETTER",illum:"led",pkgPower:1,mountDef:"POLE MOUNT",colors:[],desc:"DOUBLE SIDED MONUMENT SIGN"},
 {n:"DOUBLE-SIDED DIGITAL MONUMENT SIGN",mono:1,st:"DOUBLE-SIDED DIGITAL MONUMENT SIGN",illum:"led",pkgPower:1,mountDef:"CONCRETE SUPPORT BASE MOUNTING",colors:[],desc:"DOUBLE-SIDED DIGITAL MONUMENT SIGN"},
 {n:"DOUBLE-SIDED NON-ILLUMINATED PYLON & MONUMENT",mono:1,st:"DOUBLE-SIDED NON ILLUMINATED PYLON & MONUMENT",illum:"none",pkgPower:0,mountDef:'MOUNTED ON (2) 3" X 3" SQUARE POLES',colors:[],desc:"DOUBLE-SIDED NON ILLUMINATED PYLON & MONUMENT"},
 {n:"TENANT MONUMENT SIGN",mono:1,st:"TENANT MONUMENT SIGN",illum:"none",pkgPower:0,mountDef:'2" SUPPORT POST',colors:[],desc:"SINGLE SIDED TENANT MONUMENT SIGN"},
 {n:"NON-ILLUMINATED CABINET",mono:1,st:"NON-ILLUMINATED CABINET",illum:"none",pkgPower:0,mountDef:'1.5" ANGLE WALL FRAME FOR MOUNTING',colors:[],desc:"NON-ILLUMINATED CABINET"},
```
(Note: `colors:[]` added so the existing `t.colors.length`/`t.colors.forEach` code never hits undefined.)

- [ ] **Step 2: Add a `mono` branch to `buildSpecLines`** in `proposal.js` (top of the function, before the channel-letter logic):
```js
export function buildSpecLines(t, a = {}, ai = null) {
  if (!t) return []
  if (t.mono) {
    const body = (ai && ai.fullSpec) ? ai.fullSpec : [
      'SIGN TYPE: ' + t.st,
      'OVERALL DIMENSIONS: ' + (a.dimensions || ''),
      'ILLUMINATED : ' + (t.illum === 'none' ? 'N/A' : (a.illumination || '6500K LED MODULES (3 YEAR WARRANTY)')),
      'MOUNTING: ' + (a.mounting || t.mountDef || ''),
      'PAINT FINISH: SATIN',
      'COLOR SPECS: ' + (a.colorspecs || ''),
      'APPLICATION: ' + (a.application || 'EXTERIOR'),
    ].join('\n')
    return String(body).split('\n')
  }
  // ...existing channel-letter logic unchanged...
```
And update the `Proposal.jsx` caller of `buildSpecLines(tpl, answers)` → `buildSpecLines(tpl, answers, aiResult)` (pass the existing `aiResult` prop).

- [ ] **Step 3: Verify (manual)** — `npm run dev`; in a quote, search sign types for "monument" → the 10 appear; pick one → proposal Specifications shows the free-form/monument block (or the AI `fullSpec` when present).

- [ ] **Step 4: Commit**
```
git add frontend/src/generator/catalog.js frontend/src/generator/proposal.js frontend/src/components/Proposal.jsx
git commit -m "feat(catalog): restore monument types + free-form monument spec body"
```

---

### Task 2: Restore the side-view image library

**Files:** copy into `backend/storage/app/public/side_views/`

- [ ] **Step 1: Copy the keyed PNGs** (already named by key) from the V2 public folder into v3 backend storage:
```
mkdir -p backend/storage/app/public/side_views
cp epic-estimator/client/public/side-views/*.png backend/storage/app/public/side_views/
```
(These filenames are the keys, e.g. `face-lit-raceway.png`, `halo-lit-acm-backer.png`.)

- [ ] **Step 2: Verify the API lists them** — backend running:
```
curl -s http://localhost:8000/api/side-views | head
```
Expected: JSON array of `{key, name, url}` with `url` like `/storage/side_views/face-lit-raceway.png`. Open one URL in the browser → image renders (via the `/storage` route).

- [ ] **Step 3: Commit** (PNGs are an asset the app needs — force-add despite the storage gitignore):
```
git add -f backend/storage/app/public/side_views
git commit -m "feat(assets): restore side-view construction images"
```

---

### Task 3: Sign-type → side-view map + fusion helper

**Files:** Create `frontend/src/generator/sideviews.js`

**Interfaces:**
- Produces: `SIDE_VIEWS` (array of `{key,label}`), `SIGN_TO_SIDEVIEW` (map sign-type name → key), `pickSideView(signTypeName, visionKey, visionConfidence)` → `{ selected: string|null, candidates: string[] }`.

- [ ] **Step 1: Create the file** with the library, the curated map, and the fusion:
```js
// Side-view keys mirror the PNG filenames in storage/app/public/side_views/.
export const SIDE_VIEWS = [
  { key: 'face-lit', label: 'FACE LIT' },
  { key: 'face-lit-raceway', label: 'FACE LIT WITH RACEWAY' },
  { key: 'face-lit-2in-backer', label: 'FACE LIT WITH 2IN DEEP ALUMINUM BACKER' },
  { key: 'face-lit-ac-backer', label: 'FACE LIT WITH AC BACKER' },
  { key: 'halo-lit-exposed-acrylic', label: 'HALO LIT (EXPOSED ACRYLIC)' },
  { key: 'halo-lit-inserted-acrylic', label: 'HALO LIT (INSERTED ACRYLIC)' },
  { key: 'halo-lit-2in-backer', label: 'HALO LIT WITH 2IN DEEP ALUMINUM BACKER' },
  { key: 'halo-lit-acm-backer', label: 'HALO LIT WITH ACM BACKER' },
  { key: 'halo-exposed-raceway', label: 'HALO LIT (EXPOSED) WITH RACEWAY' },
  { key: 'halo-traditional-raceway', label: 'HALO LIT TRADITIONAL WITH RACEWAY' },
  { key: 'front-and-side-lit', label: 'FRONT AND SIDE LIT' },
  { key: 'front-side-lit-raceway', label: 'FRONT & SIDE LIT WITH RACEWAY' },
  { key: 'front-side-lit-flat-backer', label: 'FRONT & SIDE LIT WITH FLAT ALUMINUM BACKER' },
  { key: 'front-side-lit-al-cabinet', label: 'FRONT & SIDE LIT WITH ALUMINUM BACKER CABINET' },
  { key: 'push-thru-halo-back', label: 'PUSH THRU WITH HALO BACK' },
  { key: 'push-thru-cabinet-halo', label: 'PUSH THRU CABINET WITH HALO LIT BACK' },
  { key: 'routed-backed-halo-back', label: 'ROUTED & BACKED UP ACRYLIC WITH HALO BACK' },
  { key: 'single-sided-cabinet', label: 'SINGLE SIDED CABINET' },
  { key: 'double-sided-cabinet', label: 'DOUBLE SIDED CABINET' },
  { key: 'trimless-face-lit-flush', label: 'TRIMLESS FACE LIT FLUSH MOUNT' },
  { key: 'trimless-face-lit-backer', label: 'TRIMLESS FACE LIT WITH BACKER' },
  { key: 'trimless-face-lit-raceway', label: 'TRIMLESS FACE LIT WITH RACEWAY' },
  { key: 'fabricated-acrylic-face', label: 'FABRICATED LETTERS — ACRYLIC FACE' },
  { key: 'metal-fab-stud', label: 'METAL FABRICATED — STUD MOUNT' },
  { key: 'metal-fab-acm-backer', label: 'METAL FABRICATED WITH ACM BACKER' },
  { key: 'metal-fab-raceway', label: 'METAL FABRICATED WITH RACEWAY' },
  { key: 'face-halo-lit-al-backer-raceway', label: 'FACE & HALO LIT — ALUMINUM BACKER & RACEWAY' },
]

// Curated prior: catalog sign-type name → most likely side-view key.
export const SIGN_TO_SIDEVIEW = {
  'FACE LIT CHANNEL LETTERS': 'face-lit',
  'FACE LIT CHANNEL LETTERS WITH RACEWAY': 'face-lit-raceway',
  'FACE LIT CHANNEL LETTERS WITH BACKER': 'face-lit-2in-backer',
  'FACE LIT CHANNEL LETTERS WITH ACM BACKER': 'face-lit-ac-backer',
  'HALO LIT CHANNEL LETTERS': 'halo-lit-exposed-acrylic',
  'HALO LIT CHANNEL LETTERS WITH RACEWAY': 'halo-traditional-raceway',
  'HALO LIT CHANNEL LETTERS WITH BACKER': 'halo-lit-2in-backer',
  'HALO LIT CHANNEL LETTERS WITH ACM BACKER': 'halo-lit-acm-backer',
  'FACE AND HALO LIT CHANNEL LETTERS': 'front-and-side-lit',
  'FACE & HALO LIT CHANNEL LETTERS WITH BACKER': 'front-side-lit-flat-backer',
  'FACE & HALO LIT CHANNEL LETTERS WITH ACM BACKER & RACEWAY': 'face-halo-lit-al-backer-raceway',
  'FACE & HALO LIT CHANNEL LETTERS ON FLAT ALUMINUM BACKER & RACEWAY': 'front-side-lit-raceway',
  'FACE & HALO LIT CABINET': 'front-side-lit-al-cabinet',
  'PUSH THRU ILLUMINATED CABINET (SINGLE SIDED)': 'single-sided-cabinet',
  'PUSH THRU ILLUMINATED CABINET WITH HALO LIT BACK': 'push-thru-cabinet-halo',
  'DOUBLE SIDED PUSH THRU ILLUMINATED CABINET': 'double-sided-cabinet',
  'SINGLE SIDED ILLUMINATED CABINET': 'single-sided-cabinet',
  'DOUBLE SIDED ILLUMINATED CABINET': 'double-sided-cabinet',
  'SINGLE SIDED ROUTED & BACKED UP ACRYLIC CABINET': 'routed-backed-halo-back',
}

const KEYS = new Set(SIDE_VIEWS.map((s) => s.key))

// Fuse the deterministic prior with the Groq-vision suggestion.
export function pickSideView(signTypeName, visionKey = null, visionConfidence = 0) {
  const mapKey = SIGN_TO_SIDEVIEW[signTypeName] || null
  const vKey = visionKey && KEYS.has(visionKey) ? visionKey : null
  // agree, or high-confidence vision → auto-select
  if (vKey && (vKey === mapKey || visionConfidence >= 0.8)) return { selected: vKey, candidates: [vKey] }
  if (mapKey && !vKey) return { selected: mapKey, candidates: [mapKey] }
  // disagree / low confidence → present both, prefer the map as default
  const candidates = [...new Set([mapKey, vKey].filter(Boolean))]
  return { selected: candidates[0] || null, candidates }
}
```

- [ ] **Step 2: Sanity-check the keys** — every value in `SIGN_TO_SIDEVIEW` and every `SIDE_VIEWS[].key` must have a matching PNG from Task 2:
```
ls backend/storage/app/public/side_views | sort > /tmp/have.txt
# eyeball that face-lit, face-lit-raceway, halo-lit-acm-backer, etc. all exist
```
Fix any key typos to match real filenames.

- [ ] **Step 3: Commit**
```
git add frontend/src/generator/sideviews.js
git commit -m "feat(sideviews): side-view library + sign-type map + fusion helper"
```

---

### Task 4: Side-view picker in the proposal

**Files:** Modify `frontend/src/components/Proposal.jsx`

**Interfaces:**
- Consumes: `SIDE_VIEWS` from Task 3; `sideViews` (array of keys) + `onSideViews(keys)` props passed from Generator (Task 6).

- [ ] **Step 1: Add a side-view section** to the proposal body (replace the static "Side View" placeholder with a thumbnail strip + a picker toggle). Render selected keys as images from `/storage/side_views/{key}.png`, and a checkbox grid (from `SIDE_VIEWS`) to add/remove. Capture selections into `proposal_state.side_views`. Minimal version:
```jsx
import { SIDE_VIEWS } from '../generator/sideviews'
// ...props: sideViews = [], onSideViews
const [picking, setPicking] = useState(false)
// in the spec-right column, under "SIDE VIEW":
<div>
  {sideViews.map((k) => (
    <img key={k} src={`/storage/side_views/${k}.png`} alt={k} crossOrigin="anonymous"
      style={{ maxWidth: 150, display: 'inline-block', margin: 4, border: '1px solid #ccc' }} />
  ))}
  <button type="button" onClick={() => setPicking(true)}>+ Side view</button>
  {picking && (
    <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginTop:8 }}>
      {SIDE_VIEWS.map((s) => (
        <label key={s.key} style={{ width:120, fontSize:10, textAlign:'center' }}>
          <input type="checkbox" checked={sideViews.includes(s.key)}
            onChange={(e) => onSideViews(e.target.checked ? [...sideViews, s.key] : sideViews.filter((x)=>x!==s.key))} />
          <img src={`/storage/side_views/${s.key}.png`} alt={s.label} style={{ width:'100%' }} />
          {s.label}
        </label>
      ))}
    </div>
  )}
</div>
```

- [ ] **Step 2: Verify (manual)** — open a proposal → "+ Side view" → grid shows thumbnails → tick one → it appears in the Side View box → Download PDF includes it.

- [ ] **Step 3: Commit**
```
git add frontend/src/components/Proposal.jsx
git commit -m "feat(proposal): side-view picker + render selected diagrams"
```

---

### Task 5: Groq-vision side-view suggestion (backend)

**Files:** Modify `backend/app/Http/Controllers/Api/AiController.php`

- [ ] **Step 1: Pass the side-view key list + ask for a match** — when `$imageDataUrl` is present, append to the prompt:
```php
$sideViewKeys = $request->input('side_view_keys', '');  // comma-separated, sent by the frontend
$prompt .= "\n\nSIDE VIEW: From this exact list of construction side-view keys — {$sideViewKeys} — pick the ONE whose construction best matches the drawing. Add to the JSON: \"sideViewKey\" (one key from the list, or null) and \"sideViewConfidence\" (0..1).";
```
And accept the two new keys in the returned JSON (they pass through `json_decode` already; no schema change needed).

- [ ] **Step 2: Verify (manual)** — with an image drawing attached, run AI; the `/api/ai/generate-specs` JSON includes `sideViewKey` + `sideViewConfidence` (inspect the network response). Text-only PDFs return `null` (expected — no image to see).

- [ ] **Step 3: Commit**
```
git add backend/app/Http/Controllers/Api/AiController.php
git commit -m "feat(ai): Groq vision suggests a side-view key + confidence"
```

---

### Task 6: Wire detection + attachment + persistence (frontend)

**Files:** Modify `frontend/src/pages/Generator.jsx`

**Interfaces:**
- Consumes: `pickSideView` (Task 3), `sideViewKey`/`sideViewConfidence` (Task 5), `SIDE_VIEWS` key list.

- [ ] **Step 1: Send the key list to the AI** — in `generateSpecs` call (api/quotes.js), add `side_view_keys`:
```js
export const generateSpecs = (quoteId, projectInfo, sideViewKeys = '') =>
  client.post('/ai/generate-specs', { quote_id: quoteId, project_info: projectInfo, side_view_keys: sideViewKeys }).then((r) => r.data)
```
In `runAI`: `import { SIDE_VIEWS, pickSideView } from '../generator/sideviews'`; pass `SIDE_VIEWS.map(s=>s.key).join(',')`.

- [ ] **Step 2: Fuse + store** — after `setAi(result)` and the sign-type match:
```js
const sv = pickSideView(found?.n || result.signType, result.sideViewKey, result.sideViewConfidence || 0)
setSideViews(sv.selected ? [sv.selected] : [])
setSideViewCandidates(sv.candidates)   // shown for one-click confirm if >1
```
Add `const [sideViews, setSideViews] = useState([])` and `const [sideViewCandidates, setSideViewCandidates] = useState([])`; load from `g.side_views` on mount.

- [ ] **Step 3: Persist** — include in `saveProgress` payload: `side_views: sideViews`. Pass `sideViews` + `onSideViews={setSideViews}` to `<Proposal>`. Attachment is already in `answers.mounting` + `tpl.rb`; surface it in the proposal spec (already rendered via `buildSpecLines`).

- [ ] **Step 4: Verify (manual, end-to-end)** — AI quote with an image drawing of a "Halo Lit + ACM Backer" sign → after extract, the proposal's Side View shows `halo-lit-acm-backer` auto-selected; if vision disagreed, both candidates show to pick. Reopen the quote → side-view persists.

- [ ] **Step 5: Commit**
```
git add frontend/src/pages/Generator.jsx frontend/src/api/quotes.js
git commit -m "feat(generator): hybrid side-view detection + persist chosen side-view"
```

---

## Self-Review
- **Spec coverage:** monuments+free-form (T1), side-view library (T2), map (T3), picker (T4), Groq-vision detect (T5), fusion+attachment+persist+render (T6). All six requirements covered.
- **Type consistency:** `pickSideView(signTypeName, visionKey, visionConfidence) → {selected, candidates}` used identically in T6; side-view keys are the PNG basenames throughout (T2/T3/T4); `buildSpecLines(t, a, ai)` 3-arg signature updated at its one caller.
- **Placeholders:** none — monument entries + map + fusion + prompt are written out; lifts point to exact source files.
- **Out of scope:** multi-line items (separate), Claude/CLIP (Groq chosen).
- **Risk noted:** Groq `llama-4-scout` is weak on detailed drawings — the deterministic map is the safety net and the rep confirms ambiguous picks; acceptable per the chosen engine.
