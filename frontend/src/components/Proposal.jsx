import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'
import { buildSpecLines, money, esc } from '../generator/proposal'
import { parseDims } from '../generator/questions'
import { itemSigned } from '../generator/parts'
import { sanitizeHtml } from '../utils/sanitizeHtml'
import client, { fileUrl } from '../api/client'
import { attachCheckpointImage } from '../api/quotes'
import { listCatalog } from '../api/catalog'
import AdjImg from './proposal/AdjImg'
import AdjDim from './proposal/AdjDim'
import AdjSwatch from './proposal/AdjSwatch'
import EBlock from './proposal/EBlock'
import EditCell from './proposal/EditCell'
import { HEAD, LOUPE, SRC, detectSubjectBox } from './proposal/util'
import SideViewPicker from './proposal/SideViewPicker'
import ArtworkCropper from './ArtworkCropper'

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

const cell = { fontSize: 11, border: '1px solid #777', padding: '6px 8px', outline: 'none' }
const headCell = { ...cell, background: HEAD, fontWeight: 700, borderTop: 'none' }
// Section header bar inside the single-framed specs/package box — border only on the bottom; the outer
// box + the left column's right edge supply the frame, so the divider stays one continuous line.
const secHead = { background: HEAD, fontWeight: 700, fontSize: 11, padding: '5px 8px', borderBottom: '1px solid #777' }
// PACKAGE INCLUDES is a SET — the rep picks ONE of the four standard packages the sheet
// assigns per sign type (Package Includes column = A/B/C/D):
//  • A: Installation Template + Power Supply      • C: Adaptor + Dimmer + Mounting Kit
//  • B: Installation Template                     • D: Adaptor + Dimmer + Hanging Chain
// `baked:1` — each artwork ALREADY has its item labels drawn in, so we render the image on
// its own and skip the text captions underneath (they'd duplicate the artwork).
const PACKAGE_SETS = {
  A: { label: 'A · Installation Template + Power Supply', baked: 1, items: [{ label: 'PACKAGE A', img: '/package/A.png' }] },
  B: { label: 'B · Installation Template',                baked: 1, items: [{ label: 'PACKAGE B', img: '/package/B.png' }] },
  C: { label: 'C · Adaptor + Dimmer + Mounting Kit',      baked: 1, items: [{ label: 'PACKAGE C', img: '/package/C.png' }] },
  D: { label: 'D · Adaptor + Dimmer + Hanging Chain',     baked: 1, items: [{ label: 'PACKAGE D', img: '/package/D.png' }] },
}
// Quotes saved before the A–D sets stored the old two-set keys — map them onto the closest
// letter so every existing proposal still renders (standard == A's contents; hardware ≈ C).
const PKG_ALIAS = { standard: 'A', hardware: 'C' }
const resolvePkgSet = (k) => (k && PACKAGE_SETS[k] ? k : (k && PACKAGE_SETS[PKG_ALIAS[k]] ? PKG_ALIAS[k] : null))
// tile width so a set fits the 240px column (1 wide image, or 2 squares).
const pkgTileW = (n) => Math.max(56, Math.min(150, Math.floor((240 - (n + 1) * 10) / n)))
const pkgDefX = (i, n, w) => Math.round(((240 - n * w) / (n + 1)) * (i + 1) + w * i)

const HD_SCALE = 3   // html2canvas DPI factor for PNG/PDF downloads (~288dpi on a Letter page — crisp text)

function Proposal({ mode, tpl, answers, customSpec, info, artworkPath, onArtworkFile, logo, savedState, onSave, aiResult, paymentLink, proposalNotes, sideViews = [], onSideViews, approval, quoteId, canCreatePaymentLinks, onPaymentLinkCreated, mainView, signBox,
  // --- multi-page (multi-sign) quote props ---
  // partLabel: 'A'/'B'/… shown after the PROPOSAL ID, or null for a single-sign quote.
  // multi: this quote has >1 part → per-part prices are hidden (Sami's rule: the customer only
  //        ever sees the combined total, on the last page).
  // isLast: this is the last page → it alone carries the totals block, downloads and payment.
  // quoteTotal: the whole quote's grand total (Σ parts); the totals block shows THIS, not the
  //        part's own amount. null for single-sign (falls back to this proposal's own total).
  // collectImages: async () => [dataURL,…] — supplied by the parent on the LAST page so a payment
  //   link carries one clean image PER sign (all pages), not just this one. null → this page only.
  // linkTitle: combined "A & B FOR Company" title for a multi-sign payment link. null → default.
  // captureAll: async () => dataURL of the WHOLE stacked multi-page proposal (for the version image).
  // capturePages: async () => [{url,w,h},…] — every sign page at HD, supplied by the parent on the
  //   LAST page so Download PDF (one page per sign) / PNG (stitched) cover the whole quote.
  // readOnly: rendered inside the All Quotes "View" modal — the doc is shown, not edited (the
  //   wrapper already kills pointer events). We use it only to hide the "click any text to edit"
  //   hint, which is a lie in that context. Editing still happens in the Generator wizard.
  partLabel = null, multi = false, isLast = true, quoteTotal = null, collectImages = null, linkTitle = null, captureAll = null, capturePages = null, readOnly = false,
  pageActions = null }, fwdRef) {
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
  const [svAnchor, setSvAnchor] = useState({ left: 0, top: 0 })   // #9 — picker panel anchor (right of the button)
  useEffect(() => {
    if (!pickingSV) return
    listCatalog('side_view').then(setSvLib).catch(() => {})
  }, [pickingSV])
  const [selId, setSelId] = useState(null)                          // selected adjustable image
  // persisted geometry per image — package/side-view tiles are dropped from the seed: they're
  // algorithmically laid out from the CURRENT set/count on every load (pkgDefX/fitCenterH/autoCrop),
  // never hand-tuned per tile, so an old saved entry here is always just a STALE snapshot of
  // whatever the fit logic used to compute — freezing it means every improvement to that logic
  // (bigger tiles, tighter autoCrop) is invisible on any quote that already has one saved. Re-deriving
  // fresh on every load is strictly better than permanently pinning last session's numbers.
  const [layout, setLayout] = useState(() => {
    const L = { ...(savedState?.__layout || {}) }
    Object.keys(L).forEach((k) => { if (k.startsWith('pkg-') || k.startsWith('sv2-')) delete L[k] })
    return L
  })
  // The artwork's saved frame is only valid for the FILE it was fit to. When the rep replaces
  // the artwork (re-upload), the old frame's aspect/crop window is meaningless for the new image
  // and, worse, its presence as `lay` tells AdjImg "already auto-fit" — silently skipping the
  // auto-crop-to-bounding-box pass a fresh upload is supposed to get. Drop it so the new image
  // re-fits and re-crops from scratch (matches the AdjImg key={artworkPath} remount above).
  const firstArtworkPath = useRef(artworkPath)
  useEffect(() => {
    if (artworkPath === firstArtworkPath.current) return
    firstArtworkPath.current = artworkPath
    setLayout((L) => { const n = { ...L }; delete n.artwork; return n })
  }, [artworkPath])
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
      { id: 'face', name: 'BLACK', color: '#000000', x: 100, y: 690, w: SW_W, h: SW_H },
      { id: 'rettrim', name: 'WHITE', color: '#ffffff', x: 300, y: 712, w: SW_W, h: SW_H },
    ]
  })
  // Add a chip to the RIGHT of the existing ones, on the same row (auto-aligned).
  // With no existing chips (custom mode has no seeded colour lines), start inside the
  // SPECIFICATIONS block instead of floating over the item table.
  // The SPECIFICATIONS column bounds (page coords) — swatches belong here and must never leave it.
  const specAreaRect = () => {
    const page = pageRef.current
    const spec = page?.querySelector('[data-key="specBody"]')?.parentElement   // the left column
    if (!page || !spec) return null
    const sc = scaleRef.current || 1
    const pr = page.getBoundingClientRect()
    const r = spec.getBoundingClientRect()
    return { x: (r.left - pr.left) / sc, y: (r.top - pr.top) / sc, w: r.width / sc, h: r.height / sc }
  }
  // Keep a swatch fully inside its area (the SPECIFICATIONS column) — can't be dragged/pushed out.
  const clampToArea = (sw) => {
    const a = specAreaRect(); if (!a) return sw
    const x = Math.min(Math.max(a.x + 2, sw.x), Math.max(a.x + 2, a.x + a.w - sw.w - 2))
    const y = Math.min(Math.max(a.y + 2, sw.y), Math.max(a.y + 2, a.y + a.h - sw.h - 2))
    return { ...sw, x: Math.round(x), y: Math.round(y) }
  }
  // Visible TEXT glyph runs (spec lines, item description, notes) in unscaled page coords —
  // chips must not cover them. Exact Range rects, zero padding: sitting flush against a line
  // is fine, covering its letters is not. Measured on demand at drop/add time.
  const textObstacles = () => {
    const page = pageRef.current; if (!page) return []
    const sc = scaleRef.current || 1
    const pr = page.getBoundingClientRect()
    const rects = []
    page.querySelectorAll('[data-key="specBody"], [data-key="itemDesc"], [data-key="notes"]').forEach((el) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      let n
      while ((n = walker.nextNode())) {
        if (!n.textContent.trim()) continue
        const rng = document.createRange(); rng.selectNodeContents(n)
        for (const r of rng.getClientRects()) {
          if (r.width < 4 || r.height < 4) continue
          rects.push({ x: (r.left - pr.left) / sc, y: (r.top - pr.top) / sc, w: r.width / sc, h: r.height / sc })
        }
      }
    })
    return rects
  }
  // Colour chips must NEVER overlap another chip OR proposal text, and must stay inside their area:
  // resolved by the smallest flush shift in any direction (see below).
  const resolveOverlap = (arr, id) => {
    const me = arr.find((s) => s.id === id); if (!me) return arr
    // Obstacles = other VISIBLE chips + text glyph rects, all at exact pixels, zero margin.
    // Ghost chips must not block: 'rettrim' stays in the array while render-hidden (combined
    // "FACE & RETURN COLOR" line → hideRet), and an emptied hand-chip without keep can linger
    // too — colliding with an invisible chip reads as "I can't place a swatch on this empty
    // spot" (the deleted-swatch's-place bug).
    const visible = (s) => !(s.id === 'rettrim' && hideRet) && (s.id === 'face' || s.id === 'rettrim' || s.color || s.name || s.keep)
    const obstacles = [...arr.filter((s) => s.id !== id && visible(s)), ...textObstacles().map((r) => ({ ...r, text: true }))]
    // Push-right-only used to fail at the column's right edge: the nudge went right, then
    // clampToArea dragged the chip straight BACK onto its neighbour — visible chip-on-chip
    // overlap. Resolve with the SMALLEST shift in any direction instead (flush right, left,
    // below or above the clashing chip), considering only in-bounds candidates, so the clamp
    // can never undo the separation.
    const area = specAreaRect()
    const inArea = (p) => !area || (p.x >= area.x + 2 && p.y >= area.y + 2 && p.x + me.w <= area.x + area.w - 2 && p.y + me.h <= area.y + area.h - 2)
    // Chips vs chips: exact-rect, zero tolerance. Chips vs TEXT: tolerant of GRAZING — the line
    // pitch (~20px at 10.5px × 1.9) equals the chip height, so a chip sat inline next to a label
    // unavoidably clips the neighbouring rows' glyph boxes by a few px; blocking that made "put
    // the chip right after COLOR SPECS:" impossible (it fled upward). Real coverage — the chip
    // actually sitting ON a line's letters — still collides: that needs >6px of vertical bite
    // (glyph boxes are 8–12px tall) and >4px horizontally.
    const collide = (p) => obstacles.find((o) => {
      const dx = Math.min(p.x + me.w, o.x + o.w) - Math.max(p.x, o.x)
      const dy = Math.min(p.y + me.h, o.y + o.h) - Math.max(p.y, o.y)
      return o.text ? (dx > 4 && dy > 6) : (dx > 0 && dy > 0)
    })
    // Clamp into the column BEFORE resolving. Clamping after was the overlap bug: a chip spawned
    // past the right edge collides with nothing out there, the loop exits clean, and only THEN
    // did the clamp drag it left — straight onto the chips it was never checked against.
    const start = clampToArea({ ...me })
    let pos = { x: start.x, y: start.y }, guard = 0
    while (guard++ < 24) {
      const c = collide(pos)
      if (!c) break
      const cands = [
        { x: Math.round(c.x + c.w), y: pos.y },    // flush right of the clash (0 gap)
        { x: Math.round(c.x - me.w), y: pos.y },   // flush left
        { x: pos.x, y: Math.round(c.y + c.h) },    // flush below
        { x: pos.x, y: Math.round(c.y - me.h) },   // flush above
      ].filter(inArea)
      const free = cands.filter((p) => !collide(p))
      const pool = free.length ? free : cands
      if (!pool.length) break                       // column completely packed — leave as dropped
      const dist = (p) => Math.abs(p.x - me.x) + Math.abs(p.y - me.y)
      pos = pool.sort((p, q) => dist(p) - dist(q))[0]
    }
    // pos is already in-bounds (start was clamped; candidates are inArea-filtered) — no re-clamp,
    // it could only undo the separation again.
    return (pos.x === me.x && pos.y === me.y) ? arr : arr.map((s) => (s.id === id ? { ...s, x: pos.x, y: pos.y } : s))
  }

  const ROW_BAND = 18   // same tolerance the uniform-resize reflow already groups rows by
  const addSwatch = () => {
    const id = 'sw' + Date.now()
    setSwatches((s) => {
      const row = s.find((x) => x.id === 'face') || s[0]
      // Auto-align to the SAME ROW the new chip is landing in, not the rightmost edge of ANY
      // row — with multiple rows, the old "max x across every chip" put a new chip's x from a
      // totally different row, so consecutive same-row chips drifted out of sync as more were
      // added. Only chips within ROW_BAND of the target y count toward the row's right edge.
      const rowMates = row ? s.filter((x) => Math.abs(x.y - row.y) <= ROW_BAND) : []
      const rightX = rowMates.reduce((m, x) => Math.max(m, x.x + x.w), row ? row.x : 96)
      // A new chip copies the CURRENT size of the reference chip, not the SW_W/SW_H defaults —
      // if the rep widened their swatches, the next one matches instead of snapping back to 96×20.
      const w = row?.w ?? SW_W, h = row?.h ?? SW_H
      // keep:true → a hand-added chip stays visible even while empty (it used to vanish on deselect)
      const next = [...s, { id, name: '', color: '', keep: true, x: row ? rightX + 16 : 96, y: row ? row.y : 640, w, h }]
      return resolveOverlap(next, id)
    })
    setSelId('swatch-' + id)
  }
  // After a drag/resize: a chip dropped ROUGHLY level with a neighbour (±8px) snaps onto its
  // exact row so side-by-side chips read as one aligned strip; anything further off is treated
  // as deliberate free placement and stays exactly where dropped. (The original ±18px band was
  // wide enough to catch "I placed it BELOW with a small gap" and teleport it — 8px only catches
  // genuine same-row intent, and the minimal-shift resolver settles any resulting contact flush.)
  const snapRow = (id) => setSwatches((arr) => {
    const me = arr.find((s) => s.id === id); if (!me) return arr
    const near = arr.find((s) => s.id !== id && s.y !== me.y && Math.abs(s.y - me.y) <= 8)
    const snapped = near ? arr.map((s) => (s.id === id ? { ...s, y: near.y } : s)) : arr
    return resolveOverlap(snapped, id)
  })
  // #7 — the ITEM DETAILS artwork area background, so a grey-background artwork can sit on a
  // matching grey instead of clashing white. Persisted with the proposal state.
  const [artBg, setArtBg] = useState(savedState?.__artBg || '#ffffff')
  const [cropOpen, setCropOpen] = useState(false)   // proposal-side crop modal (react-easy-crop)
  const [cropBusy, setCropBusy] = useState(false)
  const [hideNotes, setHideNotes] = useState(!!savedState?.__hideNotes)   // #6 — Additional Notes removable
  // The drag-to-resize handle (#9) is GONE: a fixed height + overflow:auto meant the PDF/PNG
  // export captured a scrolled box and silently cut off notes below the fold. Notes must always
  // render whole — the section simply grows with its content now.
  // #11 — chosen package set. Precedence: what the rep saved (old keys mapped via PKG_ALIAS)
  // > the letter this sign type is assigned in the sheet (tpl.pkg) > A.
  const [pkgSet, setPkgSet] = useState(resolvePkgSet(savedState?.__pkgSet) || resolvePkgSet(tpl?.pkg) || 'A')
  const [pkgPicking, setPkgPicking] = useState(false)   // #8 — image dropdown open
  const packageItems = PACKAGE_SETS[pkgSet].items
  // A-D are ONE pre-composed image (labels baked in) — it should fill the whole PACKAGE INCLUDES
  // box, not the small multi-icon tile width pkgTileW was sized for (that 150px cap left a single
  // big image floating tiny in the box). pkgTileW stays available for a future multi-icon set.
  const pkgW = packageItems.length === 1 ? 234 : pkgTileW(packageItems.length)
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

  // click anywhere outside an adjustable image/swatch deselects it (hides the handles + colour
  // popover). The same click also closes any open floating picker (side-view panel, package-set
  // dropdown) — they used to close ONLY by pressing their own toggle button again, a dead end once
  // that button scrolls out of view or the rep just clicks elsewhere expecting it to go away (#11).
  useEffect(() => {
    const onDown = (e) => {
      if (!e.target.closest('[data-rk]')) setSelId(null)
      if (!e.target.closest('[data-sv-picker]')) setPickingSV(false)
      if (!e.target.closest('[data-pkg-picker]')) setPkgPicking(false)
    }
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
  const sideViewsRef = useRef(sideViews); sideViewsRef.current = sideViews
  useEffect(() => {
    const h = histRef.current
    if (h.silent) { h.silent = false; return }
    h.stack = h.stack.slice(0, h.idx + 1)
    h.stack.push({ layout, swatches })
    if (h.stack.length > 80) h.stack.shift()
    h.idx = h.stack.length - 1
  }, [layout, swatches])
  // shared by the Ctrl+Z/Y shortcuts AND the visible ↶/↷ buttons (#7)
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
  useEffect(() => {
    if (!mainView) return
    const onKey = (e) => {
      // while typing in any text field/block, the browser's own shortcuts must win
      if (e.target?.closest?.('[contenteditable], input, textarea, select')) return
      // Delete/Backspace on a SELECTED side-view tile removes it from the quote — the only
      // other way was reopening the picker and unticking it. Scoped to side-view tiles only
      // (rk `sv2-<key>`); other adjustables (artwork, swatches, package tiles) already have
      // their own explicit remove controls and must not be affected by a stray Delete press.
      if ((e.key === 'Delete' || e.key === 'Backspace') && !(e.ctrlKey || e.metaKey)) {
        const id = selRef.current
        if (id?.startsWith('sv2-')) {
          e.preventDefault()
          const key = id.slice(4)
          const rest = sideViewsRef.current.filter((k) => k !== key)
          // Deleting the LAST tile must also remove the "SIDE VIEW" heading — an empty section
          // with just a headline and a "[ No side view selected ]" placeholder reads as broken,
          // not deleted. Empty rest → treat exactly like the picker's explicit "No side view".
          onSideViews && onSideViews(rest.length ? rest : ['__none__'])
          setSelId(null)
        }
        return
      }
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

  // ONE-PAGE CONFINEMENT: the page is a HARD 816×1056 (US Letter at 96dpi) — it cannot grow,
  // and anything past the bottom edge is clipped (overflow:hidden on the page div). What the
  // rep sees IS what exports and prints: exactly one sheet, always. The section sizes below
  // (artwork 170, side view 190, spec floors) are tuned so the standard layout fits with room
  // for a few note lines. When content still wants more than 1056px, it gets visibly cut at the
  // page edge AND this watcher raises the red banner telling the rep to trim.
  const PAGE_H = 1056
  const [overBy, setOverBy] = useState(0)   // px of content clipped past the page bottom (0 = fits)
  useEffect(() => {
    const el = pageRef.current
    if (!el) return
    // scrollHeight = what the content WANTS; offsetHeight is pinned at PAGE_H by the clamp
    const check = () => setOverBy(Math.max(0, el.scrollHeight - PAGE_H - 2))
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    const t = setInterval(check, 800)   // scrollHeight changes don't fire ResizeObserver (height is fixed)
    return () => { ro.disconnect(); clearInterval(t) }
  }, [])

  // Fit the fixed 816×1056 page to the FULL available column width — always as big as the
  // column allows. The old viewport-height cap ("whole sheet on screen, no scrolling") shrank
  // the page to an illegible thumbnail on shorter windows; legibility beats no-scroll, so the
  // cap is gone and the sheet simply scrolls when taller than the window.
  useEffect(() => {
    const fit = () => {
      if (!wrapRef.current || !pageRef.current) return
      const s = Math.min(1, wrapRef.current.clientWidth / 816)
      setScale(s)
      setScaledH(PAGE_H * s)
    }
    fit()
    const t = setTimeout(fit, 250) // refit after images/content settle
    window.addEventListener('resize', fit)
    // refit when the wrapper's own width changes (e.g. the controls column takes space beside it)
    const ro = wrapRef.current ? new ResizeObserver(fit) : null
    if (ro && wrapRef.current) ro.observe(wrapRef.current)
    return () => { clearTimeout(t); window.removeEventListener('resize', fit); ro?.disconnect() }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Template B (monument/pylon, free-form — no package or side view). In custom mode `tpl` is
  // always null (that flow only ever tracks customSpec, never sets tpl_name on save — see
  // Generator.jsx tplForPart), so the picker stamps customSpec.mono at pick time instead of
  // relying on tpl.mono, which can never be true here.
  const isMonoType = mode === 'custom' ? !!customSpec?.mono : !!tpl?.mono
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
  const grandTotal = Math.max(0, price * qty + items.reduce((s, it) => s + itemSigned(it), 0))
  // The figure the TOTALS block shows: the whole-quote sum on a multi-page quote, else this
  // proposal's own total. Deposits, the ≤$500 rule and payment all key off this.
  const totalsAmount = quoteTotal != null ? quoteTotal : grandTotal
  // Line items and discounts are Description + Amount only now (#6 — qty/unit price dropped,
  // they were never actually needed: a rep types the final dollar figure directly). `kind`
  // distinguishes the two: 'discount' subtracts in itemSigned() above instead of adding.
  const addItem = () => setItems((arr) => [...arr, { id: 'li' + Date.now(), desc: 'ADDITIONAL ITEM', amount: 0, kind: 'add' }])
  const addDiscount = () => setItems((arr) => [...arr, { id: 'li' + Date.now(), desc: 'DISCOUNT', amount: 0, kind: 'discount' }])
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
    // unitPrice must follow the wizard price too (bug: only totalPrice was re-synced here, so
    // changing the price on the specs step and coming back to preview left UNIT PRICE frozen at
    // whatever it showed at mount — TOTAL PRICE then showed qty × the NEW price, and the two
    // columns no longer multiplied out to the same number on screen).
    setBlock('unitPrice', money(price))
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
    // TRAILING-BLANK PURGE: hand-edited spec/notes blocks accumulate empty lines at their end
    // (Enter presses saved as <br>/<div><br></div>/&nbsp; runs) — invisible, but each one is a
    // full line of page height. On a fixed one-page sheet that waste is exactly the room the
    // rep needs for real note lines (found live: a quote carrying EIGHT saved blank spec lines
    // ≈ 134px — seven "missing" lines of the Canva standard). Trimming the END only: blank
    // lines BETWEEN content are deliberate spacing and stay.
    for (const k of ['specBody', 'notes']) {
      if (typeof merged[k] === 'string') {
        merged[k] = merged[k].replace(/(?:\s|&nbsp;|<br\s*\/?>|<div>(?:\s|&nbsp;|<br\s*\/?>)*<\/div>)+$/gi, '')
        if (k === 'notes' && merged[k] === '') merged[k] = '&nbsp;'
      }
    }
    return merged
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // editable block — content written once at mount (see EBlock) so React can NEVER clobber edits
  const E = (key, style, opts) => <EBlock key={key} k={key} html={initial[key]} style={style} noPaste={opts?.noPaste} noImagePaste={opts?.noImagePaste} readOnly={opts?.readOnly} />
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
    const state = { __layout: layout, __swatches: swatches.filter((s) => s.color || s.name), __dirty: [...dirtyRef.current], __specTpl: tpl?.n || null, __artBg: artBg, __qty: qty, __items: items, __hideNotes: hideNotes, __pkgSet: pkgSet }
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
  useEffect(() => { if (!mounted.current) { mounted.current = true; return } queueSave() }, [layout, swatches, artBg, hideNotes, pkgSet]) // eslint-disable-line react-hooks/exhaustive-deps
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

  // One-time load sanitize: chips SAVED while older overlap rules were live (or none at all)
  // render at their stored spots forever — resolveOverlap only ever ran on drag/add, so a quote
  // saved with a chip sitting on text keeps that overlap on every open ("still overlapping" on
  // server-side quotes). After the page settles (text measurable, anchors applied), run every
  // chip through the CURRENT resolver once; clean chips are untouched (resolver is a no-op).
  const sanitizedRef = useRef(false)
  useEffect(() => {
    if (sanitizedRef.current || !pageRef.current) return
    const t = setTimeout(() => {
      if (sanitizedRef.current) return
      sanitizedRef.current = true
      setSwatches((arr) => arr.reduce((a, s) => resolveOverlap(a, s.id), arr))
    }, 600)   // after the anchor pass + font layout settle
    return () => clearTimeout(t)
  }, [specHTML, scale]) // eslint-disable-line react-hooks/exhaustive-deps

  // The old "#6/#3" system that measured each proposal section's top and pulled its control
  // group down to sit IN FRONT of it is GONE: those computed margins were the big empty gaps
  // between buttons, and the controls must now read as one compact block visible in a single
  // glance with no scrolling (one-page confinement) — a plain tight stack does exactly that.

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
  // HD render of THIS page for download — dataURL + pixel dims (the parent gathers one per sign
  // to build the multi-page PDF / stitched PNG).
  const captureExport = async () => {
    const c = await render({ scale: HD_SCALE })
    return { url: c.toDataURL('image/png'), w: c.width, h: c.height }
  }
  useImperativeHandle(fwdRef, () => ({ captureCleanImage, captureSnapshot, captureExport }))

  // load a dataURL into an <img> (for stitching); resolves null on failure
  const loadImg = (src) => new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src })

  const downloadPNG = async () => {
    if (exportBlocked) { flash('🔒 Blocked — the price needs approval before this quote can go out'); return }
    setBusy('png')
    try {
      // one PNG file PER sign page (#4) — a multi-sign quote downloads several images, each a
      // single page; a single-sign quote downloads its one page.
      const pages = capturePages ? await capturePages() : [await captureExport()]
      const multiPages = pages.length > 1
      pages.forEach((p, i) => {
        const a = document.createElement('a')
        a.download = `${info.quoteId || 'quote'}${multiPages ? '-' + String.fromCharCode(65 + i) : ''}.png`
        a.href = p.url; a.click()
      })
      flash(multiPages ? `${pages.length} PNGs downloaded` : 'PNG downloaded')
    } catch (e) { flash('PNG failed: ' + e.message) } finally { setBusy('') }
  }

  // ---- Shopify payment link (S5) ----
  const [plBusy, setPlBusy] = useState('')
  const [plResult, setPlResult] = useState(null)   // { url, kind } on success
  const createPaymentLink = async (kind) => {
    if (exportBlocked) { flash('🔒 Blocked — the price needs approval first'); return }
    // gate on the WHOLE-quote total (a multi-sign last page may have a small own price)
    if (!totalsAmount || totalsAmount <= 0) { flash('Set a price before creating a payment link.'); return }
    setPlBusy(kind); setPlResult(null)
    try {
      // flush any pending edit FIRST so it's recorded as a change before the checkpoint is minted
      // server-side (otherwise the last edit would land in the NEXT rev, not this payment's rev).
      try { if (onSave) await onSave(captureState()) } catch { /* non-blocking */ }

      // one clean image per sign on a multi-sign quote (parent-collected), else just this page
      const images = collectImages ? await collectImages() : [await captureCleanImage()]
      const { data } = await client.post(`/quotes/${quoteId}/payment-link`, {
        kind, images, title: linkTitle || undefined,
        contact: info.contact || '', email: info.email || '',
      })
      setPlResult({ url: data.url, kind })
      // put the link on the proposal's pay button (preview + PDF) and persist it (#5)
      if (onPaymentLinkCreated && data.url) onPaymentLinkCreated(data.url)

      // the payment minted a version checkpoint ({quote_id}-rev{n}); attach the FULL proposal image
      // (whole quote when multi-sign) so the history shows exactly what went out. Best-effort.
      if (data.checkpoint?.id) {
        try { await attachCheckpointImage(quoteId, data.checkpoint.id, captureAll ? await captureAll() : await captureSnapshot()) } catch { /* image is a nice-to-have */ }
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
      const pdf = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' })
      const pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight()

      if (capturePages) {
        // multi-sign quote → ONE Letter page per sign, with the clickable pay-link annotation on
        // the LAST page (#10). Downloads only render on the last page, so THIS proposal's DOM is
        // that page — its pay-button rect maps straight onto the last PDF page (which is also the
        // current jsPDF page after the loop).
        const pages = await capturePages()
        let lastFit = 1, lastOx = 0
        pages.forEach((p, i) => {
          if (i > 0) pdf.addPage()
          const fit = Math.min(pw / p.w, ph / p.h)
          const ox = (pw - p.w * fit) / 2
          pdf.addImage(p.url, 'PNG', ox, 0, p.w * fit, p.h * fit)
          lastFit = fit; lastOx = ox
        })
        const el = pageRef.current
        const a = paymentLink ? el.querySelector('[data-pay-link]') : null
        if (a) {
          const sc = scaleRef.current || 1
          const pageRect = el.getBoundingClientRect(), r = a.getBoundingClientRect()
          const k = HD_SCALE * lastFit   // 1 unscaled css px = HD_SCALE canvas px = HD_SCALE*fit pt
          pdf.link(lastOx + ((r.left - pageRect.left) / sc) * k, ((r.top - pageRect.top) / sc) * k,
            (r.width / sc) * k, (r.height / sc) * k, { url: paymentLink })
        }
        pdf.save(`${info.quoteId || 'quote'}.pdf`)
        flash(`PDF downloaded — ${pages.length} pages` + (a ? ' — payment link is clickable' : ''))
        return
      }

      // single sign — one sheet, with the clickable payment-link annotation over the pay button
      const el = pageRef.current
      const canvas = await render({ scale: HD_SCALE })      // HD capture → crisp text in the PDF
      const fit = Math.min(pw / canvas.width, ph / canvas.height)   // fit the whole page, one sheet (#8)
      const w = canvas.width * fit, h = canvas.height * fit
      const ox = (pw - w) / 2, oy = 0
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', ox, oy, w, h)
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
      {/* No grey mat, no padding: the sheet's own drop shadow separates it from the app
          background, and every reclaimed pixel goes to the page itself. */}
      <div ref={wrapRef} className="proposal-wrap" style={{ overflow: 'hidden', flex: '1 1 520px', minWidth: 0 }}>
        {/* screen-only print-overflow warning — lives OUTSIDE the page div, so no export/PDF
            capture ever includes it. Shows for every page of a multi-sign quote independently. */}
        {overBy > 0 && (
          <div style={{ maxWidth: 816 * scale, margin: '0 auto 10px', background: '#7f1d1d', color: '#fff', border: '1px solid #ef4444', borderRadius: 8, padding: '8px 12px', fontSize: 13, lineHeight: 1.5 }}>
            ⚠ <strong>Content is being cut off at the bottom of the page.</strong> The page is a
            fixed US-Letter sheet — about {Math.ceil(overBy / (PAGE_H / 11) * 10) / 10}″ of content
            is past the bottom edge and will NOT appear on screen, in the PDF, or in print.
            Trim the Additional Notes / specs until this warning disappears.
          </div>
        )}
        <div className="proposal-fit" style={{ width: 816 * scale, height: scaledH, margin: '0 auto' }}>
        <div
          ref={pageRef}
          id="proposal-print-root"
          style={{
            width: 816, height: PAGE_H, overflow: 'hidden', background: '#fff', color: '#111',
            fontFamily: "'Roboto', Arial, sans-serif", fontSize: 12, textTransform: 'uppercase',
            boxSizing: 'border-box', paddingBottom: 14, position: 'relative',
            border: '1px solid var(--border, #d8dee8)',   // sheet edge — replaces the grey mat
            transformOrigin: 'top left', transform: `scale(${scale})`,
          }}
        >
          {/* header — 110px used to leave a big gap before PROPOSAL (the contact block only runs
              ~87px tall from its top:20 start); trimmed to fit it with a little breathing room,
              closer to the reference template's tight header-to-heading spacing (#10). */}
          <div style={{ height: 70, position: 'relative', padding: '0 40px', display: 'flex', alignItems: 'center' }}>
            <img src="/quote-logo.png" alt="Epic Craftings" crossOrigin="anonymous"
              style={{ height: 52, objectFit: 'contain', display: 'block' }} />
            {E('contact', { position: 'absolute', right: 40, top: 12, fontSize: 9, textAlign: 'right', lineHeight: 1.7 })}
          </div>

          <div style={{ padding: '2px 40px 0' }}>
            <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: 1, color: '#1a2433', lineHeight: 1.2 }}>PROPOSAL</div>
          </div>

          {/* info grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', padding: '4px 40px 0', gap: 4 }}>
            {E('infoLeft', { fontSize: 11, lineHeight: 1.6 })}
            {E('infoRight', infoRightPad != null
              ? { fontSize: 11, lineHeight: 1.6, textAlign: 'left', paddingLeft: infoRightPad }
              : { fontSize: 11, lineHeight: 1.6, textAlign: 'right' })}
          </div>

          {/* item details */}
          <div data-sec="items" style={{ margin: '6px 40px 0', ...headCell, borderTop: '1px solid #777' }}>ITEM DETAILS</div>
          <div style={{ margin: '0 40px', border: '1px solid #777', borderTop: 'none', height: 150, position: 'relative', background: artBg, overflow: 'hidden' }}>
            {artworkPath
              ? <AdjImg key={artworkPath} {...adjProps('artwork', { x: 188, y: 16, w: 360, h: 118 })} src={fileUrl(artworkPath)} alt="artwork" lockAspect liveLay autoCrop bounds={{ w: 734, h: 150 }} cors={/res\.cloudinary\.com/i.test(fileUrl(artworkPath) || '')} />
              : <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#bbb', fontStyle: 'italic', fontSize: 12, textTransform: 'none' }}>[ Customer artwork — add it in the Artwork step ]</span>}
            {pickFor && artworkPath && (() => { const a = layout.artwork || { x: 188, y: 16, w: 360, h: 118, rot: 0 }; return (
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

          {/* item table — DESCRIPTION / QTY / UNIT / TOTAL on EVERY page (each sign shows its own
              price now). The last page additionally carries the COMBINED quote total in the
              totals block below; per-page item prices are the part's own. */}
          <div style={{ margin: '5px 40px 0', display: 'grid', gridTemplateColumns: '1fr 56px 104px 104px' }}>
            <div style={{ ...headCell, borderTop: '1px solid #777' }}>ITEM DESCRIPTION</div>
            <div style={{ ...headCell, borderTop: '1px solid #777', borderLeft: 'none', textAlign: 'center' }}>QTY</div>
            <div style={{ ...headCell, borderTop: '1px solid #777', borderLeft: 'none', textAlign: 'center' }}>UNIT PRICE</div>
            <div style={{ ...headCell, borderTop: '1px solid #777', borderLeft: 'none', textAlign: 'center' }}>TOTAL PRICE</div>
            {E('itemDesc', { ...cell, borderTop: 'none' })}
            {/* QTY is editable (#2): TOTAL = qty × unit price, live */}
            <EditCell value={qty}
              onCommit={(v) => { const n = parseInt(v, 10); setQty(Number.isFinite(n) && n > 0 ? n : 1) }}
              style={{ ...cell, borderTop: 'none', borderLeft: 'none', textAlign: 'center' }} />
            {/* Not hand-editable (#7/#9 money bug): these mirror the price set on the Specifications
                step. A rep could previously type a different number straight into these cells, but
                that edit never reached quote.price — the actual charge, dashboard total, and any
                payment link created afterward all kept using the ORIGINAL wizard price. To change
                the price, go back to "Edit specs". */}
            {E('unitPrice', { ...cell, borderTop: 'none', borderLeft: 'none', textAlign: 'center' }, { readOnly: true })}
            {E('totalPrice', { ...cell, borderTop: 'none', borderLeft: 'none', textAlign: 'center' }, { readOnly: true })}
            {/* extra line items + discounts (#4/#6) — Description + Amount only now; the QTY/UNIT
                PRICE columns are the PRIMARY row's alone, so these two cells stay blank for every
                extra row (keeps the table's column lines continuous). A discount's amount is
                entered as a plain positive number and shown/summed as a subtraction (itemSigned). */}
            {items.map((it) => {
              const isDiscount = it.kind === 'discount'
              const amt = (it.amount != null && it.amount !== '') ? Math.max(0, Number(it.amount) || 0) : Math.max(0, Number(it.qty) || 0) * Math.max(0, Number(it.unit) || 0)
              return [
                <div key={it.id + 'd'} style={{ ...cell, borderTop: 'none', position: 'relative' }}>
                  <EditCell value={it.desc} onCommit={(v) => patchItem(it.id, { desc: v || (isDiscount ? 'DISCOUNT' : 'ITEM') })} style={{ display: 'inline-block', minWidth: 60 }} />
                  <span className="adj-ui" title={`Remove this ${isDiscount ? 'discount' : 'line item'}`} onMouseDown={(e) => { e.preventDefault(); removeItem(it.id) }}
                    style={{ position: 'absolute', right: 3, top: '50%', transform: 'translateY(-50%)', width: 15, height: 15, background: '#fff', border: '1.5px solid #e05661', borderRadius: '50%', color: '#e05661', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>×</span>
                </div>,
                <div key={it.id + 'q'} style={{ ...cell, borderTop: 'none', borderLeft: 'none' }} />,
                <div key={it.id + 'u'} style={{ ...cell, borderTop: 'none', borderLeft: 'none' }} />,
                <EditCell key={it.id + 't'} value={isDiscount ? `− ${money(amt)}` : money(amt)}
                  onCommit={(v) => { const n = parseFloat(String(v).replace(/[^0-9.]/g, '')); patchItem(it.id, { amount: Number.isFinite(n) && n >= 0 ? n : 0 }) }}
                  style={{ ...cell, borderTop: 'none', borderLeft: 'none', textAlign: 'center', color: isDiscount ? '#111111' : undefined }} />,
              ]
            })}
          </div>

          {/* specs (left) + package & side view (right): ONE outer frame; the divider is the left
              column's right border, so it's continuous no matter which column ends up taller.
              Template B (monument/pylon, tpl.mono) carries neither a package nor a side view in
              the sheet — full-width specs instead of the 240px sidebar. */}
          <div style={{ margin: '5px 40px 0', display: 'grid', gridTemplateColumns: isMonoType ? '1fr' : '1fr 240px', border: '1px solid #777' }}>
            {/* flex column: SPECIFICATIONS stretches to absorb whatever height the right column
                forces on the grid row, so ADDITIONAL NOTES always hugs the BOTTOM of the box
                instead of floating mid-column with a void under it (regression after the notes
                height-cap removal — the old fixed notesH used to fill that space by accident). */}
            <div style={{ display: 'flex', flexDirection: 'column', ...(isMonoType ? {} : { borderRight: '1px solid #777' }) }}>
              <div data-sec="specs" style={secHead}>SPECIFICATIONS</div>
              {/* specBody: paste blocked (sensitive #2). Its bottom border is the separator ABOVE
                  Additional Notes — drop it when notes are hidden so no line dangles (#4). */}
              {/* The overall box height = whichever COLUMN is taller (it's a CSS grid row). The right
                  column is short whenever it's missing content: Template B (mono, e.g. pylon/monument)
                  has no PACKAGE INCLUDES/SIDE VIEW at all (~136px header-only), and even a normal type
                  drops to ~136px the moment the rep removes the side view (explicit "no side view").
                  Without a floor here, the LEFT column's own small minHeight (215/255) wins and the
                  whole page visibly shrinks the instant either of those happens — give it a floor
                  matching the FULL right sidebar (package ~136 + side view ~270) so page length stays
                  consistent no matter which sections are present. */}
              {/* One small uniform floor. The old inflated floor for mono / no-side-view quotes
                  existed to keep the PAGE length consistent when the right column emptied — dead
                  logic now that the sheet is a hard 1056px: the page can't shrink, so the big
                  floor only stole the very room the rep needs for Additional Notes lines. */}
              {E('specBody', { fontSize: 10.5, lineHeight: 1.6, padding: '8px 12px', flex: '1 1 auto', minHeight: specLong ? 185 : 150, whiteSpace: 'pre-wrap', outline: 'none', borderBottom: (!specLong && !hideNotes) ? '1px solid #777' : 'none' }, { noPaste: true })}
              {!specLong && !hideNotes && <>
                <div style={{ ...secHead, position: 'relative' }}>ADDITIONAL NOTES
                  {/* screen-only remover (#6) — restore via "+ Notes" in the right column */}
                  <span className="adj-ui" title="Remove the Additional Notes section"
                    onMouseDown={(e) => { e.preventDefault(); setHideNotes(true) }}
                    style={{ position: 'absolute', right: 5, top: '50%', transform: 'translateY(-50%)', width: 15, height: 15, background: '#fff', border: '1.5px solid #e05661', borderRadius: '50%', color: '#e05661', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>×</span>
                </div>
                {/* No fixed height / scrollbar here: the export renders exactly what's on screen,
                    so notes must always be fully visible — the box grows with the text. */}
                <div style={{ minHeight: 40 }}>
                  {E('notes', { fontSize: 10.5, lineHeight: 1.6, padding: '6px 12px', outline: 'none' }, { noImagePaste: true })}
                </div>
              </>}
            </div>
            {!isMonoType && (
            <div>
              <div style={secHead}>PACKAGE INCLUDES</div>
              <div style={{ position: 'relative', height: 100, borderBottom: '1px solid #777' }}>
                {packageItems.map((p, i) => (
                  // Package tiles of the CHOSEN set (#11). Key includes the set so switching sets
                  // remounts with fresh default positions.
                  // The initial frame passed here is what fitBounds clamps against BEFORE the real
                  // aspect-fit (onLoad) ever runs — it used to be a pkgW×pkgW SQUARE (234×234) even
                  // though the box is only 116px tall, so fitBounds shrank it to a 114×114 square and
                  // fed that stunted width into the aspect-fit, leaving a wide baked image (A–D are
                  // ~3:1) far smaller than the box could actually hold. Match the real box shape
                  // instead so the aspect-fit gets the FULL available width to work with.
                  <AdjImg key={`${pkgSet}-${p.label}`} {...adjProps(`pkg-${pkgSet}-${p.label}`, { x: pkgDefX(i, packageItems.length, pkgW), y: 5, w: pkgW, h: 100 })} src={p.img} alt={p.label} lockAspect fitCenterH={100} reserveCaption={!PACKAGE_SETS[pkgSet].baked}
                    slotCenterX={pkgDefX(i, packageItems.length, pkgW) + pkgW / 2}
                    bounds={{ w: 238, h: 98 }} />
                ))}
                {/* captions from the set's item labels. `baked` sets (A–D) already carry their
                    labels inside the artwork, so drawing them again would double them up. */}
                {!PACKAGE_SETS[pkgSet].baked && packageItems.map((p, i) => {
                  const t = layout[`pkg-${pkgSet}-${p.label}`]
                  return (
                    <div key={`cap-${pkgSet}-${p.label}`} style={{
                      position: 'absolute',
                      left: t ? t.x : pkgDefX(i, packageItems.length, pkgW),
                      top: t ? t.y + t.h + 4 : 66,
                      width: t ? t.w : pkgW,
                      textAlign: 'center', fontSize: 7.5, letterSpacing: 1, color: '#555', fontWeight: 600, lineHeight: 1.15,
                    }}>{p.label}</div>
                  )
                })}
              </div>
              {/* explicit "no side view" removes the whole section, headline included */}
              {!sideViews.includes('__none__') && (
                <>
                  <div data-sec="sideview" style={secHead}>SIDE VIEW</div>
                  <div style={{ position: 'relative', height: 160 }}>
                    {sideViews.length === 0
                      ? <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#bbb', fontStyle: 'italic', fontSize: 10, textTransform: 'none' }}>[ No side view selected ]</span>
                      : (() => {
                          // tile instead of stacking: one view fills the (now bigger) box; several share it 2-per-row (#3)
                          const list = sideViews.filter((k) => k !== '__none__')
                          const one = list.length === 1
                          const tileH = one ? 148 : 72   // matches each tile's own frame height below
                          return list.map((k, i) => (
                            // lockAspect+fitCenterH: without these (the original bug) the aspect-fit-
                            // on-load never runs, so a freshly uploaded side view — which usually has
                            // real background margin, unlike the pre-cropped catalog art — just sits
                            // shrunk inside its default frame instead of growing to fill the slot.
                            // autoCrop trims that margin so the sign itself, not empty canvas, fills it.
                            <AdjImg key={k} {...adjProps(`sv2-${k}`, one
                              ? { x: 10, y: 6, w: 218, h: 148 }
                              : { x: 6 + (i % 2) * 116, y: 5 + Math.floor(i / 2) * 78, w: 112, h: 72 })}
                              src={svSrc(k)} alt={String(k)} lockAspect autoCrop fitCenterH={tileH} reserveCaption={false}
                              bounds={{ w: 238, h: 158 }} />
                          ))
                        })()}
                  </div>
                </>
              )}
            </div>
            )}
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
                  {/* not hand-editable — same money-correctness reasoning as UNIT/TOTAL PRICE above */}
                  <span>SUBTOTAL</span>{E('subtotal', undefined, { readOnly: true })}
                </div>
                {totalsAmount > 500 && <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 6 }}>
                    <span>50% DEPOSIT DUE NOW</span>{E('dep1', undefined, { readOnly: true })}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
                    <span>50% DUE ON SHIPMENT</span>{E('dep2', undefined, { readOnly: true })}
                  </div>
                </>}
              </div>
              {/* The pay CTA appears ONLY once a real payment link exists — never a placeholder
                  before one is created, and it simply re-points when a link is re-created. No
                  link → nothing renders (a dead "Click here to make payment" misleads the customer). */}
              {(paymentLink && /^https?:\/\//i.test(paymentLink)) && (
                <a data-pay-link href={paymentLink} target="_blank" rel="noreferrer" style={{ display: 'block', marginTop: 14, background: '#f5a623', padding: 14, textAlign: 'center', fontSize: 15, fontWeight: 800, letterSpacing: 0.5, color: '#111', textDecoration: 'none' }}>CLICK HERE TO MAKE PAYMENT</a>
              )}
            </div>
            )}
          </div>

          {/* draggable color swatches — the filled block prints; the picker chrome (.adj-ui) does not */}
          {swatches.map((sw) => ((sw.id === 'rettrim' && hideRet) ? null : (sw.id === 'face' || sw.id === 'rettrim' || sw.color || sw.name || sw.keep || selId === 'swatch-' + sw.id) ? (
            <AdjSwatch key={sw.id} rk={'swatch-' + sw.id} sw={sw} scaleRef={scaleRef}
              locked={false}
              selected={selId === 'swatch-' + sw.id} onSelect={() => setSelId('swatch-' + sw.id)}
              onChange={(n) => setSwatches((arr) => {
                // uniform chips (#6): resizing ANY swatch applies the same w/h to ALL of them,
                // so the colour row always reads as one consistent set while editing.
                const sizeChanged = n.w !== sw.w || n.h !== sw.h
                if (!sizeChanged) return arr.map((x) => (x.id === sw.id ? clampToArea(n) : x))
                // Re-flow every row left→right at the new size (bug: the old code left every OTHER
                // chip's x untouched after a uniform resize, so growing a chip grew it straight INTO
                // its stale-positioned neighbour, and shrinking-then-growing back overlapped them —
                // the chip's "old proportion" of the row was never recomputed).
                const GAP = 1   // just enough to guarantee no-overlap; keep chips close together
                const resized = arr.map((x) => (x.id === sw.id ? n : { ...x, w: n.w, h: n.h }))
                const rows = []
                ;[...resized].sort((a, b) => a.y - b.y).forEach((s) => {
                  const row = rows[rows.length - 1]
                  if (row && Math.abs(s.y - row[row.length - 1].y) <= 18) row.push(s)
                  else rows.push([s])
                })
                const flowed = new Map()
                rows.forEach((row) => {
                  let cursorX = [...row].sort((a, b) => a.x - b.x)[0].x
                  ;[...row].sort((a, b) => a.x - b.x).forEach((s) => {
                    flowed.set(s.id, { ...s, x: Math.round(cursorX) }); cursorX += s.w + GAP
                  })
                })
                return resized.map((x) => clampToArea(flowed.get(x.id)))
              })}
              onRemove={() => { setSwatches((arr) => arr.filter((x) => x.id !== sw.id)); setSelId(null) }}
              onDragEnd={() => { snapRow(sw.id); if (sw.id === 'face' || sw.id === 'rettrim') setSwatches((arr) => arr.map((x) => (x.id === sw.id ? { ...x, moved: true } : x))) }}
              onPick={() => { artCanvasRef.current = null; setPickFor(sw.id) }} canPick={!!artworkPath} />
          ) : null))}
        </div>
        </div>
      </div>

      {mainView && (
      <div ref={controlsRef} className="proposal-controls" style={{ flex: '0 0 220px', maxWidth: 220 }}>
      {/* ONE compact stack, tight gaps — every control visible in a single glance with no
          scrolling. (The old measured-margin system that spread groups down the page to face
          their proposal sections is gone — those margins were the wasted space.) */}
      {(() => {
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
            {/* per-page actions (Edit specs / Delete / Move ↑↓) live at the TOP of this page's own
                column — as a flow row above the sheet they pushed the whole page down (dead band),
                and here they can never act on the wrong page: the parent binds them per render. */}
            {pageActions}
            {/* UNDO / REDO (#7) — same history the Ctrl+Z / Ctrl+Y shortcuts walk */}
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" className="ghost sm" style={{ flex: 1 }} title="Undo (Ctrl+Z)" onClick={() => applyHist(-1)}>↶ Undo</button>
              <button type="button" className="ghost sm" style={{ flex: 1 }} title="Redo (Ctrl+Y)" onClick={() => applyHist(+1)}>↷ Redo</button>
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 10}}>
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
                {/* {artworkPath && onArtworkFile && (
                  <button type="button" onClick={() => setCropOpen(true)}
                    title="Crop the artwork (pan + zoom + drag the box) — output replaces the current artwork"
                    style={{ marginLeft: 6, padding: '2px 8px', fontSize: 12, borderRadius: 4, border: '1px solid var(--border)', background: '#fff', cursor: 'pointer', color: '#333' }}>
                    ✂ Crop
                  </button>
                )} */}
              </div>
            </div>

            {/* DIMENSIONS — aligned just under ITEM DETAILS */}
            <div style={{marginTop: 10}}>
              <button
                type="button" className="ghost" style={{ width: '100%' }}
                title="Add measurement arrows beside the artwork (drag to place, pull the dot to resize, click the label to type the size)"
                onClick={() => {
                  const p = parseDims(mode === 'custom' ? customSpec?.dims : answers?.dimensions)
                  const a = layout.artwork || { x: 188, y: 16, w: 360, h: 118 }
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
              {/* #4/#6 — add a row to the item table: Description + Amount only. Discount subtracts
                  from the total instead of adding (itemSigned). */}
              <div
              style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  marginTop: 10
                }}
              >
                <button
                  type="button"
                  className="ghost"
                  style={{ width: '100%' }}
                  title="Add another line item to the item table"
                  onClick={addItem}
                >
                  + Line item
                </button>

                {/* Discount lives on the LAST page only — it subtracts from the combined quote
                    total, which the last page carries (same rule as downloads/payment). */}
                {isLast && (
                  <button
                    type="button"
                    className="ghost"
                    style={{
                      width: '100%',
                      color: '#15ff00',
                      borderColor: '#15ff00'
                    }}
                    title="Give the customer a discount (its amount is SUBTRACTED from the quote total)"
                    onClick={addDiscount}
                  >
                    − Discount
                  </button>
                )}
              </div>
            </div>

            {/* COLOURS — aligned to SPECIFICATIONS (where the COLOR SPECS live) */}
            <div style={{marginTop:10}}>
              <button type="button" className="ghost" style={{ width: '100%' }} onClick={addSwatch}>+ Add color swatch</button>
            </div>

            {/* PACKAGE SET — pick ONE of the sets shown under PACKAGE INCLUDES (#11). Template B
                (monument/pylon) has no package in the sheet — nothing to pick. */}
            {!isMonoType && (
            <div>
              {/* image dropdown (#8): the picker shows each set's actual item IMAGES, not text */}
              <div data-pkg-picker style={{ position: 'relative' , marginTop: 10}}>
                <button type="button" className="ghost p-0" style={{ width: '100%', display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'center' }}
                  title="Choose which set of included items shows under PACKAGE INCLUDES"
                  onClick={() => setPkgPicking((v) => !v)}>
                  {PACKAGE_SETS[pkgSet].items.map((it) => (
                    <img key={it.img} src={it.img} alt={it.label} style={{ height: '70px', objectFit: 'cover', background: '#fff', borderRadius: 3 }} />
                  ))}
                  <span style={{ fontSize: 11 }}>▾</span>
                </button>
                {pkgPicking && (
                  <div style={{ position: 'absolute', top: '105%', left: 0, right: 0, zIndex: 90, background: 'var(--navy-700)', border: '1px solid var(--border)', borderRadius: 8, padding: 8, boxShadow: 'var(--shadow-lg, 0 8px 24px rgba(0,0,0,0.3))', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {Object.entries(PACKAGE_SETS).map(([k, v]) => (
                      <button key={k} type="button" className="ghost p-0"
                        onClick={() => { setPkgSet(k); setPkgPicking(false) }}
                        style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center', padding: 8, borderColor: pkgSet === k ? 'var(--gold)' : undefined }}
                        title={v.label}>
                        {v.items.map((it) => (
                          <img key={it.img} src={it.img} alt={it.label} style={{ height: '80px', objectFit: 'cover', background: '#fff', borderRadius: 4, padding: 2 }} />
                        ))}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            )}

            {/* SPECIFICATIONS — aligned just under the SPECIFICATIONS header. The "Rebuild spec
                text" button is gone (no longer needed); only the Notes restorer lives here now. */}
            {hideNotes && (
              <div>
                <button type="button" className="ghost" style={{ width: '100%' }}
                  title="Bring the Additional Notes section back" onClick={() => setHideNotes(false)}>+ Notes</button>
              </div>
            )}

            {/* SIDE VIEW — aligned to the SIDE VIEW section. Template B has none. */}
            {onSideViews && !isMonoType && (
              <div style={{marginTop: 10}}>
                <button type="button" data-sv-picker className="ghost" style={{ width: '100%' }}
                  onClick={(e) => {
                    // the picker opens as a panel at the BUTTON'S RIGHT (#9), not below the page
                    const r = e.currentTarget.getBoundingClientRect()
                    setSvAnchor({ left: Math.min(r.right + 10, window.innerWidth - 640), top: Math.max(10, Math.min(r.top, window.innerHeight - 520)) })
                    setPickingSV((v) => !v)
                  }}>{pickingSV ? 'Done choosing side views' : '+ Choose side views'}</button>
              </div>
            )}
          </div>
        )
      })()}

      {/* actions — downloads live ONCE, on the last page (#: single set of downloads per quote).
          The toast still shows per page (each part can flash its own save). */}
      {/* compact: PNG + PDF side by side so the whole control stack fits one glance (#7/#8) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 15 }}>
        {isLast && exportBlocked && <span style={{ color: '#e5484d', fontWeight: 600, fontSize: 13 }}>🔒 Locked — price approval needed before this quote can be sent out</span>}
        {isLast && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="ghost" style={{ flex: 1 }} disabled={busy || exportBlocked} title={exportBlocked ? 'Price approval required' : undefined} onClick={downloadPNG}>{busy === 'png' ? 'Rendering…' : '⬇ PNG'}</button>
            <button style={{ flex: 1 }} disabled={busy || exportBlocked} title={exportBlocked ? 'Price approval required' : undefined} onClick={downloadPDF}>{busy === 'pdf' ? 'Building…' : '⬇ PDF'}</button>
          </div>
        )}
        {toast && <span style={{ color: '#2e7d32', fontWeight: 600 }}>{toast}</span>}
      </div>

      {/* Shopify payment link — only on the last page (one combined link per quote) */}
      {isLast && canCreatePaymentLinks && quoteId && (
        <div style={{ marginTop: 15, padding: 10, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--navy-900)' }}>
          <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 13 }}>💳 Shopify payment link</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 , marginTop: 8}}>
            {/* all three payment options: same prominent style AND same full width (#6/#8) */}
            <button style={{ width: '100%' }} disabled={!!plBusy || exportBlocked} onClick={() => createPaymentLink('full')}>{plBusy === 'full' ? 'Creating…' : 'Full payment'}</button>
            {totalsAmount > 500 && <button style={{ width: '100%' }} disabled={!!plBusy || exportBlocked} onClick={() => createPaymentLink('deposit')}>{plBusy === 'deposit' ? 'Creating…' : '50% deposit'}</button>}
            {totalsAmount > 500 && <button style={{ width: '100%' }} disabled={!!plBusy || exportBlocked} onClick={() => createPaymentLink('balance')}>{plBusy === 'balance' ? 'Creating…' : 'Remaining Balance (50%)'}</button>}
            {totalsAmount > 0 && totalsAmount <= 500 && <span className="muted" style={{ fontSize: 12 }}>≤ $500 → full payment only</span>}
          </div>
          {plResult && (
            <div style={{ marginTop: 10, fontSize: 13 }}>
              {/* truncated link display (#11) — the full URL is on the anchor + Copy */}
              <a href={plResult.url} target="_blank" rel="noreferrer" title={plResult.url}>
                {plResult.url.length > 48 ? plResult.url.slice(0, 48) + '……' : plResult.url}
              </a>{' '}
              <button className="ghost sm" onClick={() => { navigator.clipboard?.writeText(plResult.url); flash('Link copied') }}>Copy</button>
            </div>
          )}
        </div>
      )}
      </div>
      )}
      </div>{/* /proposal-layout */}

      {/* real crop modal (react-easy-crop) — physically outputs a cropped file that replaces
          the artwork. The AdjImg edge bars only clip visually; this one actually cuts pixels. */}
      {cropOpen && artworkPath && onArtworkFile && (
        <div onClick={() => !cropBusy && setCropOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ background: 'var(--panel, #fff)', color: 'var(--text, #111)', padding: 20, borderRadius: 12, maxWidth: 780, width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <strong>Crop artwork</strong>
              <button type="button" className="ghost" onClick={() => !cropBusy && setCropOpen(false)}>✕</button>
            </div>
            <ArtworkCropper
              src={fileUrl(artworkPath)}
              busy={cropBusy}
              onCancel={() => setCropOpen(false)}
              onApply={async (file) => {
                setCropBusy(true)
                try { await onArtworkFile(file); setCropOpen(false); flash('Artwork cropped') }
                catch (err) { flash('Crop failed: ' + (err?.message || err)) }
                finally { setCropBusy(false) }
              }}
            />
          </div>
        </div>
      )}

      {/* side-view picker — a floating panel at the RIGHT of the "+ Choose side views" button (#9) */}
      {onSideViews && mainView && pickingSV && (
        <SideViewPicker
          svAnchor={svAnchor} sideViews={sideViews} onSideViews={onSideViews}
          svLib={svLib} setSvLib={setSvLib}
          svSrc={svSrc} tpl={tpl} info={info} flash={flash} />
      )}

    </div>
  )
}

export default forwardRef(Proposal)
