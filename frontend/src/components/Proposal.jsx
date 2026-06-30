import { useEffect, useMemo, useRef, useState } from 'react'
import html2canvas from 'html2canvas'
import { buildSpecLines, money, esc } from '../generator/proposal'
import { SIDE_VIEWS } from '../generator/sideviews'
import { fileUrl } from '../api/client'

/* M2 proposal preview: renders the captured quote as a print-ready document.
   Every labelled block is contentEditable; edits are captured into proposal_state
   (persisted via the wizard's saveProgress) and survive reopen. Export = client-side
   html2canvas → PNG/jsPDF (server-side Gotenberg comes in P7). */

const TERMS_HTML =
  '<b>Note:</b><br>' +
  '• Epic Craftings will begin your project only after receiving your signed approval on the order confirmation document along with the 50% down payment.<br>' +
  '• This Quote is valid for 30 Days Only.<br><br>' +
  '<b>Terms &amp; Conditions</b><br>' +
  '• The price includes the sign and delivery; installation is not included.<br>' +
  '• Ensure all spellings, designs, and dimensions are accurate before confirmation.<br>' +
  '• Products come with a 3-year warranty on parts.<br>' +
  '• A 5% tolerance in color and dimensions is acceptable.<br>' +
  "• Installation must follow UL and NEC guidelines and is the customer's responsibility.<br>" +
  '• Payment terms: 50% deposit upfront, remaining 50% before shipment. Orders under USD 500 are paid in full in advance.'

const HEAD = '#e9e9e9'
const cell = { fontSize: 11, border: '1px solid #777', padding: '6px 8px', outline: 'none' }
const headCell = { ...cell, background: HEAD, fontWeight: 700, borderTop: 'none' }
// Section header bar inside the single-framed specs/package box — border only on the bottom; the outer
// box + the left column's right edge supply the frame, so the divider stays one continuous line.
const secHead = { background: HEAD, fontWeight: 700, fontSize: 11, padding: '5px 8px', borderBottom: '1px solid #777' }
// Standard package items shown on every proposal (matches the approved template)
const PACKAGE = [
  { label: 'INSTALLATION TEMPLATE', img: '/package/installation-template.png' },
  { label: 'POWER SUPPLY', img: '/package/power-supply.png' },
]

// Canva-style adjustable image. Click to select, then:
//  • drag the body to move, the top grip to rotate
//  • CORNER circles resize (scale the image)
//  • EDGE bars crop (shrink the visible window; the image itself stays put and is clipped)
// Absolute-positioned, so changing one never reflows the page. Geometry (incl. the crop window
// ix/iy/iw/ih) is reported up via onLay; selection chrome carries "adj-ui" so PDF capture hides it.
function AdjImg({ rk, def, lay, onLay, src, alt, lockAspect, cors, scaleRef, selected, onSelect }) {
  const init = lay || def
  const [box, setBox] = useState(() => ({
    x: init.x, y: init.y, w: init.w, h: init.h, rot: init.rot || 0,
    ix: init.ix ?? 0, iy: init.iy ?? 0, iw: init.iw ?? init.w, ih: init.ih ?? init.h,
  }))
  const rootRef = useRef(null)
  const start = (kind, handle) => (e) => {
    e.preventDefault(); e.stopPropagation(); onSelect()
    const sx = e.clientX, sy = e.clientY, b0 = { ...box }, sc = scaleRef.current || 1
    let cx = 0, cy = 0
    if (kind === 'rot' && rootRef.current) { const r = rootRef.current.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2 }
    const move = (ev) => {
      const dx = (ev.clientX - sx) / sc, dy = (ev.clientY - sy) / sc
      if (kind === 'move') { setBox({ ...b0, x: Math.round(b0.x + dx), y: Math.round(b0.y + dy) }); return }
      if (kind === 'rot') { setBox({ ...b0, rot: Math.round(Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180 / Math.PI + 90) }); return }
      if (kind === 'resize') {
        const L = handle.includes('l'), T = handle.includes('t'), R = handle.includes('r'), B = handle.includes('b')
        let w = b0.w, h = b0.h
        if (R) w = b0.w + dx; if (L) w = b0.w - dx; if (B) h = b0.h + dy; if (T) h = b0.h - dy
        w = Math.max(30, Math.round(w)); h = Math.max(20, Math.round(h))
        if (lockAspect && b0.w) h = Math.max(20, Math.round(w * b0.h / b0.w))  // keep the logo's proportions
        let x = b0.x, y = b0.y
        if (L) x = Math.round(b0.x + (b0.w - w)); if (T) y = Math.round(b0.y + (b0.h - h))
        const rw = w / b0.w, rh = h / b0.h   // scale the image (crop window) with the frame
        setBox({ ...b0, w, h, x, y, ix: Math.round(b0.ix * rw), iy: Math.round(b0.iy * rh), iw: Math.round(b0.iw * rw), ih: Math.round(b0.ih * rh) })
        return
      }
      // crop: move one frame edge, keep the image absolutely still → clips it
      let { x, y, w, h, ix, iy } = b0
      if (handle === 'r') w = Math.max(24, Math.round(b0.w + dx))
      if (handle === 'b') h = Math.max(24, Math.round(b0.h + dy))
      if (handle === 'l') { const nw = Math.max(24, Math.round(b0.w - dx)); const used = b0.w - nw; x = Math.round(b0.x + used); w = nw; ix = Math.round(b0.ix - used) }
      if (handle === 't') { const nh = Math.max(24, Math.round(b0.h - dy)); const used = b0.h - nh; y = Math.round(b0.y + used); h = nh; iy = Math.round(b0.iy - used) }
      setBox({ ...b0, x, y, w, h, ix, iy })
    }
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); setBox((b) => { onLay(b); return b }) }
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up)
  }
  const dot = { position: 'absolute', width: 11, height: 11, background: '#fff', border: '1.5px solid #8b5cf6', borderRadius: '50%', zIndex: 60 }
  const corners = { tl: { left: -6, top: -6, cursor: 'nwse-resize' }, tr: { right: -6, top: -6, cursor: 'nesw-resize' }, bl: { left: -6, bottom: -6, cursor: 'nesw-resize' }, br: { right: -6, bottom: -6, cursor: 'nwse-resize' } }
  const bar = { position: 'absolute', background: '#fff', border: '1.5px solid #8b5cf6', borderRadius: 2, zIndex: 60 }
  const edges = {
    l: { left: -4, top: '50%', marginTop: -11, width: 7, height: 22, cursor: 'ew-resize' },
    r: { right: -4, top: '50%', marginTop: -11, width: 7, height: 22, cursor: 'ew-resize' },
    t: { top: -4, left: '50%', marginLeft: -11, width: 22, height: 7, cursor: 'ns-resize' },
    b: { bottom: -4, left: '50%', marginLeft: -11, width: 22, height: 7, cursor: 'ns-resize' },
  }
  return (
    <div ref={rootRef} data-rk={rk} onMouseDown={start('move')}
      style={{ position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h, transform: `rotate(${box.rot}deg)`, cursor: 'move' }}>
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
        <img src={src} alt={alt} draggable={false} crossOrigin={cors ? 'anonymous' : undefined}
          onLoad={lockAspect ? (e) => { const r = e.target.naturalWidth / e.target.naturalHeight; if (r > 0) setBox((b) => { const h = Math.max(20, Math.round(b.w / r)); return { ...b, h, ix: 0, iy: 0, iw: b.w, ih: h } }) } : undefined}
          style={{ position: 'absolute', left: box.ix, top: box.iy, width: box.iw, height: box.ih, objectFit: 'contain', display: 'block', pointerEvents: 'none' }} />
      </div>
      {selected && (
        <>
          <div className="adj-ui" style={{ position: 'absolute', inset: 0, border: '1.5px solid #8b5cf6', pointerEvents: 'none' }} />
          {Object.entries(corners).map(([c, pos]) => (
            <span key={c} className="adj-ui" title="Resize" onMouseDown={start('resize', c)} style={{ ...dot, ...pos }} />
          ))}
          {Object.entries(edges).map(([c, pos]) => (
            <span key={c} className="adj-ui" title="Crop" onMouseDown={start('crop', c)} style={{ ...bar, ...pos }} />
          ))}
          <span className="adj-ui" onMouseDown={start('rot')} title="Rotate"
            style={{ position: 'absolute', top: -26, left: '50%', marginLeft: -8, width: 16, height: 16, background: '#fff', border: '1.5px solid #8b5cf6', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#8b5cf6', cursor: 'grab', zIndex: 60 }}>⟳</span>
        </>
      )}
    </div>
  )
}

// Luminance-based text color so the swatch label stays readable on any fill.
function swatchText(hex) {
  const h = (hex || '').replace('#', '')
  if (h.length < 6) return '#111'
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? '#111' : '#fff'
}

// Canva-style draggable color swatch: a filled block + name that PRINTS, plus a picker popover
// (color wheel + name field) carrying className "adj-ui" so it is hidden from the PDF/PNG capture.
function AdjSwatch({ rk, sw, onChange, onRemove, onPick, canPick, scaleRef, selected, onSelect, onDragEnd, locked }) {
  const startDrag = (e) => {
    if (e.target.closest('.adj-ui')) return            // don't drag while using the picker
    e.preventDefault(); e.stopPropagation(); onSelect()
    if (locked) return                                  // FACE / RETURN&TRIM are auto-anchored, not draggable
    const sx = e.clientX, sy = e.clientY, x0 = sw.x, y0 = sw.y, sc = scaleRef.current || 1
    const move = (ev) => onChange({ ...sw, x: Math.round(x0 + (ev.clientX - sx) / sc), y: Math.round(y0 + (ev.clientY - sy) / sc) })
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); onDragEnd && onDragEnd() }
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up)
  }
  // Horizontal-only resize from the right edge.
  const startResize = (e) => {
    e.preventDefault(); e.stopPropagation(); onSelect()
    const sx = e.clientX, w0 = sw.w, sc = scaleRef.current || 1
    const move = (ev) => onChange({ ...sw, w: Math.max(28, Math.round(w0 + (ev.clientX - sx) / sc)) })
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up) }
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up)
  }
  const has = !!sw.color
  const bg = has ? sw.color : '#e5e5e5'
  return (
    <div data-rk={rk} onMouseDown={startDrag}
      style={{ position: 'absolute', left: sw.x, top: sw.y, width: sw.w, height: sw.h, cursor: 'move' }}>
      <div style={{ width: '100%', height: '100%', background: bg, color: swatchText(bg), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, border: '1px solid rgba(0,0,0,0.3)', overflow: 'hidden', padding: '0 4px', boxSizing: 'border-box' }}>
        {sw.name || ''}
      </div>
      {selected && (
        <>
          <div className="adj-ui" style={{ position: 'absolute', inset: -2, border: '1.5px solid #8b5cf6', pointerEvents: 'none' }} />
          <span className="adj-ui" onMouseDown={startResize} title="Drag to widen"
            style={{ position: 'absolute', right: -5, top: '50%', marginTop: -8, width: 9, height: 16, background: '#fff', border: '1.5px solid #8b5cf6', borderRadius: 2, cursor: 'ew-resize', zIndex: 71 }} />
          <div className="adj-ui" onMouseDown={(e) => e.stopPropagation()}
            style={{ position: 'absolute', top: '100%', left: 0, marginTop: 6, zIndex: 70, background: '#fff', border: '1px solid #8b5cf6', borderRadius: 6, padding: 8, display: 'flex', gap: 6, alignItems: 'center', boxShadow: '0 4px 12px rgba(0,0,0,0.18)', textTransform: 'none', width: 246 }}>
            <input type="color" value={has ? sw.color : '#000000'} onChange={(e) => onChange({ ...sw, color: e.target.value })}
              title="Pick color" style={{ width: 34, height: 30, padding: 0, border: 'none', background: 'none', cursor: 'pointer' }} />
            {canPick && (
              <button type="button" onClick={onPick} title="Pick a color from the artwork (works in every browser)"
                style={{ border: '1px solid #ccc', background: '#fff', borderRadius: 4, cursor: 'pointer', padding: '4px 5px', display: 'flex', alignItems: 'center' }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#333" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m2 22 1-1h3l9-9" /><path d="M3 21v-3l9-9" /><path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z" /></svg>
              </button>
            )}
            <input type="text" value={sw.name || ''} placeholder="name / PMS" onChange={(e) => onChange({ ...sw, name: e.target.value })}
              style={{ flex: 1, fontSize: 12, padding: '4px 6px', border: '1px solid #ccc', borderRadius: 4 }} />
            <button type="button" onClick={onRemove} title="Remove swatch"
              style={{ border: 'none', background: '#fee', color: '#c00', borderRadius: 4, cursor: 'pointer', fontWeight: 700, padding: '4px 7px' }}>×</button>
          </div>
        </>
      )}
    </div>
  )
}

const LOUPE = 185, SRC = 38   // eyedropper magnifier: loupe diameter (px) and source pixels across it
                              // (~5.5px per pixel — pixels stay visible but you keep enough context to aim)

export default function Proposal({ mode, tpl, answers, customSpec, info, artworkPath, logo, savedState, onSave, aiResult, paymentLink, proposalNotes, sideViews = [], onSideViews }) {
  const pageRef = useRef(null)
  const wrapRef = useRef(null)
  const [scale, setScale] = useState(1)
  const [scaledH, setScaledH] = useState(1056)
  const [busy, setBusy] = useState('')
  const [toast, setToast] = useState('')
  const [pickingSV, setPickingSV] = useState(false)
  const [selId, setSelId] = useState(null)                          // selected adjustable image
  const [layout, setLayout] = useState(savedState?.__layout || {})  // persisted geometry per image
  const SW_W = 96, SW_H = 20   // default swatch size (now horizontally resizable)
  const [swatches, setSwatches] = useState(() => {
    if (savedState?.__swatches?.length) return savedState.__swatches.map((s) => ({ ...s, h: s.h > 22 ? SW_H : s.h }))
    if (mode === 'custom') return []
    // Two default chips, stacked + left-aligned, anchored later to the FACE / RETURN & TRIM colour
    // lines. Default first BLACK, second WHITE (the common pair); the rep adjusts via the picker.
    return [
      { id: 'face', name: 'BLACK', color: '#000000', x: 300, y: 690, w: SW_W, h: SW_H },
      { id: 'rettrim', name: 'WHITE', color: '#ffffff', x: 300, y: 712, w: SW_W, h: SW_H },
    ]
  })
  // Add a chip to the RIGHT of the existing ones, on the same row (auto-aligned).
  const addSwatch = () => {
    const id = 'sw' + Date.now()
    setSwatches((s) => {
      const row = s.find((x) => x.id === 'face') || s[0]
      const rightX = s.reduce((m, x) => Math.max(m, x.x + x.w), row ? row.x : 300)
      return [...s, { id, name: '', color: '', x: rightX + 16, y: row ? row.y : 470, w: SW_W, h: SW_H }]
    })
    setSelId('swatch-' + id)
  }
  // After a drag, snap a chip's row to a neighbour so rows stay aligned.
  const snapRow = (id) => setSwatches((arr) => {
    const me = arr.find((s) => s.id === id); if (!me) return arr
    const near = arr.find((s) => s.id !== id && Math.abs(s.y - me.y) <= 18)
    return near ? arr.map((s) => (s.id === id ? { ...s, y: near.y } : s)) : arr
  })
  const [pickFor, setPickFor] = useState(null)   // swatch id currently sampling a color from the artwork
  const [loupe, setLoupe] = useState(null)       // { left, top, hex } magnifier following the cursor
  const artCanvasRef = useRef(null)              // cached CORS-readable canvas of the artwork (natural size)
  const loupeRef = useRef(null)
  // Build (once) a readable canvas of the artwork; null if the image can't be read (no CORS).
  const getArtCanvas = () => {
    if (artCanvasRef.current) return artCanvasRef.current
    const el = pageRef.current?.querySelector('[data-rk="artwork"] img')
    if (!el || !el.naturalWidth) return null
    try {
      const cv = document.createElement('canvas'); cv.width = el.naturalWidth; cv.height = el.naturalHeight
      cv.getContext('2d').drawImage(el, 0, 0)
      cv.getContext('2d').getImageData(0, 0, 1, 1)    // throws if tainted
      artCanvasRef.current = cv; return cv
    } catch { return null }
  }
  const relPos = (e) => {
    const t = e.currentTarget
    return [t.offsetWidth ? Math.min(1, Math.max(0, e.nativeEvent.offsetX / t.offsetWidth)) : 0.5,
      t.offsetHeight ? Math.min(1, Math.max(0, e.nativeEvent.offsetY / t.offsetHeight)) : 0.5]
  }
  const hexAt = (cv, rx, ry) => {
    const px = Math.min(cv.width - 1, Math.max(0, Math.round(rx * cv.width)))
    const py = Math.min(cv.height - 1, Math.max(0, Math.round(ry * cv.height)))
    const d = cv.getContext('2d').getImageData(px, py, 1, 1).data
    return ['#' + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join(''), px, py]
  }
  // Magnifier loupe so the rep can see the exact pixel/color before clicking.
  const onPickMove = (e) => {
    const cv = getArtCanvas(); if (!cv) return
    const [rx, ry] = relPos(e)
    const [hex, px, py] = hexAt(cv, rx, ry)
    const lc = loupeRef.current
    if (lc) {
      const ctx = lc.getContext('2d'); ctx.imageSmoothingEnabled = false
      ctx.clearRect(0, 0, LOUPE, LOUPE)
      ctx.drawImage(cv, px - (SRC - 1) / 2, py - (SRC - 1) / 2, SRC, SRC, 0, 0, LOUPE, LOUPE)
      const cell = LOUPE / SRC, c0 = Math.floor(SRC / 2) * cell
      ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.strokeRect(c0, c0, cell, cell)
      ctx.lineWidth = 1; ctx.strokeStyle = '#fff'; ctx.strokeRect(c0, c0, cell, cell)
    }
    setLoupe({ left: e.clientX, top: e.clientY, hex })
  }
  const sampleArtwork = (e) => {
    const swId = pickFor
    const [rx, ry] = relPos(e)
    const apply = (hex) => {
      setSwatches((arr) => arr.map((x) => (x.id === swId ? { ...x, color: hex } : x)))
      setSelId('swatch-' + swId); flash('Color picked ' + hex.toUpperCase()); setLoupe(null); setPickFor(null)
    }
    const cv = getArtCanvas()
    if (cv) { apply(hexAt(cv, rx, ry)[0]); return }
    // fallback for an image we can't read directly: fetch a fresh CORS copy
    const img = new Image(); img.crossOrigin = 'anonymous'
    img.onload = () => { try { const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d').drawImage(img, 0, 0); apply(hexAt(c, rx, ry)[0]) } catch (err) { flash('Could not read this artwork: ' + (err.message || err)); setLoupe(null); setPickFor(null) } }
    img.onerror = () => { flash('Could not load the artwork for picking.'); setLoupe(null); setPickFor(null) }
    const src = fileUrl(artworkPath); img.src = src + (src.includes('?') ? '&' : '?') + '_cors=' + Date.now()
  }
  useEffect(() => {
    if (!pickFor) { setLoupe(null); return }
    const onKey = (e) => { if (e.key === 'Escape') setPickFor(null) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [pickFor])
  const scaleRef = useRef(scale)
  scaleRef.current = scale

  // click anywhere outside an adjustable image deselects it (hides the handles)
  useEffect(() => {
    const onDown = (e) => { if (!e.target.closest('[data-rk]')) setSelId(null) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  // fit the fixed 816px page into the available column width (keeps full-res for PDF)
  useEffect(() => {
    const fit = () => {
      if (!wrapRef.current || !pageRef.current) return
      const avail = wrapRef.current.clientWidth - 40 // wrapper padding
      const s = Math.min(1, avail / 816)
      setScale(s)
      setScaledH(pageRef.current.offsetHeight * s)
    }
    fit()
    const t = setTimeout(fit, 250) // refit after images/content settle
    window.addEventListener('resize', fit)
    return () => { clearTimeout(t); window.removeEventListener('resize', fit) }
  }, [])

  const price = Number((mode === 'custom' ? customSpec?.price : answers?.price) || 1200)
  const itemDesc = mode === 'custom'
    ? (customSpec?.itemDesc || 'CUSTOM SIGNAGE')
    : ((tpl?.desc || 'SIGN') + ' FOR ' + (info.company || ''))

  const specHTML = useMemo(() => {
    // Break any run-on text (semicolon- or newline-separated) into clean one-per-line bullets
    // so a dumped paragraph reads as a tidy spec list instead of a wall of text.
    const toLines = (text) => (text || '').split(/\r?\n|;\s*/).map((s) => s.trim()).filter(Boolean)
    const lines = mode === 'custom'
      ? toLines(customSpec?.specText)
      : buildSpecLines(tpl, answers, aiResult).flatMap((l) => toLines(l))
    // Bullet ONLY the face-colour and return/trim-colour lines (the two with swatches); the rest stay
    // plain. Strip any existing bullet/indent first so colour rows don't end up double-bulleted.
    return lines.map((l) => {
      const clean = l.replace(/^[••\-\s]+/, '').trim()
      // A swatch line is the FACE colour line, or a RETURN/TRIM colour line in any wording
      // ("RETURN COLOR", "RETURN & TRIM COLOR", "TRIM & RETURNS COLOR"). NOT "BACKER COLOR".
      const hasColor = /COLOR/i.test(clean)
      const isColor = hasColor && (/FACE/i.test(clean) || /RETURN/i.test(clean) || /TRIM/i.test(clean))
      // On those lines drop the colour word after the colon — the swatch shows the colour.
      if (isColor) return '• ' + esc(clean.replace(/:\s*.*$/, ':'))
      return esc(clean)
    }).join('<br>')
  }, [mode, tpl, answers, customSpec, aiResult])

  const today = new Date()
  const dateStr = `${String(today.getMonth() + 1).padStart(2, '0')}/${String(today.getDate()).padStart(2, '0')}/${today.getFullYear()}`

  // default content per editable block; any saved proposal_state overrides it.
  const initial = useMemo(() => {
    const def = {
      contact: '101 E LUZERNE ST. PHILADELPHIA, PENNSYLVANIA 19124, US<br>www.epiccraftings.com<br>sales@epiccraftings.com<br>+1 (445) 444-0334',
      infoLeft: `<b>COMPANY NAME:</b> ${esc(info.company)}<br><b>CLIENT NAME:</b> ${esc(info.client)}<br><b>CONTACT:</b> ${esc(info.contact)}<br><b>ADDRESS:</b> ${esc(info.address)}`,
      infoRight: `<b>PROPOSAL ID:</b> ${esc(info.quoteId)}<br><b>DATE:</b> ${dateStr}<br><b>JOB NAME:</b> ${esc(info.job)}`,
      itemDesc: esc(itemDesc),
      unitPrice: money(price),
      totalPrice: money(price),
      specBody: specHTML,
      notes: proposalNotes ? esc(proposalNotes).replace(/\n/g, '<br>') : (tpl?.notes ? esc(tpl.notes) : '&nbsp;'),
      subtotal: money(price),
      dep1: money(price / 2),
      dep2: money(price / 2),
      terms: TERMS_HTML,
      pay: 'CLICK HERE TO MAKE PAYMENT',
    }
    const merged = { ...def, ...(savedState || {}) }
    // Older saved proposals captured the previous $0 default for the money fields — fall back to
    // the current default ($1,200 / $600) so they show a price instead of a stale zero.
    const zero = money(0)
    ;['unitPrice', 'totalPrice', 'subtotal', 'dep1', 'dep2'].forEach((k) => {
      const sv = savedState?.[k]
      if (sv === undefined || sv === '' || sv === zero) merged[k] = def[k]
    })
    return merged
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // editable block — content set once via dangerouslySetInnerHTML so React never clobbers edits
  const E = (key, style) => (
    <div data-key={key} contentEditable suppressContentEditableWarning
      style={{ outline: 'none', ...style }}
      dangerouslySetInnerHTML={{ __html: initial[key] }} />
  )

  // common props for a Canva-style adjustable image
  const adjProps = (rk, def) => ({
    rk, def, lay: layout[rk],
    onLay: (b) => setLayout((L) => ({ ...L, [rk]: b })),
    scaleRef, selected: selId === rk, onSelect: () => setSelId(rk),
  })

  const captureState = () => {
    const state = { __layout: layout, __swatches: swatches.filter((s) => s.color || s.name) }
    pageRef.current?.querySelectorAll('[data-key]').forEach((el) => { state[el.dataset.key] = el.innerHTML })
    return state
  }

  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 2500) }

  // ---- Auto-save: persist edits + geometry automatically (debounced) so nothing is lost and the
  // layout/crop stays locked when you leave the proposal and come back. ----
  const saveTimer = useRef(null)
  const mounted = useRef(false)
  const queueSave = () => {
    if (!onSave) return
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null
      try { onSave(captureState()); flash('Saved') } catch { /* ignore */ }
    }, 700)
  }
  useEffect(() => { if (!mounted.current) { mounted.current = true; return } queueSave() }, [layout, swatches]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = pageRef.current; if (!el) return
    const h = () => queueSave()
    el.addEventListener('input', h)
    return () => el.removeEventListener('input', h)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // Flush a pending save on unmount so a quick Back right after an edit still persists.
  useEffect(() => () => { if (saveTimer.current) { clearTimeout(saveTimer.current); try { onSave?.(captureState()) } catch { /* ignore */ } } }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Data-driven colour chips: scan the real FACE / RETURN / TRIM colour lines and glue one chip
  // snug to the right of each, vertically centred. Handles every catalog wording, incl. a combined
  // "FACE & RETURN COLOR" line (then just one chip — the second is hidden). Re-runs on spec/scale
  // change so it never drifts; these chips are locked from dragging (extra chips stay free). ----
  const [hideRet, setHideRet] = useState(false)
  useEffect(() => {
    const page = pageRef.current; if (!page) return
    const spec = page.querySelector('[data-key="specBody"]'); if (!spec) return
    const sc = scaleRef.current || 1
    const pageRect = page.getBoundingClientRect()
    const lines = []
    const walker = document.createTreeWalker(spec, NodeFilter.SHOW_TEXT)
    let n
    while ((n = walker.nextNode())) {
      const txt = n.textContent || ''
      if (!/COLOR/i.test(txt)) continue
      const hasFace = /FACE/i.test(txt), hasRet = /RETURN|TRIM/i.test(txt)
      if (!hasFace && !hasRet) continue            // skip BACKER / RACEWAY / "COLOR SPECS"
      const idx = txt.search(/COLOR/i)
      const range = document.createRange()
      range.setStart(n, 0); range.setEnd(n, Math.min(txt.length, idx + 5))   // measure up to "…COLOR"
      const r = range.getBoundingClientRect()
      lines.push({ hasFace, hasRet, x: Math.round((r.right - pageRect.left) / sc + 8), y: Math.round((r.top - pageRect.top) / sc + (r.height / sc - SW_H) / 2) })
    }
    const faceLine = lines.find((l) => l.hasFace) || lines[0]
    const retLine = lines.find((l) => l !== faceLine && l.hasRet)
    setHideRet(!retLine)
    if (!faceLine) return
    const target = { face: { x: faceLine.x, y: faceLine.y } }
    if (retLine) target.rettrim = { x: retLine.x, y: retLine.y }
    setSwatches((arr) => {
      let changed = false
      const next = arr.map((s) => {
        const t = target[s.id]
        if (t && (s.x !== t.x || s.y !== t.y)) { changed = true; return { ...s, x: t.x, y: t.y } }
        return s
      })
      return changed ? next : arr
    })
  }, [specHTML, scale]) // eslint-disable-line react-hooks/exhaustive-deps

  const render = async () => {
    // capture at the page's true 816px size (drop the fit-to-fit scale during render)
    const el = pageRef.current
    const prev = el.style.transform
    el.style.transform = 'none'
    const handles = [...el.querySelectorAll('.adj-ui')]
    handles.forEach((h) => { h.style.visibility = 'hidden' })   // don't print selection chrome
    try {
      return await html2canvas(el, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false })
    } finally {
      el.style.transform = prev
      handles.forEach((h) => { h.style.visibility = '' })
    }
  }

  const downloadPNG = async () => {
    setBusy('png')
    try {
      const c = await render()
      const a = document.createElement('a')
      a.download = `${info.quoteId || 'quote'}.png`
      a.href = c.toDataURL('image/png'); a.click()
      flash('PNG downloaded')
    } catch (e) { flash('PNG failed: ' + e.message) } finally { setBusy('') }
  }

  const downloadPDF = () => {
    // Real vector PDF via the browser's print pipeline: sharp, selectable text and a clickable
    // payment link. (An image-based PDF pixelates the text and the link isn't clickable.)
    flash("Opening your browser's Save-as-PDF…")
    setTimeout(() => window.print(), 150)
  }

  return (
    <div>
      <div className="edit-hint" style={{ marginBottom: 10, fontSize: 13, color: 'var(--muted, #8a94a6)' }}>
        ✏️ Click any text to edit it. Edits and layout save automatically. Click an image for resize corners + crop edges.
      </div>
      {pickFor && (
        <div style={{ position: 'fixed', top: 12, left: '50%', transform: 'translateX(-50%)', background: '#8b5cf6', color: '#fff', padding: '8px 16px', borderRadius: 6, zIndex: 200, fontSize: 13, fontWeight: 600, boxShadow: '0 4px 14px rgba(0,0,0,0.25)' }}>
          🎨 Click the highlighted artwork to grab its color · press Esc to cancel
        </div>
      )}
      {pickFor && (
        <div style={{ position: 'fixed', left: loupe ? loupe.left - LOUPE / 2 : -9999, top: loupe ? loupe.top - LOUPE / 2 : -9999, zIndex: 210, pointerEvents: 'none', display: loupe ? 'block' : 'none' }}>
          <canvas ref={loupeRef} width={LOUPE} height={LOUPE}
            style={{ width: LOUPE, height: LOUPE, borderRadius: '50%', border: '3px solid #fff', boxShadow: '0 3px 14px rgba(0,0,0,0.5)', display: 'block', background: '#fff' }} />
          <div style={{ textAlign: 'center', marginTop: 5 }}>
            <span style={{ background: '#222', color: '#fff', fontSize: 12, fontWeight: 700, borderRadius: 4, padding: '2px 8px', fontFamily: 'monospace' }}>{loupe ? loupe.hex.toUpperCase() : ''}</span>
          </div>
        </div>
      )}

      <div ref={wrapRef} className="proposal-wrap" style={{ overflow: 'hidden', background: '#5a6270', padding: 20, borderRadius: 10 }}>
        <div className="proposal-fit" style={{ width: 816 * scale, height: scaledH, margin: '0 auto' }}>
        <div
          ref={pageRef}
          id="proposal-print-root"
          style={{
            width: 816, minHeight: 560, background: '#fff', color: '#111',
            fontFamily: "'Roboto', Arial, sans-serif", fontSize: 12, textTransform: 'uppercase',
            boxSizing: 'border-box', paddingBottom: 14, position: 'relative',
            transformOrigin: 'top left', transform: `scale(${scale})`,
          }}
        >
          {/* header */}
          <div style={{ height: 110, position: 'relative', padding: '0 40px', display: 'flex', alignItems: 'center' }}>
            <img src="/quote-logo.png" alt="Epic Craftings" crossOrigin="anonymous"
              style={{ height: 60, objectFit: 'contain', display: 'block' }} />
            {E('contact', { position: 'absolute', right: 40, top: 20, fontSize: 9, textAlign: 'right', lineHeight: 1.85 })}
          </div>

          <div style={{ padding: '8px 40px 0' }}>
            <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: 1, color: '#1a2433' }}>PROPOSAL</div>
          </div>

          {/* info grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', padding: '6px 40px 0', gap: 4 }}>
            {E('infoLeft', { fontSize: 11, lineHeight: 1.9 })}
            {E('infoRight', { fontSize: 11, lineHeight: 1.9 })}
          </div>

          {/* item details */}
          <div style={{ margin: '10px 40px 0', ...headCell, borderTop: '1px solid #777' }}>ITEM DETAILS</div>
          <div style={{ margin: '0 40px', border: '1px solid #777', borderTop: 'none', height: 192, position: 'relative' }}>
            {artworkPath
              ? <AdjImg {...adjProps('artwork', { x: 188, y: 24, w: 360, h: 144 })} src={fileUrl(artworkPath)} alt="artwork" lockAspect cors={/res\.cloudinary\.com/i.test(fileUrl(artworkPath) || '')} />
              : <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#bbb', fontStyle: 'italic', fontSize: 12, textTransform: 'none' }}>[ Customer artwork — add it in the Artwork step ]</span>}
            {pickFor && artworkPath && (() => { const a = layout.artwork || { x: 188, y: 24, w: 360, h: 144, rot: 0 }; return (
              <div onClick={sampleArtwork} onMouseMove={onPickMove} onMouseLeave={() => setLoupe(null)} title="Click to grab this color"
                style={{ position: 'absolute', left: a.x, top: a.y, width: a.w, height: a.h, transform: `rotate(${a.rot || 0}deg)`, cursor: 'crosshair', zIndex: 80, outline: '2px dashed #8b5cf6', outlineOffset: -1 }} />
            ) })()}
          </div>

          {/* item table — its own bordered block with a gap above (matches the template) */}
          <div style={{ margin: '7px 40px 0', display: 'grid', gridTemplateColumns: '1fr 56px 104px 104px' }}>
            <div style={{ ...headCell, borderTop: '1px solid #777' }}>ITEM DESCRIPTION</div>
            <div style={{ ...headCell, borderTop: '1px solid #777', borderLeft: 'none', textAlign: 'center' }}>QTY</div>
            <div style={{ ...headCell, borderTop: '1px solid #777', borderLeft: 'none', textAlign: 'center' }}>UNIT PRICE</div>
            <div style={{ ...headCell, borderTop: '1px solid #777', borderLeft: 'none', textAlign: 'center' }}>TOTAL PRICE</div>
            {E('itemDesc', { ...cell, borderTop: 'none' })}
            <div style={{ ...cell, borderTop: 'none', borderLeft: 'none', textAlign: 'center' }}>1</div>
            {E('unitPrice', { ...cell, borderTop: 'none', borderLeft: 'none', textAlign: 'center' })}
            {E('totalPrice', { ...cell, borderTop: 'none', borderLeft: 'none', textAlign: 'center' })}
          </div>

          {/* specs (left) + package & side view (right): ONE outer frame; the divider is the left
              column's right border, so it's continuous no matter which column ends up taller */}
          <div style={{ margin: '7px 40px 0', display: 'grid', gridTemplateColumns: '1fr 264px', border: '1px solid #777' }}>
            <div style={{ borderRight: '1px solid #777' }}>
              <div style={secHead}>SPECIFICATIONS</div>
              {E('specBody', { fontSize: 10.5, lineHeight: 1.9, padding: '10px 12px', minHeight: 215, whiteSpace: 'pre-wrap', outline: 'none', borderBottom: '1px solid #777' })}
              <div style={secHead}>ADDITIONAL NOTES</div>
              {E('notes', { fontSize: 10.5, padding: '8px 12px', minHeight: 40, outline: 'none' })}
            </div>
            <div>
              <div style={secHead}>PACKAGE INCLUDES</div>
              <div style={{ position: 'relative', height: 150, borderBottom: '1px solid #777' }}>
                {PACKAGE.map((p, i) => (
                  <AdjImg key={p.label} {...adjProps(`pkg-${p.label}`, { x: 6 + i * 130, y: 8, w: 122, h: 134 })} src={p.img} alt={p.label} />
                ))}
              </div>
              <div style={secHead}>SIDE VIEW</div>
              <div style={{ position: 'relative', height: 208 }}>
                {sideViews.length === 0
                  ? <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#bbb', fontStyle: 'italic', fontSize: 10, textTransform: 'none' }}>[ No side view selected ]</span>
                  : sideViews.map((k, i) => (
                      <AdjImg key={k} {...adjProps(`sv-${k}`, { x: 16 + i * 14, y: 10 + i * 14, w: 230, h: 188 })} src={`/side_views/${k}.png`} alt={k} />
                    ))}
              </div>
            </div>
          </div>

          {/* totals + terms */}
          <div style={{ margin: '12px 40px 0', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 20px' }}>
            {E('terms', { fontSize: 8.5, lineHeight: 1.6, textTransform: 'none' })}
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, fontWeight: 800, marginBottom: 6 }}>
                <span>SUBTOTAL</span>{E('subtotal')}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 6 }}>
                <span>50% DEPOSIT DUE NOW</span>{E('dep1')}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
                <span>50% DUE ON SHIPMENT</span>{E('dep2')}
              </div>
              {paymentLink
                ? <a href={paymentLink} target="_blank" rel="noreferrer" style={{ display: 'block', marginTop: 14, background: '#f5a623', padding: 14, textAlign: 'center', fontSize: 15, fontWeight: 800, letterSpacing: 0.5, color: '#111', textDecoration: 'none' }}>CLICK HERE TO MAKE PAYMENT</a>
                : E('pay', { marginTop: 14, background: '#f5a623', padding: 14, textAlign: 'center', fontSize: 15, fontWeight: 800, letterSpacing: 0.5 })}
            </div>
          </div>

          {/* draggable color swatches — the filled block prints; the picker chrome (.adj-ui) does not */}
          {swatches.map((sw) => ((sw.id === 'rettrim' && hideRet) ? null : (sw.id === 'face' || sw.id === 'rettrim' || sw.color || sw.name || selId === 'swatch-' + sw.id) ? (
            <AdjSwatch key={sw.id} rk={'swatch-' + sw.id} sw={sw} scaleRef={scaleRef}
              locked={sw.id === 'face' || sw.id === 'rettrim'}
              selected={selId === 'swatch-' + sw.id} onSelect={() => setSelId('swatch-' + sw.id)}
              onChange={(n) => setSwatches((arr) => arr.map((x) => (x.id === sw.id ? n : x)))}
              onRemove={() => { setSwatches((arr) => arr.filter((x) => x.id !== sw.id)); setSelId(null) }}
              onDragEnd={() => snapRow(sw.id)}
              onPick={() => { artCanvasRef.current = null; setPickFor(sw.id) }} canPick={!!artworkPath} />
          ) : null))}
        </div>
        </div>
      </div>

      {/* side-view picker — a control, not part of the printed page */}
      {onSideViews && (
        <div style={{ margin: '12px 0' }}>
          <button type="button" className="ghost" onClick={() => setPickingSV((v) => !v)}>
            {pickingSV ? 'Done choosing side views' : '+ Choose side views'}
          </button>
          {pickingSV && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 10 }}>
              {SIDE_VIEWS.map((s) => {
                const on = sideViews.includes(s.key)
                return (
                  <label key={s.key} style={{ width: 120, fontSize: 10, textAlign: 'center', cursor: 'pointer', border: on ? '2px solid #f5a623' : '1px solid #ccc', borderRadius: 6, padding: 4 }}>
                    <input type="checkbox" checked={on} onChange={(e) => onSideViews(e.target.checked ? [...sideViews, s.key] : sideViews.filter((x) => x !== s.key))} />
                    <img src={`/side_views/${s.key}.png`} alt={s.label} style={{ width: '100%', height: 70, objectFit: 'contain' }} />
                    <div>{s.label}</div>
                  </label>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* color swatches — a control, not part of the printed page */}
      <div style={{ margin: '12px 0' }}>
        <button type="button" className="ghost" onClick={addSwatch}>+ Add color swatch</button>
        <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>Click a swatch to pick its color &amp; name; drag to place. The picker never appears in the PDF.</span>
      </div>

      {/* actions */}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap', marginTop: 14 }}>
        <button className="ghost" disabled={busy} onClick={downloadPNG}>{busy === 'png' ? 'Rendering…' : '⬇ PNG image'}</button>
        <button disabled={busy} onClick={downloadPDF}>🖨️ Save as PDF</button>
        {toast && <span style={{ alignSelf: 'center', color: '#2e7d32', fontWeight: 600 }}>{toast}</span>}
      </div>
    </div>
  )
}
