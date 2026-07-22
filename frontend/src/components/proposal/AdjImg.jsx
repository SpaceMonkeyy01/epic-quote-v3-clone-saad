import { useEffect, useRef, useState } from 'react'
import { detectSubjectBox } from './util'

// Canva-style adjustable image. Click to select, then:
//  • drag the body to move, the top grip to rotate
//  • CORNER circles resize (scale the image)
//  • EDGE bars crop (shrink the visible window; the image itself stays put and is clipped)
// Absolute-positioned, so changing one never reflows the page. Geometry (incl. the crop window
// ix/iy/iw/ih) is reported up via onLay; selection chrome carries "adj-ui" so PDF capture hides it.
export default function AdjImg({ rk, def, lay, onLay, src, alt, lockAspect, cors, scaleRef, selected, onSelect, liveLay, fitCenterH, reserveCaption = true, autoCrop, bounds }) {
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
  // The aspect-fit-on-load below must run AT MOST ONCE per mount (it's for a fresh, never-laid-out
  // image). It used to gate on `!lay`, but `lay` reads the PARENT's layout state — a re-render that
  // catches this component between the parent's setLayout and the next paint (or a cached image
  // firing onLoad again on some browsers) sees `lay` as stale/undefined and re-fits from scratch,
  // silently discarding whatever crop the rep had just dragged (the "edges resize instead of crop"
  // bug: visually indistinguishable from a resize because it re-derives box.w/h from the image's
  // natural aspect ratio). A ref survives across renders without re-triggering effects, so once it's
  // fit, it's fit for good — external geometry updates still flow through the `lay` useEffect above.
  const autoFitDoneRef = useRef(!!lay)
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
  // bigger + longer than the corner dots, and pulled further from them, so a real mouse can't
  // grab the wrong one by accident (they used to sit close enough that a corner-resize kept
  // firing when the rep meant to grab the edge to crop).
  const bar = { position: 'absolute', background: '#fff', border: '1.5px solid #8b5cf6', borderRadius: 3, zIndex: 61 }
  const edges = {
    l: { left: -5, top: '50%', marginTop: -16, width: 9, height: 32, cursor: 'ew-resize' },
    r: { right: -5, top: '50%', marginTop: -16, width: 9, height: 32, cursor: 'ew-resize' },
    t: { top: -5, left: '50%', marginLeft: -16, width: 32, height: 9, cursor: 'ns-resize' },
    b: { bottom: -5, left: '50%', marginLeft: -16, width: 32, height: 9, cursor: 'ns-resize' },
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
              if (lockAspect && !autoFitDoneRef.current) {
                autoFitDoneRef.current = true
                const r = img.naturalWidth / img.naturalHeight
                if (r > 0) {
                  // fitCenterH tiles (package includes / side view): fill the slot's AREA, not just
                  // its width — size to the available height first, then fall back to width if that
                  // would overflow the slot (landscape icons were sizing to slot-width and landing
                  // far short of slot-height, leaving the icon floating in empty space).
                  let w = box.w, h = Math.max(20, Math.round(box.w / r))
                  if (fitCenterH) {
                    const availH = Math.max(20, fitCenterH - (reserveCaption ? 14 : 0))
                    const wFromH = Math.round(availH * r)
                    if (wFromH <= box.w) { w = wFromH; h = availH }
                  }
                  const y = fitCenterH ? Math.max(2, Math.round((fitCenterH - h - (reserveCaption ? 14 : 0)) / 2)) : box.y
                  let fitted = { ...box, w, h, y, ix: 0, iy: 0, iw: w, ih: h }
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
                      const hasMargin = bw > 12 && bh > 12 && (bx > 4 || by > 4 || bx + bw < fitted.w - 4 || by + bh < fitted.h - 4)
                      if (hasMargin && fitCenterH) {
                        // fitCenterH tiles (package includes icons): the source glyph often sits on a
                        // large transparent canvas — just shrinking the FRAME to the glyph's tiny pixel
                        // size (the plain-artwork behavior below) would make it look even smaller in
                        // its slot. Instead re-derive the frame at the CROPPED aspect ratio and refill
                        // the same slot, so the glyph itself grows to occupy the tile.
                        const r2 = (nb.w * img.naturalWidth) / (nb.h * img.naturalHeight)
                        if (r2 > 0) {
                          const availH = Math.max(20, fitCenterH - (reserveCaption ? 14 : 0))
                          let w2 = box.w, h2 = Math.max(20, Math.round(box.w / r2))
                          const wFromH2 = Math.round(availH * r2)
                          if (wFromH2 <= box.w) { w2 = wFromH2; h2 = availH }
                          const y2 = Math.max(2, Math.round((fitCenterH - h2 - (reserveCaption ? 14 : 0)) / 2))
                          fitted = fitBounds({ ...fitted, w: w2, h: h2, y: y2, ix: 0, iy: 0, iw: w2, ih: h2 })
                        }
                      } else if (hasMargin) {
                        fitted = fitBounds({
                          ...fitted,
                          x: Math.round(fitted.x + bx), y: Math.round(fitted.y + by),
                          w: Math.round(bw), h: Math.round(bh),
                          ix: -Math.round(bx), iy: -Math.round(by), iw: fitted.w, ih: fitted.h,
                        })
                      }
                    }
                  }
                  // centre the fitted frame inside its bounds — ONLY for a single free image (the
                  // artwork). Package tiles / side views use fitCenterH and have deliberate spread
                  // x positions; centring them stacked every tile at the same x (alignment bug).
                  if (bounds && !fitCenterH) {
                    fitted = { ...fitted, x: Math.round((bounds.w - fitted.w) / 2), y: Math.round((bounds.h - fitted.h) / 2) }
                  }
                  setBox(fitted); onLay(fitted)
                }
              }
            }, 0)
          }}
          // maxWidth:'none' — Tailwind preflight sets img{max-width:100%}, which caps this img at
          // the FRAME's width. Cropping l/r shrinks the frame → the cap rescales the whole bitmap
          // instead of letting it overflow into the clip → "left/right bars resize instead of crop".
          // Vertical was unaffected (no max-height in preflight), which is why t/b always worked.
          style={{ position: 'absolute', left: box.ix, top: box.iy, width: box.iw, height: box.ih, maxWidth: 'none', objectFit: 'contain', display: broken ? 'none' : 'block', pointerEvents: 'none' }} />
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
