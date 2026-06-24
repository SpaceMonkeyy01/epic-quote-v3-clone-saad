import { useEffect, useMemo, useRef, useState } from 'react'
import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'
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

// Canva-style adjustable image: click to select (purple box + 4 corner handles + rotate grip),
// drag the body to move, a corner to resize, the top grip to rotate. Absolute-positioned, so
// resizing one element never reflows the page. Geometry is reported up via onLay (persisted in
// proposal_state.__layout); selection chrome carries className "adj-ui" so PDF capture hides it.
function AdjImg({ rk, def, lay, onLay, src, alt, caption, lockAspect, scaleRef, selected, onSelect }) {
  const init = lay || def
  const [box, setBox] = useState({ x: init.x, y: init.y, w: init.w, h: init.h, rot: init.rot || 0 })
  const rootRef = useRef(null)
  const start = (kind, corner) => (e) => {
    e.preventDefault(); e.stopPropagation(); onSelect()
    const sx = e.clientX, sy = e.clientY, b0 = { ...box }, sc = scaleRef.current || 1
    let cx = 0, cy = 0
    if (kind === 'rot' && rootRef.current) { const r = rootRef.current.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2 }
    const move = (ev) => {
      const dx = (ev.clientX - sx) / sc, dy = (ev.clientY - sy) / sc
      if (kind === 'move') setBox({ ...b0, x: Math.round(b0.x + dx), y: Math.round(b0.y + dy) })
      else if (kind === 'rot') setBox({ ...b0, rot: Math.round(Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180 / Math.PI + 90) })
      else {
        const L = corner.includes('l'), T = corner.includes('t'), R = corner.includes('r'), B = corner.includes('b')
        let w = b0.w, h = b0.h
        if (R) w = b0.w + dx; if (L) w = b0.w - dx; if (B) h = b0.h + dy; if (T) h = b0.h - dy
        w = Math.max(30, Math.round(w)); h = Math.max(20, Math.round(h))
        if (lockAspect && b0.w) h = Math.max(20, Math.round(w * b0.h / b0.w))  // keep the logo's proportions
        let x = b0.x, y = b0.y
        if (L) x = Math.round(b0.x + (b0.w - w)); if (T) y = Math.round(b0.y + (b0.h - h))
        setBox({ ...b0, w, h, x, y })
      }
    }
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); setBox((b) => { onLay(b); return b }) }
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up)
  }
  const hdl = { position: 'absolute', width: 11, height: 11, background: '#fff', border: '1.5px solid #8b5cf6', borderRadius: '50%', zIndex: 60 }
  const corners = { tl: { left: -6, top: -6, cursor: 'nwse-resize' }, tr: { right: -6, top: -6, cursor: 'nesw-resize' }, bl: { left: -6, bottom: -6, cursor: 'nesw-resize' }, br: { right: -6, bottom: -6, cursor: 'nwse-resize' } }
  return (
    <div ref={rootRef} data-rk={rk} onMouseDown={start('move')}
      style={{ position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h, transform: `rotate(${box.rot}deg)`, cursor: 'move' }}>
      <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', pointerEvents: 'none' }}>
        <img src={src} alt={alt} draggable={false}
          onLoad={lockAspect ? (e) => { const r = e.target.naturalWidth / e.target.naturalHeight; if (r > 0) setBox((b) => ({ ...b, h: Math.max(20, Math.round(b.w / r)) })) } : undefined}
          style={{ flex: 1, minHeight: 0, width: '100%', objectFit: 'contain', display: 'block' }} />
        {caption && <div style={{ fontSize: 8, textAlign: 'center', marginTop: 2, lineHeight: 1.2 }}>{caption}</div>}
      </div>
      {selected && (
        <>
          <div className="adj-ui" style={{ position: 'absolute', inset: 0, border: '1.5px solid #8b5cf6', pointerEvents: 'none' }} />
          {Object.entries(corners).map(([c, pos]) => (
            <span key={c} className="adj-ui" onMouseDown={start('resize', c)} style={{ ...hdl, ...pos }} />
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
function AdjSwatch({ rk, sw, onChange, onRemove, scaleRef, selected, onSelect }) {
  const startDrag = (e) => {
    if (e.target.closest('.adj-ui')) return            // don't drag while using the picker
    e.preventDefault(); e.stopPropagation(); onSelect()
    const sx = e.clientX, sy = e.clientY, x0 = sw.x, y0 = sw.y, sc = scaleRef.current || 1
    const move = (ev) => onChange({ ...sw, x: Math.round(x0 + (ev.clientX - sx) / sc), y: Math.round(y0 + (ev.clientY - sy) / sc) })
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up) }
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up)
  }
  const has = !!sw.color
  const bg = has ? sw.color : '#e5e5e5'
  return (
    <div data-rk={rk} onMouseDown={startDrag}
      style={{ position: 'absolute', left: sw.x, top: sw.y, width: sw.w, height: sw.h, cursor: 'move' }}>
      <div style={{ width: '100%', height: '100%', background: bg, color: swatchText(bg), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, border: '1px solid rgba(0,0,0,0.3)', overflow: 'hidden', padding: '0 4px', boxSizing: 'border-box' }}>
        {sw.name || (has ? '' : 'TBD')}
      </div>
      {selected && (
        <>
          <div className="adj-ui" style={{ position: 'absolute', inset: -2, border: '1.5px solid #8b5cf6', pointerEvents: 'none' }} />
          <div className="adj-ui" onMouseDown={(e) => e.stopPropagation()}
            style={{ position: 'absolute', top: '100%', left: 0, marginTop: 6, zIndex: 70, background: '#fff', border: '1px solid #8b5cf6', borderRadius: 6, padding: 8, display: 'flex', gap: 6, alignItems: 'center', boxShadow: '0 4px 12px rgba(0,0,0,0.18)', textTransform: 'none', width: 210 }}>
            <input type="color" value={has ? sw.color : '#000000'} onChange={(e) => onChange({ ...sw, color: e.target.value })}
              title="Pick color" style={{ width: 34, height: 30, padding: 0, border: 'none', background: 'none', cursor: 'pointer' }} />
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

export default function Proposal({ mode, tpl, answers, customSpec, info, artworkPath, logo, savedState, onSave, aiResult, paymentLink, sideViews = [], onSideViews }) {
  const pageRef = useRef(null)
  const wrapRef = useRef(null)
  const [scale, setScale] = useState(1)
  const [scaledH, setScaledH] = useState(1056)
  const [busy, setBusy] = useState('')
  const [toast, setToast] = useState('')
  const [pickingSV, setPickingSV] = useState(false)
  const [selId, setSelId] = useState(null)                          // selected adjustable image
  const [layout, setLayout] = useState(savedState?.__layout || {})  // persisted geometry per image
  const SW_W = 64, SW_H = 20   // compact swatch size, matching the Canva template baseline
  const [swatches, setSwatches] = useState(() => {
    // shrink any swatches saved at the old oversized default (no resize handle yet)
    if (savedState?.__swatches?.length) return savedState.__swatches.map((s) => ({ ...s, w: s.w > 90 ? SW_W : s.w, h: s.h > 22 ? SW_H : s.h }))
    if (mode === 'custom' || !tpl?.colors?.length) return []
    // seed one swatch per color row (FACE / RETURN / TRIM / BACKER…), including fixed "TBD" rows.
    // Label = the color value (BLACK/WHITE) like the template; the field name stays in the spec text.
    return tpl.colors.map((c, idx) => {
      const ans = answers?.['color_' + idx]
      const color = ans === 'BLACK' ? '#000000' : ans === 'WHITE' ? '#ffffff' : ''
      return { id: 'seed' + idx, name: ans || '', color, x: 300, y: 560 + idx * 24, w: SW_W, h: SW_H }
    })
  })
  const addSwatch = () => {
    const id = 'sw' + Date.now()
    setSwatches((s) => [...s, { id, name: '', color: '', x: 300, y: 560, w: SW_W, h: SW_H }])
    setSelId('swatch-' + id)
  }
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
    if (mode === 'custom') return esc(customSpec?.specText || '').replace(/\n/g, '<br>')
    return buildSpecLines(tpl, answers, aiResult).map(esc).join('<br>')
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
      notes: tpl?.notes ? esc(tpl.notes) : '&nbsp;',
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
    const state = { __layout: layout, __swatches: swatches }
    pageRef.current?.querySelectorAll('[data-key]').forEach((el) => { state[el.dataset.key] = el.innerHTML })
    return state
  }

  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 2500) }

  const doSave = async () => {
    setBusy('save')
    try { await onSave(captureState()); flash('Saved') }
    catch { flash('Save failed') }
    finally { setBusy('') }
  }

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

  const downloadPDF = async () => {
    setBusy('pdf')
    try {
      const c = await render()
      const w = 816, h = (c.height * w) / c.width
      const doc = new jsPDF({ orientation: h > w ? 'portrait' : 'landscape', unit: 'px', format: [w, h] })
      doc.addImage(c.toDataURL('image/png'), 'PNG', 0, 0, w, h)
      doc.save(`${info.quoteId || 'quote'}.pdf`)
      flash('PDF downloaded')
    } catch (e) { flash('PDF failed: ' + e.message) } finally { setBusy('') }
  }

  return (
    <div>
      <div className="edit-hint" style={{ marginBottom: 10, fontSize: 13, color: 'var(--muted, #8a94a6)' }}>
        ✏️ Click any text on the proposal to edit it. Save keeps your edits; PDF embeds none of the handles.
      </div>

      <div ref={wrapRef} style={{ overflow: 'hidden', background: '#5a6270', padding: 20, borderRadius: 10 }}>
        <div style={{ width: 816 * scale, height: scaledH, margin: '0 auto' }}>
        <div
          ref={pageRef}
          style={{
            width: 816, minHeight: 1056, background: '#fff', color: '#111',
            fontFamily: "'Roboto', Arial, sans-serif", fontSize: 12, textTransform: 'uppercase',
            boxSizing: 'border-box', paddingBottom: 36, position: 'relative',
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
              ? <AdjImg {...adjProps('artwork', { x: 188, y: 24, w: 360, h: 144 })} src={fileUrl(artworkPath)} alt="artwork" lockAspect />
              : <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#bbb', fontStyle: 'italic', fontSize: 12, textTransform: 'none' }}>[ Customer artwork — add it in the Artwork step ]</span>}
          </div>

          {/* item table — its own bordered block with a gap above (matches the template) */}
          <div style={{ margin: '7px 40px 0', display: 'grid', gridTemplateColumns: '1fr 56px 104px 104px' }}>
            <div style={{ ...headCell, borderTop: '1px solid #777' }}>ITEM DESCRIPTION</div>
            <div style={{ ...headCell, borderTop: '1px solid #777', borderLeft: 'none', textAlign: 'center' }}>QTY</div>
            <div style={{ ...headCell, borderTop: '1px solid #777', borderLeft: 'none' }}>UNIT PRICE</div>
            <div style={{ ...headCell, borderTop: '1px solid #777', borderLeft: 'none' }}>TOTAL PRICE</div>
            {E('itemDesc', { ...cell, borderTop: 'none' })}
            <div style={{ ...cell, borderTop: 'none', borderLeft: 'none', textAlign: 'center' }}>1</div>
            {E('unitPrice', { ...cell, borderTop: 'none', borderLeft: 'none' })}
            {E('totalPrice', { ...cell, borderTop: 'none', borderLeft: 'none' })}
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
              <div style={{ position: 'relative', height: 104, borderBottom: '1px solid #777' }}>
                {PACKAGE.map((p, i) => (
                  <AdjImg key={p.label} {...adjProps(`pkg-${p.label}`, { x: 18 + i * 122, y: 8, w: 92, h: 86 })} src={p.img} alt={p.label} caption={p.label} />
                ))}
              </div>
              <div style={secHead}>SIDE VIEW</div>
              <div style={{ position: 'relative', height: 208 }}>
                {sideViews.length === 0
                  ? <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#bbb', fontStyle: 'italic', fontSize: 10, textTransform: 'none' }}>[ No side view selected ]</span>
                  : sideViews.map((k, i) => (
                      <AdjImg key={k} {...adjProps(`sv-${k}`, { x: 46 + i * 12, y: 12 + i * 12, w: 160, h: 184 })} src={`/side_views/${k}.png`} alt={k} />
                    ))}
              </div>
            </div>
          </div>

          {/* totals + terms */}
          <div style={{ margin: '12px 40px 0', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 20px' }}>
            {E('terms', { fontSize: 8.5, lineHeight: 1.6, textTransform: 'none' })}
            <div>
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
          {swatches.map((sw) => (
            <AdjSwatch key={sw.id} rk={'swatch-' + sw.id} sw={sw} scaleRef={scaleRef}
              selected={selId === 'swatch-' + sw.id} onSelect={() => setSelId('swatch-' + sw.id)}
              onChange={(n) => setSwatches((arr) => arr.map((x) => (x.id === sw.id ? n : x)))}
              onRemove={() => { setSwatches((arr) => arr.filter((x) => x.id !== sw.id)); setSelId(null) }} />
          ))}
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
        <button className="ghost" disabled={busy} onClick={doSave}>{busy === 'save' ? 'Saving…' : '💾 Save edits'}</button>
        <button disabled={busy} onClick={downloadPNG}>{busy === 'png' ? 'Rendering…' : '⬇ PNG'}</button>
        <button disabled={busy} onClick={downloadPDF}>{busy === 'pdf' ? 'Rendering…' : '⬇ Download PDF'}</button>
        {toast && <span style={{ alignSelf: 'center', color: '#2e7d32', fontWeight: 600 }}>{toast}</span>}
      </div>
    </div>
  )
}
