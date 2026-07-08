import { useRef, useState } from 'react'

/* Big-canvas artwork crop editor (#5). The preview page can crop too, but its canvas is small
   and fiddly; here — where the wizard's image is shown large — the rep gets a roomy crop box
   with four corner handles + drag-to-move, then "Apply crop" re-uploads just the selection.
   Crop rectangle is kept as fractions (0..1) of the displayed image, so it maps cleanly onto
   the natural-resolution pixels when we cut the final JPEG. */
export default function ArtworkCropper({ src, onApply, onCancel, onMark, busy, initialBox }) {
  const imgRef = useRef(null)
  const wrapRef = useRef(null)
  // box in fractions of the image: {x, y, w, h}
  const [box, setBox] = useState(initialBox && Number.isFinite(initialBox.w) ? initialBox : { x: 0.08, y: 0.08, w: 0.84, h: 0.84 })

  // pointer helpers — convert a client point to a 0..1 fraction inside the image
  const frac = (clientX, clientY) => {
    const r = imgRef.current.getBoundingClientRect()
    return {
      x: Math.min(1, Math.max(0, (clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (clientY - r.top) / r.height)),
    }
  }

  const startMove = (e) => {
    e.preventDefault(); e.stopPropagation()
    const s = frac(e.clientX, e.clientY); const b0 = box
    const move = (ev) => {
      const p = frac(ev.clientX, ev.clientY)
      let nx = b0.x + (p.x - s.x), ny = b0.y + (p.y - s.y)
      nx = Math.min(Math.max(0, nx), 1 - b0.w); ny = Math.min(Math.max(0, ny), 1 - b0.h)
      setBox((b) => ({ ...b, x: nx, y: ny }))
    }
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up) }
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up)
  }

  // corner: 'nw' | 'ne' | 'sw' | 'se' — resize keeping the opposite corner anchored
  const startCorner = (corner) => (e) => {
    e.preventDefault(); e.stopPropagation()
    const move = (ev) => {
      const p = frac(ev.clientX, ev.clientY)
      setBox((b) => {
        let { x, y, w, h } = b
        const right = x + w, bottom = y + h
        const MIN = 0.05
        if (corner.includes('w')) { const nx = Math.min(p.x, right - MIN); w = right - nx; x = nx }
        if (corner.includes('e')) { w = Math.max(MIN, Math.min(p.x, 1) - x) }
        if (corner.includes('n')) { const ny = Math.min(p.y, bottom - MIN); h = bottom - ny; y = ny }
        if (corner.includes('s')) { h = Math.max(MIN, Math.min(p.y, 1) - y) }
        return { x, y, w, h }
      })
    }
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up) }
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up)
  }

  const apply = async () => {
    const img = imgRef.current
    const nw = img.naturalWidth, nh = img.naturalHeight
    const sx = Math.round(box.x * nw), sy = Math.round(box.y * nh)
    const sw = Math.max(1, Math.round(box.w * nw)), sh = Math.max(1, Math.round(box.h * nh))
    const c = document.createElement('canvas')
    c.width = sw; c.height = sh
    const ctx = c.getContext('2d')
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, sw, sh)
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh)
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.92))
    if (blob) onApply(new File([blob], 'artwork-cropped.jpg', { type: 'image/jpeg' }))
  }

  const handle = { position: 'absolute', width: 14, height: 14, background: '#fff', border: '2px solid var(--gold, #f5a623)', borderRadius: 3, zIndex: 3 }
  return (
    <div style={{ maxWidth: 640 }}>
      <div ref={wrapRef} style={{ position: 'relative', display: 'inline-block', userSelect: 'none', lineHeight: 0 }}>
        <img ref={imgRef} src={src} alt="crop" crossOrigin="anonymous" draggable={false}
          style={{ maxWidth: '100%', display: 'block', borderRadius: 8 }} />
        {/* dim the area outside the crop with a big box-shadow trick on the selection */}
        <div onMouseDown={startMove}
          style={{ position: 'absolute', left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%`,
            border: '1.5px solid var(--gold, #f5a623)', boxShadow: '0 0 0 9999px rgba(0,0,0,0.5)', cursor: 'move', zIndex: 2 }}>
          <span style={{ ...handle, left: -7, top: -7, cursor: 'nwse-resize' }} onMouseDown={startCorner('nw')} />
          <span style={{ ...handle, right: -7, top: -7, cursor: 'nesw-resize' }} onMouseDown={startCorner('ne')} />
          <span style={{ ...handle, left: -7, bottom: -7, cursor: 'nesw-resize' }} onMouseDown={startCorner('sw')} />
          <span style={{ ...handle, right: -7, bottom: -7, cursor: 'nwse-resize' }} onMouseDown={startCorner('se')} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
        <button type="button" disabled={busy} onClick={apply}>{busy ? 'Applying…' : '✂ Crop to this box'}</button>
        {/* non-destructive: keep the full artwork but record this box as the sign's extent, so the
            proposal's dimension arrows snap to the real sign edges (precise measurements). */}
        {onMark && <button type="button" className="ghost" onClick={() => onMark(box)} title="Keep the whole artwork; mark this box as the sign for measurement arrows">📐 Use as measurement box</button>}
        <button type="button" className="ghost" onClick={() => setBox({ x: 0.08, y: 0.08, w: 0.84, h: 0.84 })}>Reset box</button>
        <button type="button" className="ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}
