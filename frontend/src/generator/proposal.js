/* Proposal spec-line builder — ports V1 templateSpecLines() / V2 buildSpecBody().
   Generates the Specifications block from a sign-type template + captured answers. */

const ILLUM_DEFAULT = '6500K LED MODULES (3 YEAR WARRANTY)'

export function money(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Returns an array of spec lines for a generator-mode quote.
export function buildSpecLines(t, a = {}) {
  if (!t) return []
  const L = []
  L.push(t.st)
  L.push('FACE: ' + t.face)
  if (t.neon) L.push('NEON COLORS: ' + (a.neoncolors || ''))
  ;(t.extra || []).forEach((x) => L.push(x))
  L.push((t.dimsLabel || 'OVERALL DIMENSIONS') + ': ' + (a.dimensions || ''))
  if (t.ret !== null && t.ret !== undefined) L.push('RETURNS: ' + (a.returns || t.ret))
  if (t.neon) L.push('SHAPE: CUT TO SHAPE')
  L.push((t.illum === 'none' || t.neon ? 'FINISH' : 'PAINT FINISH') + ': SATIN')
  if (t.trim !== null && t.trim !== undefined) L.push('TRIM CAP: ' + (a.trimcap || t.trim))
  if (t.illum === 'led') L.push('ILLUMINATED : ' + (a.illumination || ILLUM_DEFAULT))
  if (t.illum === 'bulb') L.push('ILLUMINATION: ' + (a.illumination || 'BULBS 2" DIAMETER BULBS'))
  if (t.illum === 'faux') L.push('ILLUMINATED : ' + (a.illumination || 'FAUX LED TUBING'))
  if (t.illum === 'neon') L.push('ILLUMINATED : YES')
  if (t.illum === 'none') L.push('ILLUMINATED : N/A')
  L.push('MOUNTING: ' + (a.mounting || t.mount))
  if (t.rb) L.push(t.rb)
  ;(t.extra2 || []).forEach((x) => L.push(x))
  if (t.colors && t.colors.length) {
    L.push('COLOR SPECS:')
    t.colors.forEach((c, i) => {
      const v = c.fixed !== undefined ? c.fixed : (a['color_' + i] || '')
      L.push('  • ' + c.l + ': ' + v)
    })
  }
  L.push('APPLICATION: ' + (a.application || t.app || 'EXTERIOR'))
  return L
}
