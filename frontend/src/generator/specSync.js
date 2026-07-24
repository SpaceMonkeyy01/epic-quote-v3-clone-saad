// Pure spec-text sync helpers for the manual (custom) mode: keep the free-form
// SPECIFICATION TEXT block in step with the dimension boxes and the application choice,
// so the proposal can never show numbers that differ from the fields (#9/#6).
// Extracted verbatim from Generator.jsx — no React state here; the setCustomSpec wrappers
// stay in the component.
import { parseDims, composeDims, cleanNum } from './questions'

// one dimension box changed → recompose the canonical H×W×D string AND keep the spec text's
// dimensions / returns / thickness lines in sync. The D box also drives the depth in
// RETURNS / LETTERS THICKNESS (#6). Returns the next customSpec object.
export const computeDimSpec = (part, v, cs) => {
  const p = parseDims(cs?.dims)
  p[part] = cleanNum(v)   // dimensions are numbers only (#15)
  const dims = composeDims(p.l, p.w, p.h)
  let specText = cs?.specText || ''
  if (/^(.*DIMENSIONS[^:]*):.*$/im.test(specText)) {
    specText = specText.replace(/^(.*DIMENSIONS[^:]*):.*$/im, `$1: ${dims}`)
  } else if (specText.trim() && dims.trim()) {
    // free-form spec with no dimensions line yet — add one right after SIGN TYPE (or on top)
    specText = /^SIGN TYPE\s*:.*$/im.test(specText)
      ? specText.replace(/^(SIGN TYPE\s*:.*)$/im, `$1\nOVERALL DIMENSIONS: ${dims}`)
      : `OVERALL DIMENSIONS: ${dims}\n` + specText
  }
  // depth (the D box) drives the construction depth lines: keep any suffix text
  // (RETURNS: 3" DEEP ALUMINUM → RETURNS: 5" DEEP ALUMINUM). Synced on EVERY dim edit —
  // not just when D itself changes — so a template default can never linger out of step.
  if (p.h) {
    specText = specText
      .replace(/^(RETURNS?\s*:\s*)(?:[\d./]+["”]\s*)?/im, `$1${p.h}" `)
      .replace(/^(LETTERS? THICKNESS\s*:\s*).*$/im, `$1${p.h}"`)
  }
  return { ...cs, dims, specText }
}

// Picking a sign type prefills its template spec — that template must immediately inherit the
// dims/depth/application ALREADY typed (the "RETURNS: 3 while depth is 1" flaw): the boxes are
// the source of truth, the template only supplies the missing lines.
export const syncSpecFromFields = (specText, cs) => {
  const p = parseDims(cs?.dims)
  const dims = composeDims(p.l, p.w, p.h)
  let s = specText || ''
  if (dims.trim()) {
    s = /^(.*DIMENSIONS[^:]*):.*$/im.test(s)
      ? s.replace(/^(.*DIMENSIONS[^:]*):.*$/im, `$1: ${dims}`)
      : (/^SIGN TYPE\s*:.*$/im.test(s) ? s.replace(/^(SIGN TYPE\s*:.*)$/im, `$1\nOVERALL DIMENSIONS: ${dims}`) : `OVERALL DIMENSIONS: ${dims}\n` + s)
  }
  // Depth owns the WHOLE value of the RETURNS line. The old rule only matched an optional
  // leading number and left the rest of the line standing, so a freshly prefilled FA template
  // (`RETURNS: [DEPTH]"`) came out as `RETURNS: 3" [DEPTH]"` — the depth landed but the
  // placeholder printed next to it on the proposal. `LETTER RETURNS:` is the same line under
  // another name in several FA templates and must be caught by the same rule.
  if (p.h) {
    s = s.replace(/^((?:[A-Z ]*\s)?RETURNS?\s*:\s*).*$/im, `$1${p.h}"`)
         .replace(/^(LETTERS? THICKNESS\s*:\s*).*$/im, `$1${p.h}"`)
  }
  // Quotes saved before the placeholders were suppressed still carry the literal tokens in
  // their spec text; they must never survive onto a proposal, filled or not.
  s = s.replace(/\[DEPTH\]["”]?/g, '').replace(/^([A-Z ]*RETURNS?\s*:)[ \t]+$/gim, '$1')
       .replace(/\[ASK REP\]/gi, '').replace(/[ \t]+$/gm, '')

  const app = cs?.application
  if (app) {
    s = /^APPLICATION\s*:.*$/im.test(s) ? s.replace(/^(APPLICATION\s*:\s*).*$/im, `$1${app}`) : s
  }
  return s
}

// the interior/exterior choice must land in the spec's APPLICATION line too (#6).
// Returns the next customSpec object.
export const computeApplicationSpec = (app, cs) => {
  let specText = cs?.specText || ''
  specText = /^APPLICATION\s*:.*$/im.test(specText)
    ? specText.replace(/^(APPLICATION\s*:\s*).*$/im, `$1${app}`)
    : (specText.trim() ? specText.replace(/\s*$/, '') + `\nAPPLICATION: ${app}` : specText)
  return { ...cs, application: app, specText }
}
