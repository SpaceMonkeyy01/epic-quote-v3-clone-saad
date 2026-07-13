import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'
import { buildSpecLines, money, esc } from '../generator/proposal'
import { parseDims } from '../generator/questions'
import { SIDE_VIEWS } from '../generator/sideviews'
import { sanitizeHtml } from '../utils/sanitizeHtml'
import client, { fileUrl } from '../api/client'
import { attachCheckpointImage } from '../api/quotes'
import { uploadExtraFile } from '../api/quotes'
import { listCatalog, saveCatalogItem } from '../api/catalog'

// A side-view entry is either a catalog key (renders from /side_views/) or an uploaded
// file path / CDN URL (renders through fileUrl). Same list, both kinds.
const svSrc = (k) => (/^(https?:|\/storage)/i.test(String(k)) ? fileUrl(k) : `/side_views/${k}.png`)

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
function AdjImg({ rk, def, lay, onLay, src, alt, lockAspect, cors, scaleRef, selected, onSelect, liveLay, fitCenterH, autoCrop, bounds }) {
  // bounds {w,h}: the image must stay INSIDE its section box, whole — an oversize frame is
  // shrunk to fit (aspect kept, crop window scaled along), and the position is clamped so no
  // gesture, saved layout, or auto-fit can ever push it out of view / over other sections.
  const fitBounds = (b) => {
    if (!bounds) return b
    let { x, y, w, h, ix, iy, iw, ih } = b
    if (w > bounds.w || h > bounds.h) {
      const s = Math.min(bounds.w / w, bounds.h / h)
      w = Math.max(24, Math.round(w * s)); h = Math.max(24, Math.round(h * s))
      ix = Math.round(ix * s); iy = Math.round(iy * s); iw = Math.round(iw * s); ih = Math.round(ih * s)
    }
    x = Math.min(Math.max(0, x), Math.max(0, bounds.w - w))
    y = Math.min(Math.max(0, y), Math.max(0, bounds.h - h))
    return { ...b, x, y, w, h, ix, iy, iw, ih }
  }
  const init = lay || def
  const [box, setBox] = useState(() => fitBounds({
    x: init.x, y: init.y, w: init.w, h: init.h, rot: init.rot || 0,
    ix: init.ix ?? 0, iy: init.iy ?? 0, iw: init.iw ?? init.w, ih: init.ih ?? init.h,
  }))
  const rootRef = useRef(null)
  // Follow EXTERNAL geometry updates (e.g. auto-crop to the sign's bounding box writes a new
  // frame + crop window into layout) — local state used to be initialized once and never re-read.
  // Skipped while THIS image is being dragged so the user's own gesture is never fought.
  const draggingRef = useRef(false)
  useEffect(() => {
    if (draggingRef.current || !lay) return
    setBox((b) => {
      const n = fitBounds({ x: lay.x, y: lay.y, w: lay.w, h: lay.h, rot: lay.rot || 0,
                  ix: lay.ix ?? 0, iy: lay.iy ?? 0, iw: lay.iw ?? lay.w, ih: lay.ih ?? lay.h })
      return Object.keys(n).some((k) => n[k] !== b[k]) ? n : b
    })
  }, [lay]) // eslint-disable-line react-hooks/exhaustive-deps
  // liveLay: report geometry DURING the drag, not only at mouse-up — used by the artwork so
  // dimension arrows re-hug it in real time while it is moved/resized/cropped (#1). Called straight
  // from the mousemove handler (events always run outside React's render phase — an rAF-deferred
  // version fired mid-concurrent-render and triggered setState-in-render warnings), lightly
  // time-throttled so a fast drag doesn't flood re-renders.
  const liveLast = useRef(0)
  const reportLive = (b) => {
    if (!liveLay) return
    const now = performance.now()
    if (now - liveLast.current < 40) return   // ~25fps is plenty for arrow tracking
    liveLast.current = now
    onLay(b)
  }
  // A broken / degenerate source (e.g. a 1×1 placeholder thumbnail) must NOT be stretched by a
  // saved crop window — that paints the whole box with the single pixel's colour (the "red box"
  // bug). Detect it and hide the image so the empty area shows through instead.
  const [broken, setBroken] = useState(false)
  const start = (kind, handle) => (e) => {
    e.preventDefault(); e.stopPropagation(); onSelect()
    draggingRef.current = true
    const sx = e.clientX, sy = e.clientY, b0 = { ...box }, sc = scaleRef.current || 1
    let cx = 0, cy = 0
    let last = b0   // latest geometry — committed via onLay at mouse-up. NEVER call onLay inside a
                    // setBox updater: updaters run during React's render phase, and a parent
                    // setState from there is the "setState while rendering" violation.
    if (kind === 'rot' && rootRef.current) { const r = rootRef.current.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2 }
    const move = (ev) => {
      const dx = (ev.clientX - sx) / sc, dy = (ev.clientY - sy) / sc
      if (kind === 'move') { const nb = fitBounds({ ...b0, x: Math.round(b0.x + dx), y: Math.round(b0.y + dy) }); last = nb; setBox(nb); reportLive(nb); return }
      if (kind === 'rot') { const nb = { ...b0, rot: Math.round(Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180 / Math.PI + 90) }; last = nb; setBox(nb); reportLive(nb); return }
      if (kind === 'resize') {
        const L = handle.includes('l'), T = handle.includes('t'), R = handle.includes('r'), B = handle.includes('b')
        let w = b0.w, h = b0.h
        if (R) w = b0.w + dx; if (L) w = b0.w - dx; if (B) h = b0.h + dy; if (T) h = b0.h - dy
        w = Math.max(30, Math.round(w)); h = Math.max(20, Math.round(h))
        if (lockAspect && b0.w) h = Math.max(20, Math.round(w * b0.h / b0.w))  // keep the logo's proportions
        let x = b0.x, y = b0.y
        if (L) x = Math.round(b0.x + (b0.w - w)); if (T) y = Math.round(b0.y + (b0.h - h))
        const rw = w / b0.w, rh = h / b0.h   // scale the image (crop window) with the frame
        const nb = fitBounds({ ...b0, w, h, x, y, ix: Math.round(b0.ix * rw), iy: Math.round(b0.iy * rh), iw: Math.round(b0.iw * rw), ih: Math.round(b0.ih * rh) })
        last = nb; setBox(nb); reportLive(nb)
        return
      }
      // crop: move one frame edge, keep the image absolutely still → clips it
      let { x, y, w, h, ix, iy } = b0
      if (handle === 'r') w = Math.max(24, Math.round(b0.w + dx))
      if (handle === 'b') h = Math.max(24, Math.round(b0.h + dy))
      if (handle === 'l') { const nw = Math.max(24, Math.round(b0.w - dx)); const used = b0.w - nw; x = Math.round(b0.x + used); w = nw; ix = Math.round(b0.ix - used) }
      if (handle === 't') { const nh = Math.max(24, Math.round(b0.h - dy)); const used = b0.h - nh; y = Math.round(b0.y + used); h = nh; iy = Math.round(b0.iy - used) }
      const nb = fitBounds({ ...b0, x, y, w, h, ix, iy })
      last = nb; setBox(nb); reportLive(nb)
    }
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); draggingRef.current = false; onLay(last) }
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
          onError={() => setBroken(true)}
          onLoad={(e) => {
            // defer so a CACHED image (onLoad fires during render) never setStates mid-render
            const img = e.target
            setTimeout(() => {
              // a 1×1 (or empty) source is a broken/placeholder thumbnail — don't stretch it
              if (img.naturalWidth <= 1 || img.naturalHeight <= 1) { setBroken(true); return }
              setBroken(false)
              if (lockAspect && !lay) {
                const r = img.naturalWidth / img.naturalHeight
                if (r > 0) {
                  const h = Math.max(20, Math.round(box.w / r))
                  // fitCenterH: vertically centre the fitted image inside its container (#5 — package
                  // tiles hugged the top edge); 14px reserved for the caption below the image.
                  const y = fitCenterH ? Math.max(2, Math.round((fitCenterH - h - 14) / 2)) : box.y
                  let fitted = { ...box, h, y, ix: 0, iy: 0, iw: box.w, ih: h }
                  // an image taller/wider than its section box shrinks to fit, aspect kept — it
                  // must NEVER spill past the box (the vanished-artwork bug)
                  fitted = fitBounds(fitted)
                  // autoCrop (#8): on a FRESH artwork, crop the frame straight to the sign's
                  // detected bounding box — background margins never even appear.
                  if (autoCrop) {
                    const nb = detectSubjectBox(img)
                    if (nb) {
                      const bx = nb.x * fitted.w, by = nb.y * fitted.h
                      const bw = nb.w * fitted.w, bh = nb.h * fitted.h
                      if (bw > 12 && bh > 12 && (bx > 4 || by > 4 || bx + bw < fitted.w - 4 || by + bh < fitted.h - 4)) {
                        fitted = fitBounds({
                          ...fitted,
                          x: Math.round(fitted.x + bx), y: Math.round(fitted.y + by),
                          w: Math.round(bw), h: Math.round(bh),
                          ix: -Math.round(bx), iy: -Math.round(by), iw: fitted.w, ih: fitted.h,
                        })
                      }
                    }
                  }
                  // centre the final frame inside its bounds so a shrunk image sits nicely
                  if (bounds) {
                    fitted = { ...fitted, x: Math.round((bounds.w - fitted.w) / 2), y: fitCenterH ? fitted.y : Math.round((bounds.h - fitted.h) / 2) }
                  }
                  setBox(fitted); onLay(fitted)
                }
              }
            }, 0)
          }}
          style={{ position: 'absolute', left: box.ix, top: box.iy, width: box.iw, height: box.ih, objectFit: 'contain', display: broken ? 'none' : 'block', pointerEvents: 'none' }} />
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

// Dimension annotation: an arrowed measurement line with an editable size label, shown beside
// the artwork (like a shop drawing). Drag the body to move, pull the end dot to change length,
// click the label to type the size. The line + label print; the purple chrome does not.
function AdjDim({ rk, lay, onLay, scaleRef, selected, onSelect, onRemove }) {
  const [d, setD] = useState(lay)
  // Follow EXTERNAL geometry updates (the live "re-hug the artwork" sync writes new x/y/len into
  // layout) — local state used to be initialized once and never re-read, so arrows never moved (#1).
  // Skipped while THIS arrow is being dragged, so the user's own drag is never fought.
  const draggingRef = useRef(false)
  useEffect(() => { if (!draggingRef.current) setD(lay) }, [lay])
  const start = (kind) => (e) => {
    e.preventDefault(); e.stopPropagation(); onSelect()
    draggingRef.current = true
    const sx = e.clientX, sy = e.clientY, d0 = { ...d }, sc = scaleRef.current || 1
    let last = d0   // latest geometry — onLay must never run inside a setD updater (render phase)
    const move = (ev) => {
      const dx = (ev.clientX - sx) / sc, dy = (ev.clientY - sy) / sc
      const nd = kind === 'move'
        ? { ...d0, x: Math.round(d0.x + dx), y: Math.round(d0.y + dy) }
        : { ...d0, len: Math.max(24, Math.round(d0.len + (d0.vert ? dy : dx))) }
      last = nd; setD(nd)
    }
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); draggingRef.current = false; onLay(last) }
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up)
  }
  const C = '#c0392b'
  const head = { position: 'absolute', width: 0, height: 0 }
  return (
    <div data-rk={rk} onMouseDown={start('move')}
      style={{ position: 'absolute', left: d.x, top: d.y, width: d.vert ? 14 : d.len, height: d.vert ? d.len : 14, cursor: 'move', zIndex: 55 }}>
      {d.vert ? (
        <>
          <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 0, borderLeft: `1.2px solid ${C}` }} />
          <span style={{ ...head, left: '50%', top: 0, marginLeft: -4, borderLeft: '4px solid transparent', borderRight: '4px solid transparent', borderBottom: `6px solid ${C}` }} />
          <span style={{ ...head, left: '50%', bottom: 0, marginLeft: -4, borderLeft: '4px solid transparent', borderRight: '4px solid transparent', borderTop: `6px solid ${C}` }} />
        </>
      ) : (
        <>
          <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 0, borderTop: `1.2px solid ${C}` }} />
          <span style={{ ...head, top: '50%', left: 0, marginTop: -4, borderTop: '4px solid transparent', borderBottom: '4px solid transparent', borderRight: `6px solid ${C}` }} />
          <span style={{ ...head, top: '50%', right: 0, marginTop: -4, borderTop: '4px solid transparent', borderBottom: '4px solid transparent', borderLeft: `6px solid ${C}` }} />
        </>
      )}
      <span contentEditable suppressContentEditableWarning spellCheck={false}
        onMouseDown={(e) => e.stopPropagation()}
        onBlur={(e) => { const label = e.target.innerText.trim(); const n = { ...d, label }; setD(n); onLay(n) }}
        style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', background: '#fff', color: C, fontSize: 9, fontWeight: 700, padding: '0 3px', whiteSpace: 'nowrap', outline: 'none', textTransform: 'none' }}
      >{d.label}</span>
      {selected && (
        <>
          <span className="adj-ui" title="Length" onMouseDown={start('len')}
            style={{ position: 'absolute', ...(d.vert ? { left: '50%', bottom: -6, marginLeft: -5 } : { right: -6, top: '50%', marginTop: -5 }), width: 11, height: 11, background: '#fff', border: '1.5px solid #8b5cf6', borderRadius: '50%', cursor: d.vert ? 'ns-resize' : 'ew-resize', zIndex: 60 }} />
          <span className="adj-ui" title="Remove" onMouseDown={(e) => { e.stopPropagation(); onRemove() }}
            style={{ position: 'absolute', top: -18, right: -6, width: 15, height: 15, background: '#fff', border: '1.5px solid #e05661', borderRadius: '50%', color: '#e05661', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', zIndex: 60 }}>×</span>
        </>
      )}
    </div>
  )
}

// Editable block: content is written ONCE on mount, imperatively — never through props.
// (Passing dangerouslySetInnerHTML makes React re-apply the ORIGINAL html on every re-render,
// erasing whatever the user typed the moment anything else updates — e.g. the "Saved" toast.)
function EBlock({ k, html, style }) {
  const ref = useRef(null)
  const first = useRef(true)
  useEffect(() => {
    // sanitize before it touches the DOM — block content is untrusted (hand-edited + server round-trip)
    if (first.current && ref.current) { ref.current.innerHTML = sanitizeHtml(html); first.current = false }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div ref={ref} data-key={k} contentEditable suppressContentEditableWarning
      spellCheck lang="en-US" style={{ outline: 'none', ...style }} />
  )
}

// Editable table cell for quantities / prices / descriptions on item rows: content written once
// (uncontrolled, like EBlock) so autosave re-renders never clobber typing; commits on blur.
function EditCell({ value, onCommit, style }) {
  const ref = useRef(null)
  const first = useRef(true)
  useEffect(() => { if (first.current && ref.current) { ref.current.innerText = String(value ?? ''); first.current = false } }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // follow an EXTERNAL value change (e.g. qty normalized after commit) — never while focused
  useEffect(() => {
    const el = ref.current
    if (el && document.activeElement !== el && el.innerText !== String(value ?? '')) el.innerText = String(value ?? '')
  }, [value])
  return (
    <div ref={ref} contentEditable suppressContentEditableWarning spellCheck={false}
      onBlur={(e) => onCommit(e.target.innerText.trim())} style={{ outline: 'none', ...style }} />
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
  // Corner resize — BOTH dimensions, like the artwork image (#3). Left/top corners also move
  // the chip so the opposite corner stays anchored.
  const startCorner = (handle) => (e) => {
    e.preventDefault(); e.stopPropagation(); onSelect()
    const sx = e.clientX, sy = e.clientY, s0 = { ...sw }, sc = scaleRef.current || 1
    const L = handle.includes('l'), T = handle.includes('t')
    const move = (ev) => {
      const dx = (ev.clientX - sx) / sc, dy = (ev.clientY - sy) / sc
      const w = Math.max(28, Math.round(L ? s0.w - dx : s0.w + dx))
      const h = Math.max(12, Math.round(T ? s0.h - dy : s0.h + dy))
      onChange({ ...s0, w, h, x: L ? Math.round(s0.x + (s0.w - w)) : s0.x, y: T ? Math.round(s0.y + (s0.h - h)) : s0.y, moved: true })
    }
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); onDragEnd && onDragEnd() }
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up)
  }
  const isRGB = sw.color === 'RGB'                     // colour-changing neon (#10)
  const has = !!sw.color
  // RGB fills the swatch like a colour wheel; the label is forced to "RGB CHANGING COLOR".
  const bg = isRGB ? 'conic-gradient(from 0deg, red, yellow, lime, aqua, blue, magenta, red)' : (has ? sw.color : '#e5e5e5')
  const label = isRGB ? 'RGB CHANGING COLOR' : (sw.name || '')
  return (
    <div data-rk={rk} onMouseDown={startDrag}
      style={{ position: 'absolute', left: sw.x, top: sw.y, width: sw.w, height: sw.h, cursor: 'move' }}>
      <div style={{ width: '100%', height: '100%', background: bg, color: isRGB ? '#111' : swatchText(bg), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, border: '1px solid rgba(0,0,0,0.3)', overflow: 'hidden', padding: '0 4px', boxSizing: 'border-box', textShadow: isRGB ? '0 0 3px rgba(255,255,255,0.9)' : undefined }}>
        {label}
      </div>
      {selected && (
        <>
          <div className="adj-ui" style={{ position: 'absolute', inset: -2, border: '1.5px solid #8b5cf6', pointerEvents: 'none' }} />
          <span className="adj-ui" onMouseDown={startResize} title="Drag to widen"
            style={{ position: 'absolute', right: -5, top: '50%', marginTop: -8, width: 9, height: 16, background: '#fff', border: '1.5px solid #8b5cf6', borderRadius: 2, cursor: 'ew-resize', zIndex: 71 }} />
          {/* corner handles: resize BOTH dimensions, like the artwork image (#3) */}
          {[['tl', { left: -6, top: -6, cursor: 'nwse-resize' }], ['tr', { right: -6, top: -6, cursor: 'nesw-resize' }],
            ['bl', { left: -6, bottom: -6, cursor: 'nesw-resize' }], ['br', { right: -6, bottom: -6, cursor: 'nwse-resize' }]].map(([c, pos]) => (
            <span key={c} className="adj-ui" title="Resize" onMouseDown={startCorner(c)}
              style={{ position: 'absolute', width: 10, height: 10, background: '#fff', border: '1.5px solid #8b5cf6', borderRadius: '50%', zIndex: 71, ...pos }} />
          ))}
          <div className="adj-ui" onMouseDown={(e) => e.stopPropagation()}
            style={{ position: 'absolute', top: '100%', left: 0, marginTop: 6, zIndex: 70, background: '#fff', border: '1px solid #8b5cf6', borderRadius: 6, padding: 8, display: 'flex', gap: 6, alignItems: 'center', boxShadow: '0 4px 12px rgba(0,0,0,0.18)', textTransform: 'none', width: 246 }}>
            <input type="color" value={isRGB || !has ? '#000000' : sw.color} onChange={(e) => onChange({ ...sw, color: e.target.value })}
              title="Pick color" style={{ width: 34, height: 30, padding: 0, border: 'none', background: 'none', cursor: 'pointer' }} />
            {/* RGB colour-changing toggle (#10) — for neon signs whose colour isn't static */}
            <button type="button" onClick={() => onChange({ ...sw, color: isRGB ? '' : 'RGB' })}
              title="RGB colour-changing (neon)"
              style={{ border: isRGB ? '2px solid #8b5cf6' : '1px solid #ccc', borderRadius: 4, cursor: 'pointer', width: 30, height: 30, padding: 0, background: 'conic-gradient(from 0deg, red, yellow, lime, aqua, blue, magenta, red)', fontSize: 0 }}>RGB</button>
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

// Detect the subject's bounding box inside an image (#2): sample the border pixels for the
// background colour, mark every pixel that differs beyond a threshold (or is transparent-vs-not),
// and return the normalized bounding rect {x,y,w,h} in [0..1] of the natural image — or null.
// This is the cv.findContours→boundingRect pipeline done with raw canvas pixels: same result for
// a single bbox, without shipping OpenCV's ~8MB WASM. Throws nothing; returns null on any failure
// (CORS-tainted canvas, degenerate image, subject filling the whole frame).
function detectSubjectBox(img) {
  try {
    const nw = img.naturalWidth, nh = img.naturalHeight
    if (!nw || !nh || nw <= 2 || nh <= 2) return null
    const MAX = 320                                    // downscale for speed — bbox precision ~0.3%
    const s = Math.min(1, MAX / Math.max(nw, nh))
    const w = Math.max(2, Math.round(nw * s)), h = Math.max(2, Math.round(nh * s))
    const cv = document.createElement('canvas')
    cv.width = w; cv.height = h
    const ctx = cv.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(img, 0, 0, w, h)
    const d = ctx.getImageData(0, 0, w, h).data       // throws if the canvas is CORS-tainted
    const px = (x, y) => { const i = (y * w + x) * 4; return [d[i], d[i + 1], d[i + 2], d[i + 3]] }
    // background = average of the border ring (skip transparent border pixels; count them)
    let br = 0, bg = 0, bb = 0, n = 0, transparent = 0, border = 0
    const eat = (x, y) => { const [r, g, b, a] = px(x, y); border++; if (a < 16) { transparent++; return } br += r; bg += g; bb += b; n++ }
    for (let x = 0; x < w; x++) { eat(x, 0); eat(x, h - 1) }
    for (let y = 1; y < h - 1; y++) { eat(0, y); eat(w - 1, y) }
    const alphaMode = transparent > border * 0.5      // PNG with transparent background
    if (n > 0) { br /= n; bg /= n; bb /= n }
    const THR = 42                                     // colour distance that counts as "subject"
    let minX = w, minY = h, maxX = -1, maxY = -1
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const [r, g, b, a] = px(x, y)
        const isSubject = alphaMode
          ? a >= 16
          : a >= 16 && (Math.abs(r - br) + Math.abs(g - bg) + Math.abs(b - bb)) > THR
        if (isSubject) {
          if (x < minX) minX = x; if (x > maxX) maxX = x
          if (y < minY) minY = y; if (y > maxY) maxY = y
        }
      }
    }
    if (maxX < 0) return null                          // nothing found
    const bw = maxX - minX + 1, bh = maxY - minY + 1
    const cover = (bw * bh) / (w * h)
    if (cover > 0.985 || cover < 0.005) return null    // whole frame / speck → no useful box
    return { x: minX / w, y: minY / h, w: bw / w, h: bh / h }
  } catch { return null }
}

const HD_SCALE = 3   // html2canvas DPI factor for PNG/PDF downloads (~288dpi on a Letter page — crisp text)
const LOUPE = 185, SRC = 38   // eyedropper magnifier: loupe diameter (px) and source pixels across it
                              // (~5.5px per pixel — pixels stay visible but you keep enough context to aim)

function Proposal({ mode, tpl, answers, customSpec, info, artworkPath, logo, savedState, onSave, aiResult, paymentLink, proposalNotes, sideViews = [], onSideViews, approval, quoteId, canCreatePaymentLinks, onPaymentLinkCreated, mainView, signBox,
  // --- multi-page (multi-sign) quote props ---
  // partLabel: 'A'/'B'/… shown after the PROPOSAL ID, or null for a single-sign quote.
  // multi: this quote has >1 part → per-part prices are hidden (Sami's rule: the customer only
  //        ever sees the combined total, on the last page).
  // isLast: this is the last page → it alone carries the totals block, downloads and payment.
  // quoteTotal: the whole quote's grand total (Σ parts); the totals block shows THIS, not the
  //        part's own amount. null for single-sign (falls back to this proposal's own total).
  partLabel = null, multi = false, isLast = true, quoteTotal = null }, fwdRef) {
  // approval lock: while the quote is locked and the price unapproved, nothing goes out
  const exportBlocked = !!(approval?.locked && !approval?.approved)
  const pageRef = useRef(null)
  const wrapRef = useRef(null)
  const [scale, setScale] = useState(1)
  const [scaledH, setScaledH] = useState(1056)
  const [busy, setBusy] = useState('')
  const [toast, setToast] = useState('')
  const [pickingSV, setPickingSV] = useState(false)
  const [svLib, setSvLib] = useState([])   // team side-view library ({name, data:{path}}) — shared across quotes
  const [svSearch, setSvSearch] = useState('')   // search across ~100 side-view cards
  const [svGroup, setSvGroup] = useState(null)   // #3 — selected main sign type in the two-level picker
  // category buckets so ~100 cards read as a catalog, not a wall (T18)
  const svGroupOf = (label) => {
    const t = String(label || '').toUpperCase()
    if (/RACEWAY/.test(t)) return 'Channel Letters on Raceway'
    if (/BACKER/.test(t)) return 'Channel Letters on Backer'
    if (/CHANNEL|FRONT LIT|BACK LIT|BACKLIT|HALO|TRIM/.test(t)) return 'Channel Letters'
    if (/MONUMENT/.test(t)) return 'Monuments'
    if (/BLADE|PROJECTING/.test(t)) return 'Blade / Projecting'
    if (/CABINET|LIGHT ?BOX|LIGHTBOX/.test(t)) return 'Cabinets / Lightboxes'
    if (/PYLON|POLE/.test(t)) return 'Pylons'
    if (/NEON/.test(t)) return 'Neon'
    if (/PUSH.?THR/.test(t)) return 'Push-Thru'
    if (/DIMENSIONAL|FLAT CUT|ACRYLIC|METAL LETTER|PVC|FOAM/.test(t)) return 'Dimensional Letters'
    return 'Other'
  }
  const SV_GROUP_ORDER = ['Channel Letters', 'Channel Letters on Raceway', 'Channel Letters on Backer', 'Dimensional Letters', 'Cabinets / Lightboxes', 'Monuments', 'Blade / Projecting', 'Pylons', 'Push-Thru', 'Neon', 'Other']
  useEffect(() => {
    if (!pickingSV) return
    listCatalog('side_view').then(setSvLib).catch(() => {})
  }, [pickingSV])
  const [selId, setSelId] = useState(null)                          // selected adjustable image
  const [layout, setLayout] = useState(savedState?.__layout || {})  // persisted geometry per image
  const SW_W = 96, SW_H = 20   // default swatch size (now horizontally resizable)
  const [swatches, setSwatches] = useState(() => {
    // saved sizes are honored as-is — chips are fully resizable now (#3)
    if (savedState?.__swatches?.length) return savedState.__swatches.map((s) => ({ ...s }))
    // custom mode: seed the two chips only when the spec text actually has colour lines
    // (catalog-prefilled specs do); a fully free-form spec starts with none.
    if (mode === 'custom' && !/FACE[^\n]*COLOR/i.test(customSpec?.specText || '')) return []
    // Two default chips, stacked + left-aligned, anchored later to the FACE / RETURN & TRIM colour
    // lines. Default first BLACK, second WHITE (the common pair); the rep adjusts via the picker.
    return [
      { id: 'face', name: 'BLACK', color: '#000000', x: 300, y: 690, w: SW_W, h: SW_H },
      { id: 'rettrim', name: 'WHITE', color: '#ffffff', x: 300, y: 712, w: SW_W, h: SW_H },
    ]
  })
  // Add a chip to the RIGHT of the existing ones, on the same row (auto-aligned).
  // With no existing chips (custom mode has no seeded colour lines), start inside the
  // SPECIFICATIONS block instead of floating over the item table.
  const addSwatch = () => {
    const id = 'sw' + Date.now()
    setSwatches((s) => {
      const row = s.find((x) => x.id === 'face') || s[0]
      const rightX = s.reduce((m, x) => Math.max(m, x.x + x.w), row ? row.x : 96)
      // keep:true → a hand-added chip stays visible even while empty (it used to vanish on deselect)
      return [...s, { id, name: '', color: '', keep: true, x: row ? rightX + 16 : 96, y: row ? row.y : 640, w: SW_W, h: SW_H }]
    })
    setSelId('swatch-' + id)
  }
  // After a drag, snap a chip's row to a neighbour so rows stay aligned.
  const snapRow = (id) => setSwatches((arr) => {
    const me = arr.find((s) => s.id === id); if (!me) return arr
    const near = arr.find((s) => s.id !== id && Math.abs(s.y - me.y) <= 18)
    return near ? arr.map((s) => (s.id === id ? { ...s, y: near.y } : s)) : arr
  })
  // #7 — the ITEM DETAILS artwork area background, so a grey-background artwork can sit on a
  // matching grey instead of clashing white. Persisted with the proposal state.
  const [artBg, setArtBg] = useState(savedState?.__artBg || '#ffffff')
  const [hideNotes, setHideNotes] = useState(!!savedState?.__hideNotes)   // #6 — Additional Notes removable
  // #7 — PROPOSAL ID / DATE / JOB align to the START of the header address ("101 E LUZERNE …"),
  // not to the right wall. The header block shrink-wraps, so its left edge IS that start; measure
  // it and pad the info-right cell to line up, left-aligned.
  const [infoRightPad, setInfoRightPad] = useState(null)
  useEffect(() => {
    const measure = () => {
      const page = pageRef.current
      const contact = page?.querySelector('[data-key="contact"]')
      const right = page?.querySelector('[data-key="infoRight"]')
      if (!contact || !right) return
      const sc = scaleRef.current || 1
      const pad = (contact.getBoundingClientRect().left - right.getBoundingClientRect().left) / sc
      if (Number.isFinite(pad) && pad > 0 && pad < 500) setInfoRightPad(Math.round(pad))
    }
    measure()
    const t = setTimeout(measure, 200)   // after fonts settle
    return () => clearTimeout(t)
  }, [scale]) // eslint-disable-line react-hooks/exhaustive-deps
  const artBgInputRef = useRef(null)
  // #6 — align each control group to the vertical position of the proposal section it edits
  const controlsRef = useRef(null)
  const [secTops, setSecTops] = useState(null)   // { items, specs, sideview } px tops, or null = fall back to stacked
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

  // ---- Undo / redo / copy / paste for proposal OBJECTS (#1): geometry + swatches history.
  // Text blocks keep the browser's native undo (shortcuts are ignored while typing in them). ----
  const histRef = useRef({ stack: [], idx: -1, silent: false })
  const selRef = useRef(null); selRef.current = selId
  const swRef = useRef(swatches); swRef.current = swatches
  const layRef = useRef(layout); layRef.current = layout
  const clipRef = useRef(null)
  useEffect(() => {
    const h = histRef.current
    if (h.silent) { h.silent = false; return }
    h.stack = h.stack.slice(0, h.idx + 1)
    h.stack.push({ layout, swatches })
    if (h.stack.length > 80) h.stack.shift()
    h.idx = h.stack.length - 1
  }, [layout, swatches])
  useEffect(() => {
    if (!mainView) return
    const applyHist = (dir) => {
      const h = histRef.current
      const to = h.idx + dir
      if (to < 0 || to >= h.stack.length) return
      h.idx = to
      // both writes batch into ONE history-effect run — one silent flag covers it
      h.silent = true
      setLayout(h.stack[to].layout)
      setSwatches(h.stack[to].swatches)
      flash(dir < 0 ? 'Undo' : 'Redo')
    }
    const onKey = (e) => {
      // while typing in any text field/block, the browser's own shortcuts must win
      if (e.target?.closest?.('[contenteditable], input, textarea, select')) return
      if (!(e.ctrlKey || e.metaKey)) return
      const k = e.key.toLowerCase()
      if (k === 'z') { e.preventDefault(); applyHist(e.shiftKey ? +1 : -1) }
      else if (k === 'y') { e.preventDefault(); applyHist(+1) }
      else if (k === 'c') {
        const id = selRef.current
        const sw = id?.startsWith('swatch-') ? swRef.current.find((s) => 'swatch-' + s.id === id) : null
        if (sw) { clipRef.current = { type: 'swatch', data: { ...sw } }; flash('Swatch copied — Ctrl+V to paste') }
      } else if (k === 'v') {
        const clip = clipRef.current
        if (clip?.type === 'swatch') {
          e.preventDefault()
          const id = 'sw' + Date.now()
          setSwatches((arr) => [...arr, { ...clip.data, id, keep: true, moved: true, x: clip.data.x + 14, y: clip.data.y + 14 }])
          setSelId('swatch-' + id)
          flash('Swatch pasted')
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [mainView]) // eslint-disable-line react-hooks/exhaustive-deps

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
    // refit when the wrapper's own width changes (e.g. the controls column takes space beside it)
    const ro = wrapRef.current ? new ResizeObserver(fit) : null
    if (ro && wrapRef.current) ro.observe(wrapRef.current)
    return () => { clearTimeout(t); window.removeEventListener('resize', fit); ro?.disconnect() }
  }, [])

  const price = Number((mode === 'custom' ? customSpec?.price : answers?.price) || 0)
  const itemDesc = mode === 'custom'
    ? (customSpec?.itemDesc || 'CUSTOM SIGNAGE')
    : ((tpl?.desc || 'SIGN') + ' FOR ' + (info.company || ''))

  // ---- Quantity + extra line items (#2/#4): TOTAL = qty × unit price, per row; the subtotal and
  // deposits are computed from the GRAND total (main row + every extra line item). Persisted in
  // proposal_state as __qty / __items; the wizard's Quantity field seeds __qty. ----
  const [qty, setQty] = useState(() => {
    const q = parseInt(savedState?.__qty ?? (mode === 'custom' ? customSpec?.qty : answers?.qty) ?? 1, 10)
    return Number.isFinite(q) && q > 0 ? q : 1
  })
  const [items, setItems] = useState(() => (Array.isArray(savedState?.__items) ? savedState.__items : []))
  const grandTotal = price * qty + items.reduce((s, it) => s + Math.max(0, Number(it.qty) || 0) * Math.max(0, Number(it.unit) || 0), 0)
  // The figure the TOTALS block shows: the whole-quote sum on a multi-page quote, else this
  // proposal's own total. Deposits, the ≤$500 rule and payment all key off this.
  const totalsAmount = quoteTotal != null ? quoteTotal : grandTotal
  const addItem = () => setItems((arr) => [...arr, { id: 'li' + Date.now(), desc: 'ADDITIONAL ITEM', qty: 1, unit: 0 }])
  const patchItem = (id, patch) => setItems((arr) => arr.map((it) => (it.id === id ? { ...it, ...patch } : it)))
  const removeItem = (id) => setItems((arr) => arr.filter((it) => it.id !== id))
  // live money re-sync: when qty / line items change, rewrite the derived money blocks in place
  // (EBlocks are write-once, so DOM writes are the one honest channel after mount)
  const setBlock = (k, html) => {
    const el = pageRef.current?.querySelector(`[data-key="${k}"]`)
    if (el && el.innerHTML !== html) el.innerHTML = html
  }
  const moneyMounted = useRef(false)
  useEffect(() => {
    if (!moneyMounted.current) { moneyMounted.current = true; return }
    setBlock('totalPrice', money(price * qty))
    // totals reflect the WHOLE quote (Σ parts) on a multi-page quote, this proposal otherwise
    setBlock('subtotal', money(totalsAmount))
    setBlock('dep1', money(totalsAmount / 2))
    setBlock('dep2', money(totalsAmount / 2))
    queueSave()
  }, [qty, items, price, totalsAmount]) // eslint-disable-line react-hooks/exhaustive-deps

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
      const isColor = hasColor && (/FACE/i.test(clean) || /RETURN/i.test(clean) || /TRIM/i.test(clean) || /NEON/i.test(clean))
      // Colour lines: keep the colour name(s) and render them IN colour (#1) instead of dropping
      // the value. Label stays plain; the value after the colon is colourised.
      // On colour lines drop the colour word after the colon — the draggable SWATCH shows the
      // colour (the rep asked for the swatch chips only, not duplicated text).
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
      // CONTACT = one line, email first; the phone only appears when there is no email (#7)
      infoLeft: `<b>COMPANY NAME:</b> ${esc(info.company)}<br><b>CLIENT NAME:</b> ${esc(info.client)}<br><b>CONTACT:</b> ${esc(info.email || info.contact || '')}<br><b>ADDRESS:</b> ${esc(info.address)}`,
      infoRight: `<b>PROPOSAL ID:</b> ${esc(info.quoteId)}${partLabel ? '-' + partLabel : ''}<br><b>DATE:</b> ${dateStr}<br><b>JOB NAME:</b> ${esc(info.job)}`,
      itemDesc: esc(itemDesc),
      unitPrice: money(price),
      totalPrice: money(price * qty),
      specBody: specHTML,
      notes: proposalNotes ? esc(proposalNotes).replace(/\n/g, '<br>') : (tpl?.notes ? esc(tpl.notes) : '&nbsp;'),
      subtotal: money(totalsAmount),
      dep1: money(totalsAmount / 2),
      dep2: money(totalsAmount / 2),
      terms: TERMS_HTML,
      pay: 'CLICK HERE TO MAKE PAYMENT',
      pkgLabel1: 'INSTALLATION TEMPLATE',
      pkgLabel2: 'POWER SUPPLY',
    }
    const merged = { ...def, ...(savedState || {}) }
    // EVERY wizard-derived block (money, client info, item description, spec text, notes) must
    // FOLLOW the wizard — an edit made on any earlier step has to reach the proposal, always.
    // A saved copy only wins for a block the user hand-edited ON the proposal itself (tracked
    // per-block in __dirty). Saves from before dirty-tracking existed have no __dirty array —
    // for those, keep everything (old behavior) so historic hand-edits aren't lost.
    const DERIVED = ['unitPrice', 'totalPrice', 'subtotal', 'dep1', 'dep2', 'infoLeft', 'infoRight', 'itemDesc', 'specBody', 'notes']
    if (!savedState || Array.isArray(savedState.__dirty)) {
      const dirty = new Set(savedState?.__dirty || [])
      DERIVED.forEach((k) => { if (!dirty.has(k)) merged[k] = def[k] })
    }
    // A saved spec belongs to the sign type it was written for — if the type has changed
    // since, the saved text is guaranteed wrong, so rebuild it fresh for the new type.
    if (savedState?.specBody && savedState.__specTpl && tpl?.n && savedState.__specTpl !== tpl.n) {
      merged.specBody = def.specBody
    }
    // MIGRATION (#6): old saved blocks (incl. hand-edited ones) still carry separate PHONE +
    // EMAIL lines — collapse them into the single CONTACT line (email first, phone as fallback)
    // no matter where the block came from. Idempotent: no PHONE/EMAIL labels → untouched.
    if (/<b>\s*(PHONE|EMAIL)\s*:?\s*<\/b>/i.test(merged.infoLeft || '')) {
      const src = merged.infoLeft
      const phone = (src.match(/<b>\s*PHONE\s*:?\s*<\/b>\s*([^<]*)/i)?.[1] || '').trim()
      const email = (src.match(/<b>\s*EMAIL\s*:?\s*<\/b>\s*([^<]*)/i)?.[1] || '').trim()
      merged.infoLeft = src
        .replace(/<b>\s*PHONE\s*:?\s*<\/b>\s*[^<]*/i, `<b>CONTACT:</b> ${esc(email || phone)}`)
        .replace(/(<br\s*\/?>)?\s*<b>\s*EMAIL\s*:?\s*<\/b>\s*[^<]*/i, '')
    }
    return merged
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // editable block — content written once at mount (see EBlock) so React can NEVER clobber edits
  const E = (key, style) => <EBlock key={key} k={key} html={initial[key]} style={style} />
  // when the SPECIFICATIONS run long, drop ADDITIONAL NOTES so the proposal stays on one page (#17)
  const specLong = (initial.specBody || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length > 520

  // common props for a Canva-style adjustable image
  const adjProps = (rk, def) => ({
    rk, def, lay: layout[rk],
    onLay: (b) => setLayout((L) => ({ ...L, [rk]: b })),
    scaleRef, selected: selId === rk, onSelect: () => setSelId(rk),
  })

  // blocks the user typed into ON the proposal — only these keep their saved copy over wizard data
  const dirtyRef = useRef(new Set(savedState?.__dirty || []))

  const captureState = () => {
    const state = { __layout: layout, __swatches: swatches.filter((s) => s.color || s.name), __dirty: [...dirtyRef.current], __specTpl: tpl?.n || null, __artBg: artBg, __qty: qty, __items: items, __hideNotes: hideNotes }
    pageRef.current?.querySelectorAll('[data-key]').forEach((el) => { state[el.dataset.key] = el.innerHTML })
    return state
  }

  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 2500) }

  // ---- Auto-save: persist edits + geometry automatically (debounced). flushRef always points at
  // the LATEST capture + onSave, so neither the debounce nor the unmount flush can ever save a stale
  // (pre-edit) snapshot — which is what was wiping artwork edits on "Save & Return". ----
  const saveTimer = useRef(null)
  const mounted = useRef(false)
  const flushRef = useRef(() => {})
  flushRef.current = () => { try { if (onSave) onSave(captureState()) } catch { /* ignore */ } }
  const queueSave = () => {
    if (!onSave) return
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => { saveTimer.current = null; flushRef.current(); flash('Saved') }, 600)
  }
  useEffect(() => { if (!mounted.current) { mounted.current = true; return } queueSave() }, [layout, swatches, artBg, hideNotes]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = pageRef.current; if (!el) return
    const h = (e) => {
      const k = e.target?.closest?.('[data-key]')?.dataset?.key
      if (k) dirtyRef.current.add(k)   // hand-edited → this block now beats wizard-derived content
      queueSave()
    }
    el.addEventListener('input', h)
    return () => el.removeEventListener('input', h)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // Flush a pending save on unmount (e.g. "Save & Return" right after an edit) using the LATEST snapshot.
  useEffect(() => () => { if (saveTimer.current) { clearTimeout(saveTimer.current); flushRef.current() } }, []) // eslint-disable-line react-hooks/exhaustive-deps

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
    // Align both chips to the SAME x (the rightmost/lower label) so they sit in a neat column.
    const X = Math.max(faceLine.x, retLine ? retLine.x : 0)
    const target = { face: { x: X, y: faceLine.y } }
    if (retLine) target.rettrim = { x: X, y: retLine.y }
    setSwatches((arr) => {
      let changed = false
      const next = arr.map((s) => {
        if (s.moved) return s                    // rep dragged it by hand → stop re-anchoring (#1)
        const t = target[s.id]
        if (t && (s.x !== t.x || s.y !== t.y)) { changed = true; return { ...s, x: t.x, y: t.y } }
        return s
      })
      return changed ? next : arr
    })
  }, [specHTML, scale]) // eslint-disable-line react-hooks/exhaustive-deps

  // #6 — measure each tagged proposal section's top so its control group can sit in front of it.
  useEffect(() => {
    if (!mainView) return
    const measure = () => {
      const col = controlsRef.current
      const page = pageRef.current
      if (!col || !page) return
      const base = col.getBoundingClientRect().top
      const tops = {}
      page.querySelectorAll('[data-sec]').forEach((el) => {
        tops[el.dataset.sec] = Math.max(0, Math.round(el.getBoundingClientRect().top - base))
      })
      if (tops.items != null) setSecTops(tops)
      else setSecTops(null)
    }
    measure()
    const t = setTimeout(measure, 120)   // after fonts/images settle
    return () => clearTimeout(t)
  }, [mainView, scale, scaledH, specHTML, sideViews, artworkPath]) // eslint-disable-line react-hooks/exhaustive-deps

  // #3 — pull each control group down so it sits IN FRONT of its proposal section. Groups stay in
  // normal flow (a plain stack) and only get a computed margin-top, applied in ascending-target
  // order with a cumulative pass — so unlike raw absolute positioning, overlap is impossible and
  // a group can never sit ABOVE its natural stacked position (margins are clamped at 0).
  const grpRefs = useRef({})
  useEffect(() => {
    if (!mainView) return
    const col = controlsRef.current
    if (!col) return
    const order = [
      ['art', secTops ? secTops.items : null],
      ['dims', secTops ? secTops.items + 56 : null],
      ['cols', secTops ? secTops.specs : null],
      ['spec', secTops ? secTops.specs + 88 : null],
      ['sv', secTops?.sideview != null ? secTops.sideview : null],
    ]
    // reset, then apply cumulatively (reading offsetTop after each write forces sync layout,
    // so later groups see the margins already added above them)
    order.forEach(([k]) => { const el = grpRefs.current[k]; if (el) el.style.marginTop = '0px' })
    if (!secTops) return   // no measurement → keep the plain stack
    const colTop = col.getBoundingClientRect().top
    order.forEach(([k, target]) => {
      const el = grpRefs.current[k]
      if (!el || target == null) return
      const natural = el.getBoundingClientRect().top - colTop
      el.style.marginTop = Math.max(0, Math.round(target - natural)) + 'px'
    })
  }, [mainView, secTops]) // eslint-disable-line react-hooks/exhaustive-deps

  // #8 — keep the dimension arrows glued to the artwork in real time: when the artwork moves or
  // is resized, the arrows re-hug its edges (or the marked sign box), scaling their LENGTH while
  // keeping the typed label/number. First sight is skipped so saved arrow positions load intact.
  const lastArtRef = useRef(null)
  const detectedBoxRef = useRef(null)   // auto-detected sign bbox (fractions of the artwork frame, #2)
  useEffect(() => {
    const a = layout.artwork
    if (!a || (!layout['dim-w'] && !layout['dim-h'])) return
    const key = `${a.x},${a.y},${a.w},${a.h}`
    const prev = lastArtRef.current
    lastArtRef.current = key
    if (prev === null || prev === key) return   // first sight (respect saved positions) or no change
    const sb = (signBox && Number.isFinite(signBox.w) ? signBox : null) || detectedBoxRef.current
    const rect = sb
      ? { x: a.x + sb.x * a.w, y: a.y + sb.y * a.h, w: sb.w * a.w, h: sb.h * a.h }
      : { x: a.x, y: a.y, w: a.w, h: a.h }
    setLayout((L) => {
      const n = { ...L }
      if (n['dim-w']) n['dim-w'] = { ...n['dim-w'], x: Math.round(rect.x), y: Math.max(2, Math.round(rect.y - 16)), len: Math.max(24, Math.round(rect.w)) }
      if (n['dim-h']) n['dim-h'] = { ...n['dim-h'], x: Math.max(2, Math.round(rect.x - 18)), y: Math.round(rect.y), len: Math.max(24, Math.round(rect.h)) }
      return n
    })
  }, [layout.artwork, signBox]) // eslint-disable-line react-hooks/exhaustive-deps

  // Dimension arrows are NOT auto-added — the customer's artwork often already shows them,
  // and adding a second set is wrong (#7). Use the "+ Dimensions" button to add them by hand.

  const render = async (opts = {}) => {
    // capture at the page's true 816px size (drop the fit-to-fit scale during render)
    const el = pageRef.current
    const prev = el.style.transform
    el.style.transform = 'none'
    const handles = [...el.querySelectorAll('.adj-ui')]
    handles.forEach((h) => { h.style.visibility = 'hidden' })   // don't print selection chrome
    // clean mode (Shopify product image): hide the price/deposit block
    const priceBlocks = opts.clean ? [...el.querySelectorAll('[data-price-block]')] : []
    priceBlocks.forEach((b) => { b.dataset._vis = b.style.visibility; b.style.visibility = 'hidden' })
    // html2canvas ignores object-fit:contain and STRETCHES images to their box (squashed
    // package/side-view images in the PNG). Emulate the letterboxing with explicit geometry
    // for the capture, then restore.
    const imgs = [...el.querySelectorAll('[data-rk] img')].filter((im) => im.naturalWidth > 0)
    const savedCss = imgs.map((im) => ({ im, css: im.style.cssText }))
    imgs.forEach((im) => {
      const bw = im.offsetWidth, bh = im.offsetHeight
      if (!bw || !bh) return
      const r = im.naturalWidth / im.naturalHeight
      let w = bw, h = bw / r
      if (h > bh) { h = bh; w = bh * r }
      im.style.left = (parseFloat(im.style.left || 0) + (bw - w) / 2) + 'px'
      im.style.top = (parseFloat(im.style.top || 0) + (bh - h) / 2) + 'px'
      im.style.width = w + 'px'
      im.style.height = h + 'px'
      im.style.objectFit = 'fill'
    })
    try {
      // Capture DPI. On-screen/Shopify use 2×; PDF/PNG downloads use a higher factor so the
      // rasterised text stays crisp when zoomed (2× ≈ 150dpi looked pixelated — #PDF/PNG).
      return await html2canvas(el, { scale: opts.scale || 2, backgroundColor: '#ffffff', useCORS: true, logging: false })
    } finally {
      el.style.transform = prev
      handles.forEach((h) => { h.style.visibility = '' })
      savedCss.forEach(({ im, css }) => { im.style.cssText = css })
      priceBlocks.forEach((b) => { b.style.visibility = b.dataset._vis || ''; delete b.dataset._vis })
    }
  }

  // Clean product image (no price block) as a PNG data URL — used when creating a Shopify
  // payment link (S4/S5). Exposed to the parent via the ref below.
  const captureCleanImage = async () => {
    const c = await render({ clean: true })
    return c.toDataURL('image/png')
  }
  // Full proposal (WITH the price block) as a PNG data URL — used for the visual version history
  // so each saved revision stores the actual proposal image. Scale 2 ≈ 1600px wide: sharp but not huge.
  const captureSnapshot = async () => {
    const c = await render({ scale: 2 })
    return c.toDataURL('image/png')
  }
  useImperativeHandle(fwdRef, () => ({ captureCleanImage, captureSnapshot }))

  const downloadPNG = async () => {
    if (exportBlocked) { flash('🔒 Blocked — the price needs approval before this quote can go out'); return }
    setBusy('png')
    try {
      const c = await render({ scale: HD_SCALE })   // HD so the PNG stays sharp when zoomed
      const a = document.createElement('a')
      a.download = `${info.quoteId || 'quote'}.png`
      a.href = c.toDataURL('image/png'); a.click()
      flash('PNG downloaded')
    } catch (e) { flash('PNG failed: ' + e.message) } finally { setBusy('') }
  }

  // ---- Shopify payment link (S5) ----
  const [plBusy, setPlBusy] = useState('')
  const [plResult, setPlResult] = useState(null)   // { url, kind } on success
  const createPaymentLink = async (kind) => {
    if (exportBlocked) { flash('🔒 Blocked — the price needs approval first'); return }
    if (!price || price <= 0) { flash('Set a price before creating a payment link.'); return }
    setPlBusy(kind); setPlResult(null)
    try {
      // flush any pending edit FIRST so it's recorded as a change before the checkpoint is minted
      // server-side (otherwise the last edit would land in the NEXT rev, not this payment's rev).
      try { if (onSave) await onSave(captureState()) } catch { /* non-blocking */ }

      const canvas = await captureCleanImage()   // clean product image (no price block)
      const { data } = await client.post(`/quotes/${quoteId}/payment-link`, {
        kind, image: canvas,
        contact: info.contact || '', email: info.email || '',
      })
      setPlResult({ url: data.url, kind })
      // put the link on the proposal's pay button (preview + PDF) and persist it (#5)
      if (onPaymentLinkCreated && data.url) onPaymentLinkCreated(data.url)

      // the payment minted a version checkpoint ({quote_id}-rev{n}); attach the FULL proposal image
      // (with price block) to it so the history shows exactly what went out. Best-effort.
      if (data.checkpoint?.id) {
        try { await attachCheckpointImage(quoteId, data.checkpoint.id, await captureSnapshot()) } catch { /* image is a nice-to-have */ }
      }
      flash('Payment link created ✓ — saved as ' + (data.checkpoint?.label || 'a new version'))
    } catch (e) {
      flash(e?.response?.data?.error || 'Could not create the payment link.')
    } finally { setPlBusy('') }
  }

  // Real one-click PDF download (#7) — not the Ctrl+P print dialog. Renders the proposal to a
  // canvas, drops it on a single Letter page, and (crucially) lays a REAL clickable link
  // annotation over the "CLICK HERE TO MAKE PAYMENT" button so the Shopify link works in the
  // downloaded file (#6) — image-based PDFs otherwise lose the href.
  const downloadPDF = async () => {
    if (exportBlocked) { flash('🔒 Blocked — the price needs approval before this quote can go out'); return }
    setBusy('pdf')
    try {
      const el = pageRef.current
      const canvas = await render({ scale: HD_SCALE })      // HD capture → crisp text in the PDF
      const pdf = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' })
      const pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight()
      const fit = Math.min(pw / canvas.width, ph / canvas.height)   // fit the whole page, one sheet (#8)
      const w = canvas.width * fit, h = canvas.height * fit
      const ox = (pw - w) / 2, oy = 0
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', ox, oy, w, h)
      // clickable payment link over the pay button
      const a = paymentLink ? el.querySelector('[data-pay-link]') : null
      if (a) {
        const sc = scaleRef.current || 1                    // page is shown scaled on screen
        const pageRect = el.getBoundingClientRect(), r = a.getBoundingClientRect()
        // html2canvas rendered `el` unscaled at HD_SCALE → 1 unscaled css px = HD_SCALE canvas px = HD_SCALE*fit pt
        const k = HD_SCALE * fit
        const lx = ox + ((r.left - pageRect.left) / sc) * k
        const ly = oy + ((r.top - pageRect.top) / sc) * k
        pdf.link(lx, ly, (r.width / sc) * k, (r.height / sc) * k, { url: paymentLink })
      }
      pdf.save(`${info.quoteId || 'quote'}.pdf`)
      flash('PDF downloaded' + (a ? ' — payment link is clickable' : ''))
    } catch (e) { flash('PDF failed: ' + e.message) } finally { setBusy('') }
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

      <div className="proposal-layout" style={{ display: 'flex', gap: 16, alignItems: 'flex-start', justifyContent: 'center', flexWrap: 'wrap' }}>
      <div ref={wrapRef} className="proposal-wrap" style={{ overflow: 'hidden', background: '#5a6270', padding: 20, borderRadius: 10, flex: '1 1 520px', minWidth: 0 }}>
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
            {E('infoRight', infoRightPad != null
              ? { fontSize: 11, lineHeight: 1.9, textAlign: 'left', paddingLeft: infoRightPad }
              : { fontSize: 11, lineHeight: 1.9, textAlign: 'right' })}
          </div>

          {/* item details */}
          <div data-sec="items" style={{ margin: '10px 40px 0', ...headCell, borderTop: '1px solid #777' }}>ITEM DETAILS</div>
          <div style={{ margin: '0 40px', border: '1px solid #777', borderTop: 'none', height: 192, position: 'relative', background: artBg, overflow: 'hidden' }}>
            {artworkPath
              ? <AdjImg {...adjProps('artwork', { x: 188, y: 24, w: 360, h: 144 })} src={fileUrl(artworkPath)} alt="artwork" lockAspect liveLay autoCrop bounds={{ w: 734, h: 192 }} cors={/res\.cloudinary\.com/i.test(fileUrl(artworkPath) || '')} />
              : <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#bbb', fontStyle: 'italic', fontSize: 12, textTransform: 'none' }}>[ Customer artwork — add it in the Artwork step ]</span>}
            {pickFor && artworkPath && (() => { const a = layout.artwork || { x: 188, y: 24, w: 360, h: 144, rot: 0 }; return (
              <div onClick={sampleArtwork} onMouseMove={onPickMove} onMouseLeave={() => setLoupe(null)} title="Click to grab this color"
                style={{ position: 'absolute', left: a.x, top: a.y, width: a.w, height: a.h, transform: `rotate(${a.rot || 0}deg)`, cursor: 'crosshair', zIndex: 80, outline: '2px dashed #8b5cf6', outlineOffset: -1 }} />
            ) })()}
            {/* measurement arrows beside the artwork — movable, resizable, label editable */}
            {['dim-w', 'dim-h'].filter((k) => layout[k]).map((k) => (
              <AdjDim key={k} rk={k} lay={layout[k]} scaleRef={scaleRef}
                onLay={(v) => setLayout((L) => ({ ...L, [k]: v }))}
                selected={selId === k} onSelect={() => setSelId(k)}
                onRemove={() => { setLayout((L) => { const n = { ...L }; delete n[k]; return n }); setSelId(null) }} />
            ))}
          </div>

          {/* item table. On a multi-sign quote per-part prices are hidden (Sami's rule) — the
              table is just DESCRIPTION + QTY, and the combined total shows on the last page. On a
              single-sign quote it keeps the full DESCRIPTION / QTY / UNIT / TOTAL layout. */}
          <div style={{ margin: '7px 40px 0', display: 'grid', gridTemplateColumns: multi ? '1fr 56px' : '1fr 56px 104px 104px' }}>
            <div style={{ ...headCell, borderTop: '1px solid #777' }}>ITEM DESCRIPTION</div>
            <div style={{ ...headCell, borderTop: '1px solid #777', borderLeft: 'none', textAlign: 'center' }}>QTY</div>
            {!multi && <div style={{ ...headCell, borderTop: '1px solid #777', borderLeft: 'none', textAlign: 'center' }}>UNIT PRICE</div>}
            {!multi && <div style={{ ...headCell, borderTop: '1px solid #777', borderLeft: 'none', textAlign: 'center' }}>TOTAL PRICE</div>}
            {E('itemDesc', { ...cell, borderTop: 'none' })}
            {/* QTY is editable (#2): TOTAL = qty × unit price, live */}
            <EditCell value={qty}
              onCommit={(v) => { const n = parseInt(v, 10); setQty(Number.isFinite(n) && n > 0 ? n : 1) }}
              style={{ ...cell, borderTop: 'none', borderLeft: 'none', textAlign: 'center' }} />
            {!multi && E('unitPrice', { ...cell, borderTop: 'none', borderLeft: 'none', textAlign: 'center' })}
            {!multi && E('totalPrice', { ...cell, borderTop: 'none', borderLeft: 'none', textAlign: 'center' })}
            {/* extra line items (#4) — desc / qty editable always; unit/total shown only single-sign */}
            {items.map((it) => {
              const rowTotal = Math.max(0, Number(it.qty) || 0) * Math.max(0, Number(it.unit) || 0)
              return [
                <div key={it.id + 'd'} style={{ ...cell, borderTop: 'none', position: 'relative' }}>
                  <EditCell value={it.desc} onCommit={(v) => patchItem(it.id, { desc: v || 'ITEM' })} style={{ display: 'inline-block', minWidth: 60 }} />
                  <span className="adj-ui" title="Remove this line item" onMouseDown={(e) => { e.preventDefault(); removeItem(it.id) }}
                    style={{ position: 'absolute', right: 3, top: '50%', transform: 'translateY(-50%)', width: 15, height: 15, background: '#fff', border: '1.5px solid #e05661', borderRadius: '50%', color: '#e05661', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>×</span>
                </div>,
                <EditCell key={it.id + 'q'} value={it.qty}
                  onCommit={(v) => { const n = parseInt(v, 10); patchItem(it.id, { qty: Number.isFinite(n) && n > 0 ? n : 1 }) }}
                  style={{ ...cell, borderTop: 'none', borderLeft: 'none', textAlign: 'center' }} />,
                !multi && <EditCell key={it.id + 'u'} value={money(it.unit)}
                  onCommit={(v) => { const n = parseFloat(String(v).replace(/[^0-9.]/g, '')); patchItem(it.id, { unit: Number.isFinite(n) && n >= 0 ? n : 0 }) }}
                  style={{ ...cell, borderTop: 'none', borderLeft: 'none', textAlign: 'center' }} />,
                !multi && <div key={it.id + 't'} style={{ ...cell, borderTop: 'none', borderLeft: 'none', textAlign: 'center' }}>{money(rowTotal)}</div>,
              ]
            })}
          </div>

          {/* specs (left) + package & side view (right): ONE outer frame; the divider is the left
              column's right border, so it's continuous no matter which column ends up taller */}
          <div style={{ margin: '7px 40px 0', display: 'grid', gridTemplateColumns: '1fr 240px', border: '1px solid #777' }}>
            <div style={{ borderRight: '1px solid #777' }}>
              <div data-sec="specs" style={secHead}>SPECIFICATIONS</div>
              {E('specBody', { fontSize: 10.5, lineHeight: 1.9, padding: '10px 12px', minHeight: specLong ? 255 : 215, whiteSpace: 'pre-wrap', outline: 'none', borderBottom: '1px solid #777' })}
              {!specLong && !hideNotes && <>
                <div style={{ ...secHead, position: 'relative' }}>ADDITIONAL NOTES
                  {/* screen-only remover (#6) — restore via "+ Notes" in the right column */}
                  <span className="adj-ui" title="Remove the Additional Notes section"
                    onMouseDown={(e) => { e.preventDefault(); setHideNotes(true) }}
                    style={{ position: 'absolute', right: 5, top: '50%', transform: 'translateY(-50%)', width: 15, height: 15, background: '#fff', border: '1.5px solid #e05661', borderRadius: '50%', color: '#e05661', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>×</span>
                </div>
                {E('notes', { fontSize: 10.5, padding: '8px 12px', minHeight: 40, outline: 'none' })}
              </>}
            </div>
            <div>
              <div style={secHead}>PACKAGE INCLUDES</div>
              <div style={{ position: 'relative', height: 116, borderBottom: '1px solid #777' }}>
                {PACKAGE.map((p, i, arr) => (
                  // Smaller package tiles (#3) — centred as a group across the 240px column.
                  // (Key bumped pkg5→pkg6 to reset saved offsets: tiles are now vertically centred
                  // in the 116px box via fitCenterH (#5); lockAspect keeps natural proportions.)
                  <AdjImg key={p.label} {...adjProps(`pkg6-${p.label}`, { x: Math.round(((240 - arr.length * 96) / (arr.length + 1)) * (i + 1) + 96 * i), y: 6, w: 96, h: 96 })} src={p.img} alt={p.label} lockAspect fitCenterH={116} bounds={{ w: 238, h: 114 }} />
                ))}
                {/* captions glued to each image's REAL position/size (images report their fitted
                    box on load) — always centered right below, follow drags, editable */}
                {PACKAGE.map((p, i, arr) => {
                  const t = layout[`pkg6-${p.label}`]
                  const defX = Math.round(((240 - arr.length * 96) / (arr.length + 1)) * (i + 1) + 96 * i)
                  return E(`pkgLabel${i + 1}`, {
                    position: 'absolute',
                    left: t ? t.x : defX,
                    top: t ? t.y + t.h + 4 : 78,
                    width: t ? t.w : 96,
                    textAlign: 'center', fontSize: 8.5, letterSpacing: 1.5, color: '#555', fontWeight: 600,
                  })
                })}
              </div>
              {/* explicit "no side view" removes the whole section, headline included */}
              {!sideViews.includes('__none__') && (
                <>
                  <div data-sec="sideview" style={secHead}>SIDE VIEW</div>
                  <div style={{ position: 'relative', height: 250 }}>
                    {sideViews.length === 0
                      ? <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#bbb', fontStyle: 'italic', fontSize: 10, textTransform: 'none' }}>[ No side view selected ]</span>
                      : (() => {
                          // tile instead of stacking: one view fills the (now bigger) box; several share it 2-per-row (#3)
                          const list = sideViews.filter((k) => k !== '__none__')
                          const one = list.length === 1
                          return list.map((k, i) => (
                            <AdjImg key={k} {...adjProps(`sv2-${k}`, one
                              ? { x: 10, y: 8, w: 220, h: 234 }
                              : { x: 6 + (i % 2) * 116, y: 6 + Math.floor(i / 2) * 122, w: 112, h: 116 })} src={svSrc(k)} alt={String(k)} bounds={{ w: 238, h: 248 }} />
                          ))
                        })()}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* totals + terms. Terms & Conditions print on EVERY page (#4); the price block (subtotal /
              deposit / pay) prints only on the LAST page — it carries the combined quote total. */}
          <div style={{ margin: '12px 40px 0', display: 'grid', gridTemplateColumns: isLast ? '1fr 1fr' : '1fr', gap: '0 20px' }}>
            {E('terms', { fontSize: 8, lineHeight: 1.3, textTransform: 'none' })}
            {/* price block — hidden when capturing the "clean" image for a Shopify product,
                since the payment options live on the Shopify page, not baked into the picture */}
            {isLast && (
            <div data-price-block>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, fontWeight: 800, marginBottom: 6 }}>
                  <span>SUBTOTAL</span>{E('subtotal')}
                </div>
                {totalsAmount > 500 && <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 6 }}>
                    <span>50% DEPOSIT DUE NOW</span>{E('dep1')}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
                    <span>50% DUE ON SHIPMENT</span>{E('dep2')}
                  </div>
                </>}
              </div>
              {(paymentLink && /^https?:\/\//i.test(paymentLink))   // only real web links render as a button (never javascript:/data:)
                ? <a data-pay-link href={paymentLink} target="_blank" rel="noreferrer" style={{ display: 'block', marginTop: 14, background: '#f5a623', padding: 14, textAlign: 'center', fontSize: 15, fontWeight: 800, letterSpacing: 0.5, color: '#111', textDecoration: 'none' }}>CLICK HERE TO MAKE PAYMENT</a>
                : E('pay', { marginTop: 14, background: '#f5a623', padding: 14, textAlign: 'center', fontSize: 15, fontWeight: 800, letterSpacing: 0.5 })}
            </div>
            )}
          </div>

          {/* draggable color swatches — the filled block prints; the picker chrome (.adj-ui) does not */}
          {swatches.map((sw) => ((sw.id === 'rettrim' && hideRet) ? null : (sw.id === 'face' || sw.id === 'rettrim' || sw.color || sw.name || sw.keep || selId === 'swatch-' + sw.id) ? (
            <AdjSwatch key={sw.id} rk={'swatch-' + sw.id} sw={sw} scaleRef={scaleRef}
              locked={false}
              selected={selId === 'swatch-' + sw.id} onSelect={() => setSelId('swatch-' + sw.id)}
              onChange={(n) => setSwatches((arr) => arr.map((x) => (x.id === sw.id ? n : x)))}
              onRemove={() => { setSwatches((arr) => arr.filter((x) => x.id !== sw.id)); setSelId(null) }}
              onDragEnd={() => { snapRow(sw.id); if (sw.id === 'face' || sw.id === 'rettrim') setSwatches((arr) => arr.map((x) => (x.id === sw.id ? { ...x, moved: true } : x))) }}
              onPick={() => { artCanvasRef.current = null; setPickFor(sw.id) }} canPick={!!artworkPath} />
          ) : null))}
        </div>
        </div>
      </div>

      {mainView && (
      <div ref={controlsRef} className="proposal-controls" style={{ flex: '0 0 220px', maxWidth: 220 }}>
      {/* Each control group sits IN FRONT OF the proposal section it edits (#6): once the section
          tops are measured, the groups are absolutely positioned to line up with ITEM DETAILS,
          SPECIFICATIONS and SIDE VIEW. Before measurement (or if it fails) they stack in order. */}
      {(() => {
        const grpLabel = { fontSize: 10.5, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 6 }
        // Ordered stack (Artwork → Dimensions → Colours → Specs → Side view — ascending section
        // order). The #3 margin effect above pulls each group down to its section's measured top;
        // being a normal flow stack, groups can never overlap (the old absolute attempt could).
        const setGrp = (k) => (el) => { grpRefs.current[k] = el }
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* ARTWORK — aligned to ITEM DETAILS */}
            <div ref={setGrp('art')}>
              <div style={grpLabel}>Artwork</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>Area bg</span>
                {/* #5 — an eyedropper icon (not a big colour box): pick any colour off the screen
                    (EyeDropper API), falling back to a hidden native colour input. */}
                <input ref={artBgInputRef} type="color" value={/^#[0-9a-f]{6}$/i.test(artBg) ? artBg : '#ffffff'} onChange={(e) => setArtBg(e.target.value)} style={{ display: 'none' }} />
                <button type="button" title="Pick the artwork-area background colour"
                  onClick={async () => {
                    if (window.EyeDropper) { try { const { sRGBHex } = await new window.EyeDropper().open(); if (sRGBHex) setArtBg(sRGBHex) } catch { /* cancelled */ } }
                    else { artBgInputRef.current?.click() }
                  }}
                  style={{ width: 28, height: 26, padding: 0, border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer', background: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#333' }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m2 22 1-1h3l9-9" /><path d="M3 21v-3l9-9" /><path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z" /></svg>
                </button>
                {['#ffffff', '#efefef', '#d9d9d9'].map((c) => (
                  <button key={c} type="button" onClick={() => setArtBg(c)} title={c}
                    style={{ width: 22, height: 22, padding: 0, borderRadius: 4, border: artBg === c ? '2px solid var(--gold)' : '1px solid var(--border)', background: c, cursor: 'pointer' }} />
                ))}
              </div>
            </div>

            {/* DIMENSIONS — aligned just under ITEM DETAILS */}
            <div ref={setGrp('dims')}>
              <div style={grpLabel}>Dimensions</div>
              <button
                type="button" className="ghost" style={{ width: '100%' }}
                title="Add measurement arrows beside the artwork (drag to place, pull the dot to resize, click the label to type the size)"
                onClick={() => {
                  const p = parseDims(mode === 'custom' ? customSpec?.dims : answers?.dimensions)
                  const a = layout.artwork || { x: 188, y: 24, w: 360, h: 144 }
                  // Bounding-box priority: manually marked sign box → auto-detected subject bbox
                  // (#2, canvas pixel scan) → the whole artwork frame. When a tighter box is found,
                  // the artwork frame is AUTO-CROPPED to it (the background margins are cut away),
                  // so the frame — and the arrows — are exactly the sign's dimensions.
                  const sb = signBox && Number.isFinite(signBox.w) ? signBox : null
                  let cut = null   // target rect in frame coords {x1,y1,x2,y2}
                  if (sb) {
                    cut = { x1: sb.x * a.w, y1: sb.y * a.h, x2: (sb.x + sb.w) * a.w, y2: (sb.y + sb.h) * a.h }
                  } else if (artworkPath) {
                    const img = pageRef.current?.querySelector('[data-rk="artwork"] img')
                    const nb = img ? detectSubjectBox(img) : null
                    if (nb) {
                      // map natural-image bbox → frame coords through the crop window + object-fit:contain
                      const iw = a.iw ?? a.w, ih = a.ih ?? a.h, ix = a.ix ?? 0, iy = a.iy ?? 0
                      const s = Math.min(iw / img.naturalWidth, ih / img.naturalHeight)
                      const ox = ix + (iw - img.naturalWidth * s) / 2, oy = iy + (ih - img.naturalHeight * s) / 2
                      cut = {
                        x1: Math.max(0, ox + nb.x * img.naturalWidth * s),
                        y1: Math.max(0, oy + nb.y * img.naturalHeight * s),
                        x2: Math.min(a.w, ox + (nb.x + nb.w) * img.naturalWidth * s),
                        y2: Math.min(a.h, oy + (nb.y + nb.h) * img.naturalHeight * s),
                      }
                    }
                  }
                  const tighter = cut && cut.x2 - cut.x1 > 12 && cut.y2 - cut.y1 > 12
                    && (cut.x1 > 4 || cut.y1 > 4 || cut.x2 < a.w - 4 || cut.y2 < a.h - 4)
                  let rect = { x: a.x, y: a.y, w: a.w, h: a.h }
                  let cropped = null   // new artwork layout when auto-cropping
                  let snapped = false
                  if (tighter) {
                    // crop = shrink the frame to the bbox, keep the image absolutely still
                    // (same maths as the manual crop edges: shift ix/iy by the cut amount)
                    cropped = {
                      ...a,
                      x: Math.round(a.x + cut.x1), y: Math.round(a.y + cut.y1),
                      w: Math.round(cut.x2 - cut.x1), h: Math.round(cut.y2 - cut.y1),
                      ix: Math.round((a.ix ?? 0) - cut.x1), iy: Math.round((a.iy ?? 0) - cut.y1),
                      iw: a.iw ?? a.w, ih: a.ih ?? a.h,
                    }
                    rect = { x: cropped.x, y: cropped.y, w: cropped.w, h: cropped.h }
                    snapped = true
                    detectedBoxRef.current = null   // the frame IS the sign now — arrows hug the frame
                  } else if (cut) {
                    snapped = true                  // bbox found but it already fills the frame
                  }
                  const wv = parseFloat(p.w), hv = parseFloat(p.l)
                  let hLbl = p.w ? p.w + '"' : 'WIDTH'
                  let vLbl = p.l ? p.l + '"' : 'HEIGHT'
                  if (Number.isFinite(wv) && Number.isFinite(hv) && wv !== hv) {
                    const big = Math.max(wv, hv) + '"', small = Math.min(wv, hv) + '"'
                    const horizLonger = rect.w >= rect.h
                    hLbl = horizLonger ? big : small
                    vLbl = horizLonger ? small : big
                  }
                  // Always (re)snap position + length to the detected box — existing arrows used to
                  // be left untouched, which made the button a no-op on quotes with saved arrows
                  // ("bounding box is not coming"). A hand-typed label is kept. The auto-cropped
                  // artwork frame is committed in the SAME update so arrows + frame land together.
                  setLayout((L) => ({
                    ...L,
                    ...(cropped ? { artwork: cropped } : {}),
                    __dimsSeeded: true,
                    'dim-w': { vert: false, ...(L['dim-w'] || {}), x: rect.x, y: Math.max(2, rect.y - 16), len: rect.w, label: L['dim-w']?.label || hLbl },
                    'dim-h': { vert: true, ...(L['dim-h'] || {}), x: Math.max(2, rect.x - 18), y: rect.y, len: rect.h, label: L['dim-h']?.label || vLbl },
                  }))
                  flash(cropped ? 'Artwork auto-cropped to the sign — arrows match its dimensions.'
                    : snapped ? 'Arrows snapped to the sign’s bounding box.'
                    : 'Dimension arrows added — drag them into place.')
                }}
              >+ Dimensions</button>
              {/* #4 — add a row to the ITEM DESCRIPTION table (desc / qty / unit editable, totals auto) */}
              <button type="button" className="ghost" style={{ width: '100%', marginTop: 8 }}
                title="Add another line item to the item table (its qty × unit price feeds the subtotal)"
                onClick={addItem}>+ Line item</button>
            </div>

            {/* COLOURS — aligned to SPECIFICATIONS (where the COLOR SPECS live) */}
            <div ref={setGrp('cols')}>
              <div style={grpLabel}>Colours</div>
              <button type="button" className="ghost" style={{ width: '100%' }} onClick={addSwatch}>+ Add color swatch</button>
              <span className="muted" style={{ fontSize: 11, display: 'block', marginTop: 5 }}>Click a swatch to set its colour &amp; name; drag to place.</span>
            </div>

            {/* SPECIFICATIONS — aligned just under the SPECIFICATIONS header */}
            <div ref={setGrp('spec')}>
              <div style={grpLabel}>Specifications</div>
              <button
                type="button" className="ghost" style={{ width: '100%' }}
                title="Replace the SPECIFICATIONS text with a fresh version built from the current answers (use after changing specs on an older quote). Your other edits are kept."
                onClick={() => {
                  const el = document.querySelector('#proposal-print-root [data-key="specBody"]')
                  if (el) { el.innerHTML = sanitizeHtml(specHTML); queueSave(); flash('Spec text rebuilt from the current answers.') }
                }}
              >↻ Rebuild spec text</button>
              {hideNotes && (
                <button type="button" className="ghost" style={{ width: '100%', marginTop: 8 }}
                  title="Bring the Additional Notes section back" onClick={() => setHideNotes(false)}>+ Notes</button>
              )}
            </div>

            {/* SIDE VIEW — aligned to the SIDE VIEW section */}
            {onSideViews && (
              <div ref={setGrp('sv')}>
                <div style={grpLabel}>Side view</div>
                <button type="button" className="ghost" style={{ width: '100%' }} onClick={() => setPickingSV((v) => !v)}>{pickingSV ? 'Done choosing side views' : '+ Choose side views'}</button>
              </div>
            )}
          </div>
        )
      })()}

      {/* actions — downloads live ONCE, on the last page (#: single set of downloads per quote).
          The toast still shows per page (each part can flash its own save). */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
        {isLast && exportBlocked && <span style={{ color: '#e5484d', fontWeight: 600, fontSize: 13 }}>🔒 Locked — price approval needed before this quote can be sent out</span>}
        {isLast && <button className="ghost" style={{ width: '100%' }} disabled={busy || exportBlocked} title={exportBlocked ? 'Price approval required' : undefined} onClick={downloadPNG}>{busy === 'png' ? 'Rendering…' : '⬇ PNG image'}</button>}
        {isLast && <button style={{ width: '100%' }} disabled={busy || exportBlocked} title={exportBlocked ? 'Price approval required' : undefined} onClick={downloadPDF}>{busy === 'pdf' ? 'Building PDF…' : '⬇ Download PDF'}</button>}
        {toast && <span style={{ color: '#2e7d32', fontWeight: 600 }}>{toast}</span>}
      </div>

      {/* Shopify payment link — only on the last page (one combined link per quote) */}
      {isLast && canCreatePaymentLinks && quoteId && (
        <div style={{ marginTop: 18, padding: 14, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--navy-900)' }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>💳 Shopify payment link</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* all three payment options: same prominent style AND same full width (#6/#8) */}
            <button style={{ width: '100%' }} disabled={!!plBusy || exportBlocked} onClick={() => createPaymentLink('full')}>{plBusy === 'full' ? 'Creating…' : 'Full payment'}</button>
            {totalsAmount > 500 && <button style={{ width: '100%' }} disabled={!!plBusy || exportBlocked} onClick={() => createPaymentLink('deposit')}>{plBusy === 'deposit' ? 'Creating…' : '50% deposit'}</button>}
            {totalsAmount > 500 && <button style={{ width: '100%' }} disabled={!!plBusy || exportBlocked} onClick={() => createPaymentLink('balance')}>{plBusy === 'balance' ? 'Creating…' : 'Remaining Balance (50%)'}</button>}
            {totalsAmount > 0 && totalsAmount <= 500 && <span className="muted" style={{ fontSize: 12 }}>≤ $500 → full payment only</span>}
          </div>
          {plResult && (
            <div style={{ marginTop: 10, fontSize: 13 }}>
              Link ({plResult.kind}): <a href={plResult.url} target="_blank" rel="noreferrer">{plResult.url}</a>{' '}
              <button className="ghost sm" onClick={() => { navigator.clipboard?.writeText(plResult.url); flash('Link copied') }}>Copy</button>
              <div className="muted" style={{ fontSize: 11, marginTop: 5 }}>Newly-created products can take up to ~1 minute to go live on the store — if it looks slow at first, give it a moment before sending to the customer.</div>
            </div>
          )}
          <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>Creates the product in Shopify with a clean image (no price block) and records it under Payment Links.</div>
        </div>
      )}
      </div>
      )}
      </div>{/* /proposal-layout */}

      {/* side-view picker GRID — opens full-width below the preview when toggled from the right column */}
      {onSideViews && mainView && pickingSV && (
        <div style={{ margin: '12px 0' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 10 }}>
              <input
                placeholder="Search side views… (e.g. raceway, monument)"
                value={svSearch}
                onChange={(e) => setSvSearch(e.target.value)}
                style={{ width: '100%', maxWidth: 340 }}
              />
              {/* explicit no-side-view: clears every pick and removes the section + headline */}
              <label style={{ width: 120, fontSize: 11, textAlign: 'center', cursor: 'pointer', border: sideViews.includes('__none__') ? '2px solid #f5a623' : '1px dashed #999', borderRadius: 6, padding: 4, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 96, color: 'var(--text-dim, #888)' }}>
                <input type="checkbox" checked={sideViews.includes('__none__')}
                  onChange={(e) => onSideViews(e.target.checked ? ['__none__'] : [])} />
                <span style={{ fontSize: 20, lineHeight: 1.4 }}>🚫</span>
                <span>No side view<br />(hides the section)</span>
              </label>
              {/* two-level picker (#3): MAIN sign types first, click one → its side views, with a
                  back button. Searching skips straight to matching cards across all groups. */}
              {(() => {
                const cards = [
                  ...SIDE_VIEWS.map((sv) => ({ key: sv.key, label: sv.label, src: `/side_views/${sv.key}.png` })),
                  ...svLib.filter((it) => it.data?.path).map((it) => ({ key: it.data.path, label: it.name, src: svSrc(it.data.path) })),
                ]
                const groups = new Map()
                cards.forEach((c) => {
                  const g = svGroupOf(c.label)
                  if (!groups.has(g)) groups.set(g, [])
                  groups.get(g).push(c)
                })
                const searching = !!svSearch.trim()
                const CardGrid = ({ list }) => (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                    {list.map((c) => {
                      const on = sideViews.includes(c.key)
                      return (
                        <label key={c.key} style={{ width: 120, fontSize: 10, textAlign: 'center', cursor: 'pointer', border: on ? '2px solid #f5a623' : '1px solid #ccc', borderRadius: 6, padding: 4 }}>
                          <input type="checkbox" checked={on} onChange={(e) => onSideViews(e.target.checked ? [...sideViews.filter((x) => x !== '__none__'), c.key] : sideViews.filter((x) => x !== c.key))} />
                          <img src={c.src} alt={c.label} style={{ width: '100%', height: 70, objectFit: 'contain' }} />
                          <div>{c.label}</div>
                        </label>
                      )
                    })}
                  </div>
                )
                if (searching) {
                  const hits = cards.filter((c) => String(c.label).toUpperCase().includes(svSearch.trim().toUpperCase()))
                  return hits.length
                    ? <div style={{ width: '100%' }}><CardGrid list={hits} /></div>
                    : <div className="muted" style={{ fontSize: 12, width: '100%' }}>No side views match “{svSearch}”.</div>
                }
                if (!svGroup || !groups.has(svGroup)) {
                  return (
                    <div style={{ width: '100%', display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                      {SV_GROUP_ORDER.filter((g) => groups.has(g)).map((g) => (
                        <button key={g} type="button" className="ghost" onClick={() => setSvGroup(g)}
                          style={{ minWidth: 180, textAlign: 'left' }}>
                          <b>{g}</b> <span className="muted">· {groups.get(g).length} →</span>
                        </button>
                      ))}
                    </div>
                  )
                }
                return (
                  <div style={{ width: '100%' }}>
                    <button type="button" className="ghost sm" style={{ marginBottom: 8 }} onClick={() => setSvGroup(null)}>← Main sign types</button>
                    <div style={{ fontSize: 12, fontWeight: 700, margin: '2px 0 6px', color: 'var(--text-dim, #777)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{svGroup} ({groups.get(svGroup).length})</div>
                    <CardGrid list={groups.get(svGroup)} />
                  </div>
                )
              })()}
              {/* one-off uploads on this quote that aren't in the library */}
              {sideViews.filter((k) => !SIDE_VIEWS.some((s) => s.key === k) && !svLib.some((it) => it.data?.path === k)).map((k) => (
                <label key={k} style={{ width: 120, fontSize: 10, textAlign: 'center', cursor: 'pointer', border: '2px solid #f5a623', borderRadius: 6, padding: 4 }}>
                  <input type="checkbox" checked onChange={() => onSideViews(sideViews.filter((x) => x !== k))} />
                  <img src={svSrc(k)} alt="uploaded side view" style={{ width: '100%', height: 70, objectFit: 'contain' }} />
                  <div>YOUR UPLOAD</div>
                </label>
              ))}
              <label style={{ width: 120, fontSize: 11, textAlign: 'center', cursor: 'pointer', border: '1px dashed #999', borderRadius: 6, padding: 4, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 96, color: 'var(--text-dim, #888)' }}>
                <input
                  type="file" accept="image/*" style={{ display: 'none' }}
                  onChange={async (e) => {
                    const f = e.target.files?.[0]
                    if (!f || !info?.quoteId) return
                    e.target.value = ''
                    // name it (e.g. the sign type) so it's findable on every future quote
                    const suggested = (tpl?.n || f.name.replace(/\.[^.]+$/, '')).toUpperCase()
                    const title = (window.prompt('Name this side view so the whole team can reuse it:', suggested) || '').trim()
                    try {
                      const path = await uploadExtraFile(info.quoteId, f)
                      onSideViews([...sideViews.filter((x) => x !== '__none__'), path])
                      if (title) {
                        await saveCatalogItem('side_view', title, { path })
                        setSvLib((l) => [...l.filter((x) => x.name !== title.toUpperCase()), { id: 'new' + Date.now(), name: title.toUpperCase(), data: { path } }])
                        flash(`Saved to the library as “${title.toUpperCase()}”.`)
                      } else {
                        flash('Side view added to this quote only (no name given).')
                      }
                    } catch { flash('Upload failed — try again.') }
                  }}
                />
                <span style={{ fontSize: 22, lineHeight: 1 }}>⬆</span>
                <span>Upload your own</span>
              </label>
            </div>
        </div>
      )}

    </div>
  )
}

export default forwardRef(Proposal)
