import { MOUNT_OPTS, TRIM_OPTS, ILLUM_OPTS } from './catalog'

/* Adaptive question builder — ported verbatim from V1 buildQuestions().
   `ai` is the optional AI spec result; its values become highlighted defaults. */
export function buildQuestions(t, ai = {}) {
  ai = ai || {}
  const qs = []

  // Dimensions are 2D (Height × Width) for every standard sign — depth is NOT a dimension
  // here, it lives in its own Returns/Thickness question (or is fixed, e.g. flat-cut letters).
  // Only monuments are true 3D boxes with L × W × H.
  qs.push({
    key: 'dimensions', type: 'dims',
    q: t.mono ? 'Overall dimensions (L × W × H)' : 'Overall dimensions (H × W)',
    parts: t.mono ? 3 : 2,
    def: ai.dimensions || null, aiSet: !!ai.dimensions,
  })

  // monuments are free-form — ask only the high-level fields (V2 parity); spec body comes from AI fullSpec
  if (t.mono) {
    if (t.illum === 'led') qs.push({ key: 'illumination', q: 'Illumination?', type: 'chips', options: ['6500K LED MODULES (3 YEAR WARRANTY)', '3500K LED MODULES (3 YEAR WARRANTY)', 'N/A'], def: ai.illumination || '6500K LED MODULES (3 YEAR WARRANTY)' })
    qs.push({ key: 'mounting', q: 'Mounting?', type: 'text', def: ai.mounting || t.mountDef || '', placeholder: t.mountDef, aiSet: !!ai.mounting })
    qs.push({ key: 'colorspecs', q: 'Color specs? (PMS / named colors)', type: 'text', def: ai.colorSpecs || null, placeholder: 'e.g. BLACK 6 C', aiSet: !!ai.colorSpecs })
    qs.push({ key: 'application', q: 'Application?', type: 'chips', options: ['EXTERIOR', 'INTERIOR'], def: (ai.application === 'EXTERIOR' || ai.application === 'INTERIOR') ? ai.application : 'EXTERIOR', aiSet: !!ai.application })
    qs.push({ key: 'price', q: 'Enter the price (USD)', type: 'number', def: ai.price != null ? String(ai.price) : '1200', placeholder: 'e.g. 5256', aiSet: ai.price != null })
    return qs
  }

  if (t.neon) qs.push({ key: 'neoncolors', q: 'Neon colors?', type: 'text', placeholder: 'e.g. PINK & WHITE' })

  if (t.ret !== null && t.ret !== undefined) {
    qs.push({ key: 'returns', q: 'Returns / Thickness?', type: 'text', def: ai.returns || t.ret, placeholder: t.ret, aiSet: !!ai.returns })
  }

  if (t.trim !== null && t.trim !== undefined) {
    const opts = TRIM_OPTS.includes(t.trim) ? TRIM_OPTS : [t.trim, ...TRIM_OPTS]
    qs.push({ key: 'trimcap', q: 'Trim Cap?', type: 'chips', options: opts, def: (ai.trimcap && opts.includes(ai.trimcap)) ? ai.trimcap : t.trim, aiSet: !!ai.trimcap })
  }

  const mopts = MOUNT_OPTS.includes(t.mount) ? MOUNT_OPTS : [t.mount, ...MOUNT_OPTS]
  const racewayNote = t.n.includes('RACEWAY') ? ' (raceway sign type — defaulting to raceway mounting)' : ''
  qs.push({
    key: 'mounting', q: 'Mounting option?' + racewayNote, type: 'chips', options: mopts,
    def: (ai.mounting && mopts.includes(ai.mounting) && !t.n.includes('RACEWAY')) ? ai.mounting : t.mount, aiSet: !!ai.mounting,
  })

  if (t.illum === 'led') qs.push({ key: 'illumination', q: 'Illumination?', type: 'chips', options: ILLUM_OPTS, def: (ai.illumination && ILLUM_OPTS.includes(ai.illumination)) ? ai.illumination : ILLUM_OPTS[0] })
  if (t.illum === 'bulb') qs.push({ key: 'illumination', q: 'Illumination (bulbs)?', type: 'text', def: 'BULBS 2" DIAMETER BULBS' })
  if (t.illum === 'faux') qs.push({ key: 'illumination', q: 'Faux neon tubing color/spec?', type: 'text', def: 'FAUX LED TUBING' })

  t.colors.forEach((c, i) => {
    if (c.ask) {
      let aiCol = null
      if (/FACE/.test(c.l) && ai.faceColor) aiCol = ai.faceColor
      else if (/RETURN|TRIM/.test(c.l) && ai.returnColor) aiCol = ai.returnColor
      qs.push({ key: 'color_' + i, q: 'Color Specs — ' + c.l + '?', type: 'chips', options: ['BLACK', 'WHITE'], def: (aiCol === 'BLACK' || aiCol === 'WHITE') ? aiCol : null, aiSet: !!aiCol })
    }
  })

  qs.push({ key: 'application', q: 'Application?', type: 'chips', options: ['EXTERIOR', 'INTERIOR'], def: (ai.application === 'EXTERIOR' || ai.application === 'INTERIOR') ? ai.application : (t.app || 'EXTERIOR'), aiSet: !!ai.application })
  qs.push({ key: 'price', q: 'Enter the price (USD)', type: 'number', def: ai.price != null ? String(ai.price) : '1200', placeholder: 'e.g. 1200', aiSet: ai.price != null })

  return qs
}

// Dimensions: keep L×W×H as separate values so the team can't mangle the format.
// parseDims splits an existing/AI string into parts; composeDims rebuilds the
// canonical `20" x 20" x 3"` string (only the filled parts, always ` x `-joined).
export function parseDims(str) {
  if (!str) return { l: '', w: '', h: '' }
  const p = String(str).split(/\s*[x×*_]\s*/i).map((s) => s.replace(/["'″′]/g, '').trim())
  return { l: p[0] || '', w: p[1] || '', h: p[2] || '' }
}
export function composeDims(l, w, h) {
  return [l, w, h].map((v) => String(v ?? '').trim()).filter((v) => v !== '').map((v) => v + '"').join(' x ')
}

// Pre-fill answers from AI defaults (V1 autoAnswerFromAI)
export function autoAnswerFromAI(t, ai) {
  const qs = buildQuestions(t, ai)
  const answers = {}
  qs.forEach((q) => {
    if (q.type === 'dims') {
      // normalize the AI's raw string into parts + the canonical composed string,
      // dropping the depth part for 2-part (H × W) sign types
      const p = parseDims(q.def)
      answers.dim_l = p.l
      answers.dim_w = p.w
      answers.dim_h = (q.parts || 3) === 3 ? p.h : ''
      answers.dimensions = composeDims(answers.dim_l, answers.dim_w, answers.dim_h)
      return
    }
    if (q.def != null) answers[q.key] = q.def
    else if (q.type === 'chips' && q.options?.length) answers[q.key] = q.options[0]
    else answers[q.key] = ''
  })
  return answers
}
