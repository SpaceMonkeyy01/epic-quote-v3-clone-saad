// Shared constants + pixel helpers for the proposal preview. Extracted verbatim from
// Proposal.jsx (structural split only — no logic changed).

export const HEAD = '#e9e9e9'

export const LOUPE = 185, SRC = 38   // eyedropper magnifier: loupe diameter (px) and source pixels across it
                              // (~5.5px per pixel — pixels stay visible but you keep enough context to aim)

// Luminance-based text color so the swatch label stays readable on any fill.
export function swatchText(hex) {
  const h = (hex || '').replace('#', '')
  if (h.length < 6) return '#111'
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? '#111' : '#fff'
}

// Detect the subject's bounding box inside an image (#2): sample the border pixels for the
// background colour, mark every pixel that differs beyond a threshold (or is transparent-vs-not),
// and return the normalized bounding rect {x,y,w,h} in [0..1] of the natural image — or null.
// This is the cv.findContours→boundingRect pipeline done with raw canvas pixels: same result for
// a single bbox, without shipping OpenCV's ~8MB WASM. Throws nothing; returns null on any failure
// (CORS-tainted canvas, degenerate image, subject filling the whole frame).
export function detectSubjectBox(img) {
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
    const colCount = new Int32Array(w), rowCount = new Int32Array(h)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const [r, g, b, a] = px(x, y)
        const isSubject = alphaMode
          ? a >= 16
          : a >= 16 && (Math.abs(r - br) + Math.abs(g - bg) + Math.abs(b - bb)) > THR
        if (isSubject) {
          colCount[x]++; rowCount[y]++
          if (x < minX) minX = x; if (x > maxX) maxX = x
          if (y < minY) minY = y; if (y > maxY) maxY = y
        }
      }
    }
    if (maxX < 0) return null                          // nothing found
    // A lone fringe pixel (JPEG ringing, PNG anti-aliasing) touching column 0/right edge or
    // row 0/bottom edge pins that whole axis to "no margin" even though the real subject sits
    // well inside — visually: crop works on one axis but the other looks totally uncropped.
    // Require a real run (>1% of the OTHER dimension) before trusting an edge column/row.
    const colNoise = Math.max(1, Math.round(h * 0.01)), rowNoise = Math.max(1, Math.round(w * 0.01))
    while (maxX > minX && colCount[minX] <= colNoise) minX++
    while (maxX > minX && colCount[maxX] <= colNoise) maxX--
    while (maxY > minY && rowCount[minY] <= rowNoise) minY++
    while (maxY > minY && rowCount[maxY] <= rowNoise) maxY--
    const bw = maxX - minX + 1, bh = maxY - minY + 1
    const cover = (bw * bh) / (w * h)
    if (cover > 0.985 || cover < 0.005) return null    // whole frame / speck → no useful box
    return { x: minX / w, y: minY / h, w: bw / w, h: bh / h }
  } catch { return null }
}
