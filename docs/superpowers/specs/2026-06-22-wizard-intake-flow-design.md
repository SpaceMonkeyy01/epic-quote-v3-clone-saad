# Workstream A — Wizard & Intake Flow

Date: 2026-06-22
Status: design approved; pending spec review
Repo: epic-quote-v3

## Goal
Make the intake → wizard flow clean and correct so **both** AI-assisted and Custom
modes work end-to-end, the customer file is requested first, and the known UX/render
bugs are gone. Scope = flow + bugs. Intelligent extraction (correct party, sign type,
side view, attachment) is **workstream B** and is explicitly out of scope here.

## Requirements (from user feedback, 2026-06-19)
1. Mode is chosen **once** at intake; the wizard never re-asks (kill the second "Generator vs Custom" prompt).
2. Uploads accept **PDF + PNG/JPG/JPEG/WebP**, not PDF-only.
3. AI mode shows only **"Continue to Artwork"** as the forward action — no "Next".
4. The **customer PDF/image is demanded first**; the user must not retype what the PDF already contains.
5. **"View attached file"** must open the file, not a blank tab.
6. Uploaded **images render** in the proposal preview.
- Hard constraint: **both AI and Custom modes are mandatory and must work** — not a choice between them.

## Design

### Mode model
Two authoring modes, chosen once in the intake modal and carried into the wizard via the
quote's stored `quote_type` (`generator` = AI-assisted catalog flow, `custom` = free-form).
The wizard reads `quote_type` and renders that flow directly — **no mode picker**.

### Intake modal
- Pick **AI-assisted** or **Custom**.
- **First field (both modes): customer PDF/image** — accepts `.pdf` + images. Required in
  AI mode, optional in Custom.
- Other fields kept minimal: sales rep. In AI mode, company/client are **not** required to
  type (filled from the PDF by B; until B lands, they remain editable/blank). In Custom mode,
  company is entered.
- Create → navigate straight into `/quotes/{id}/generate` with the mode set. No re-ask.
- Backend change: `store` must accept a missing/blank `company_name` (default to a placeholder)
  so AI mode can be PDF-first without forcing the user to type the company.

### AI-mode wizard
- PDF present → (B) extracts & pre-fills; until B, the user fills the single consistent specs form.
- Forward action = **"Continue to Artwork"** only (remove "Next").
- Steps: specs review → artwork → proposal.

### Custom-mode wizard
- Goes **straight to the custom spec questions** (item description, dimensions, spec text,
  application, price). No AI, no mode picker.
- Steps: customspecs → artwork → proposal.

### Bug fixes
- **Accept images:** frontend `accept=".pdf,image/*"` and backend `mimes` already permit images;
  find and remove whatever currently rejects them (suspect: a stale validation or the file input).
- **View / render:** files are served via the `/storage/{path}` route (added in `d7751cd`).
  Verify the returned URLs resolve and the route works; harden. A **PDF cannot** be shown as an
  `<img>` — show a "View PDF" link; auto-previewing the PDF drawing as artwork = workstream B
  (rasterize page 1).

## Out of scope (→ workstream B)
- Extracting the correct party (retail client vs end customer), sign type, side view, and
  attachment details from the PDF.
- PDF → image rasterization for the proposal artwork.

## Acceptance criteria
- **Custom mode:** create → custom questions immediately (no mode re-ask) → artwork → proposal → PDF.
- **AI mode:** create with a PDF → wizard → only "Continue to Artwork" (no "Next") → proposal.
- Uploading an **image** renders it in the preview and "View" opens it in a new tab.
- Both modes reach a downloadable proposal without dead ends.
