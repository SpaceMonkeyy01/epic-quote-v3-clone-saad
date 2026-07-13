import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate, useSearchParams, useLocation } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { getQuote, updateQuote, putGenerated, uploadArtwork, uploadCustomerFile, generateSpecs, createCheckpoint, deleteQuote } from '../api/quotes'
import { getLogo } from '../api/meta'
import { useConstants } from '../hooks'
import useAuthStore from '../store/authStore'
import { T, SIGN_GROUP_ORDER, signGroupOf } from '../generator/catalog'
import { autoAnswerFromAI, parseDims, composeDims, cleanNum } from '../generator/questions'
import { buildSpecLines } from '../generator/proposal'
import { listCatalog, saveCatalogItem } from '../api/catalog'
import { SIDE_VIEWS, pickSideView } from '../generator/sideviews'
import { rasterizePdf } from '../generator/pdfRaster'
import { fileUrl } from '../api/client'
import QA from '../generator/QA'
import Proposal from '../components/Proposal'
import MoneyInput from '../components/MoneyInput'
import ArtworkCropper from '../components/ArtworkCropper'

const MAX_PRICE = 1000000   // sanity guard against typos — real jobs go into 6 digits (also clamped server-side)

const FLOWS = {
  generator: ['client', 'project', 'signtype', 'specs', 'artwork', 'preview'],
  // manual mode gets the Artwork step too, so the sign image can be added/changed here
  // (the proposal even points to it) — it was missing before.
  custom: ['client', 'customspecs', 'artwork', 'preview'],
}

// Cloudinary-stored PDF/Illustrator drawings can't render in an <img>/<iframe> directly —
// ask the CDN to rasterize page 1 to a PNG instead (free URL transformation).
const isCloudDoc = (p) => /res\.cloudinary\.com/.test(p || '') && /\.(pdf|ai)$/i.test(p || '')
const cloudRaster = (p, w = 1600) =>
  p.replace('/upload/', `/upload/pg_1,f_png,w_${w}/`).replace(/\.(pdf|ai)$/i, '.png')

// A sign type the catalog doesn't have: free-form template (like monuments) — the spec body
// comes from the AI's full reading of the drawing when available, and the wizard asks the
// generic questions (dimensions, illumination, mounting, colors, application, price).
// Crop a data-URL image to the AI-located artwork box. Tolerates every shape the model
// actually returns: an object, a JSON string, fractions 0..1, or raw pixel coordinates
// (normalized against the real image size). Falls back to the full image when the box is
// missing or implausible (tiny/inverted), so it can never lose data.
const cropToBox = (dataUrl, boxIn) => new Promise((resolve) => {
  let box = boxIn
  if (typeof box === 'string') { try { box = JSON.parse(box.replace(/'/g, '"')) } catch { box = null } }
  if (!box || typeof box !== 'object') return resolve(dataUrl)
  // accept corner form {x1,y1,x2,y2} or box form {x,y,w,h}
  let nums = 'x1' in box
    ? [box.x1, box.y1, Number(box.x2) - Number(box.x1), Number(box.y2) - Number(box.y1)].map(Number)
    : [box.x, box.y, box.w, box.h].map(Number)
  if (nums.some((v) => !Number.isFinite(v) || v < 0)) return resolve(dataUrl)
  const img = new Image()
  img.onload = () => {
    try {
      let [x, y, w, h] = nums
      if (x > 1.5 || y > 1.5 || w > 1.5 || h > 1.5) {   // pixel coords → fractions
        x /= img.width; w /= img.width; y /= img.height; h /= img.height
      }
      // pad generously so an imprecise box never clips letters off the sign
      const PAD = 0.06
      x -= PAD; y -= PAD; w += PAD * 2; h += PAD * 2
      x = Math.min(Math.max(x, 0), 0.95); y = Math.min(Math.max(y, 0), 0.95)
      w = Math.min(w, 1 - x); h = Math.min(h, 1 - y)
      if (w < 0.12 || h < 0.08 || (w > 0.96 && h > 0.96)) return resolve(dataUrl)   // too small/whole page → keep page
      // JPEG + capped resolution: a PNG crop of a photo can blow past the 25MB upload limit
      const cw = Math.max(1, Math.round(img.width * w)), ch = Math.max(1, Math.round(img.height * h))
      const scale = Math.min(1, 1600 / Math.max(cw, ch))
      const c = document.createElement('canvas')
      c.width = Math.max(1, Math.round(cw * scale))
      c.height = Math.max(1, Math.round(ch * scale))
      const ctx = c.getContext('2d')
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height)
      ctx.drawImage(img, img.width * x, img.height * y, cw, ch, 0, 0, c.width, c.height)
      resolve(c.toDataURL('image/jpeg', 0.92))
    } catch { resolve(dataUrl) }
  }
  img.onerror = () => resolve(dataUrl)
  img.src = dataUrl
})

const urlToDataUrl = async (url) => {
  const blob = await (await fetch(url)).blob()
  return new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob) })
}

const makeCustomTpl = (name, storedSpec = null) => {
  const N = name.trim().toUpperCase()
  return { n: N, st: N, mono: true, illum: 'led', mountDef: '', desc: N, customType: true, storedSpec }
}

// The fields that make up ONE sign part. Company/client/job/payment_link live at the top level
// of generated_data (shared across every part) — only these are per-part.
const PART_KEYS = ['quote_type', 'tpl_name', 'tpl_stored_spec', 'custom_spec', 'answers', 'ai',
  'artwork_path', 'artwork_auto', 'sign_box', 'side_views', 'proposal_notes', 'proposal_state']

// A→Z→AA labels for the parts (rarely past B in practice, but never breaks).
const partLetter = (i) => {
  let s = ''
  do { s = String.fromCharCode(65 + (i % 26)) + s; i = Math.floor(i / 26) - 1 } while (i >= 0)
  return s
}

// Lazy-wrap a legacy single-sign generated_data (fields at top level) into one part object,
// so old quotes and new quotes share exactly one shape from load onward.
const legacyPartFromGd = (g) => {
  const p = {}
  for (const k of PART_KEYS) if (g[k] !== undefined) p[k] = g[k]
  return p
}

// Robust AI signType → catalog match: exact → normalized → contains → best token overlap.
// The model often returns a near-name (e.g. "1\" DEEP RAISED ALUMINUM LETTERS") that isn't
// verbatim in the catalog; this still snaps it to the closest real sign type.
function matchSignType(name) {
  if (!name) return null
  const norm = (s) => s.toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
  const target = norm(name)
  let m = T.find((t) => t.n === name) || T.find((t) => norm(t.n) === target)
  if (m) return m
  m = T.find((t) => norm(t.n).includes(target)) || T.find((t) => target.includes(norm(t.n)))
  if (m) return m
  const words = new Set(target.split(' ').filter((w) => w.length > 2))
  let best = null, bestScore = 0
  for (const t of T) {
    const score = norm(t.n).split(' ').filter((w) => w.length > 2).reduce((n, w) => n + (words.has(w) ? 1 : 0), 0)
    if (score > bestScore) { bestScore = score; best = t }
  }
  return bestScore >= 2 ? best : null
}

export default function Generator() {
  const { quoteId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  // return to wherever the quote was opened from (#9), defaulting to All Quotes
  const exitTo = location.state?.from || '/quotes'
  const qc = useQueryClient()
  const [searchParams] = useSearchParams()
  const [autoAi, setAutoAi] = useState(false)
  const { data: constants } = useConstants()
  const admin = useAuthStore((s) => s.isAdmin)()
  const canCreatePaymentLinks = useAuthStore((s) => s.user?.can_create_payment_links) || admin
  const reps = constants?.sales_reps || []

  const [quote, setQuote] = useState(null)
  const [gd, setGd] = useState(null)            // existing generated_data
  // A quote is an ORDERED LIST of sign parts (A, B, C…). The wizard's editing hooks below
  // (tpl/answers/customSpec/artworkPath/sideViews/signBox/proposalNotes) are a scratch buffer
  // for the ONE part currently being created or edited — `activePart`. `parts` is the persisted
  // collection; the preview renders every part from it. A legacy single-sign quote lazy-wraps to
  // parts[0] on load (see the loader), so nothing needs migrating.
  const [parts, setParts] = useState([])
  const [activePart, setActivePart] = useState(0)
  // Latest parts/gd, readable synchronously — each Proposal page autosaves independently, so two
  // parts can save within one render; reading state from a stale closure would drop one. Both save
  // paths (saveProgress, savePart) update these refs BEFORE the async PUT.
  const partsRef = useRef(parts); partsRef.current = parts
  const gdRef = useRef(gd); gdRef.current = gd
  const [mode, setMode] = useState(null)        // 'generator' | 'custom'
  const [step, setStep] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')   // set when the quote can't be loaded (e.g. bad/deleted id)

  // wizard state
  const [client, setClient] = useState({ company_name: '', client_name: '', contact: '', email: '', address: '', job_name: '', sales_rep: '' })
  const [special, setSpecial] = useState('')
  const [tpl, setTpl] = useState(null)
  const [answers, setAnswers] = useState({})
  const [artworkPath, setArtworkPath] = useState(null)
  const [artErr, setArtErr] = useState('')
  const [cropping, setCropping] = useState(false)   // #5 big-canvas crop editor open?
  const [signBox, setSignBox] = useState(null)      // bounding box of the sign on the artwork (fractions) for precise dim arrows
  const [paymentLink, setPaymentLink] = useState('')
  const [sideViews, setSideViews] = useState([])   // chosen side-view keys
  const [customSpec, setCustomSpec] = useState(null)
  const [logo, setLogoUrl] = useState(null)
  const [signSearch, setSignSearch] = useState('')
  const [signGroup, setSignGroup] = useState(null)   // #5 — selected main category (two-level picker)
  const [exitAsk, setExitAsk] = useState(false)      // #3 — "save or delete?" ask when leaving the proposal
  const [typePicking, setTypePicking] = useState(false)  // #2 — two-level custom-mode type picker open
  const [typeGroup, setTypeGroup] = useState(null)       //      selected main type inside it
  const [customType, setCustomType] = useState('')   // free-typed sign type (not in the catalog)
  const [signLib, setSignLib] = useState([])          // team's saved custom sign types (shared, both modes)
  const [customTypeSel, setCustomTypeSel] = useState('')  // dropdown selection on the custom-specs page
  const [newTypeName, setNewTypeName] = useState('')
  const [newTypeSpec, setNewTypeSpec] = useState('')
  const [customDimsStatus, setCustomDimsStatus] = useState('')
  const customDimsTried = useRef(false)
  const [saving, setSaving] = useState(false)
  const [ai, setAi] = useState(null)
  const [aiStatus, setAiStatus] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const artInput = useRef(null)
  const [showDrawing, setShowDrawing] = useState(false)   // in-app viewer for the customer's file
  const [drawingOk, setDrawingOk] = useState(null)        // null = checking, false = file missing on server
  const [proposalNotes, setProposalNotes] = useState('')  // net-new notes (asked last), shown on the proposal
  const [repOther, setRepOther] = useState(false)         // typing a custom sales rep

  useEffect(() => {
    (async () => {
     try {
      const q = await getQuote(quoteId)
      setQuote(q)
      const g = q.generated_data || {}
      setGd(g)
      setClient({
        company_name: q.company_name || '', client_name: q.client_name || '',
        contact: q.contact || '', email: q.email || '', address: q.address || '',
        job_name: g.job_name || q.job_name || '', sales_rep: q.sales_rep || '',
      })
      setSpecial(q.special_requirements || '')

      // Build the parts list: use g.parts when present, else lazy-wrap the legacy top-level bundle
      // as the single part[0]. The wizard opens on the FIRST part; Add Page appends more later.
      const loadedParts = ((Array.isArray(g.parts) && g.parts.length)
        ? g.parts
        : [legacyPartFromGd(g)])
        // stable id per part → the preview keys pages by it, so a page only remounts when its
        // letter / last-ness actually changes (delete/add), never on a routine autosave.
        .map((p, i) => ({ ...p, __pid: p.__pid || `p${i}_${Math.random().toString(36).slice(2, 8)}` }))
      setParts(loadedParts)
      setActivePart(0)
      const p0 = loadedParts[0] || {}

      if (p0.tpl_name) setTpl(T.find((t) => t.n === p0.tpl_name) || makeCustomTpl(p0.tpl_name, p0.tpl_stored_spec || null))
      setAnswers(p0.answers || {})
      setAi(p0.ai || null)
      setCustomSpec(p0.custom_spec || null)
      if (p0.artwork_path) setArtworkPath(p0.artwork_path)
      if (p0.sign_box) setSignBox(p0.sign_box)
      // #10: if no artwork chosen yet but the customer uploaded an image of the sign, use it
      else if (q.customer_pdf && /\.(png|jpe?g|gif|webp|svg)$/i.test(q.customer_pdf)) setArtworkPath(q.customer_pdf)
      if (p0.side_views) setSideViews(p0.side_views)
      if (g.payment_link) setPaymentLink(g.payment_link)   // payment link is shared (one link per quote)
      setProposalNotes(p0.proposal_notes || '')
      getLogo().then((l) => setLogoUrl(l.logo)).catch(() => {})

      // Mode comes from the intake choice (?mode=ai|custom) or the persisted quote_type — never re-asked.
      // AI mode is DORMANT for now (#8): anything without an explicit generator mode defaults to
      // CUSTOM, so the AI path is bypassed. Existing AI quotes (quote_type='generator') still open
      // in AI mode, so no data breaks — re-enable by restoring the mode picker below.
      const modeParam = searchParams.get('mode')
      const resolvedMode = g.quote_type || p0.quote_type
        || (modeParam === 'ai' ? 'generator' : 'custom')
      if (resolvedMode) {
        setMode(resolvedMode)
        if (resolvedMode === 'custom') {
          setStep(p0.custom_spec ? 'preview' : 'customspecs')   // straight to the questions
        } else {
          const hasProgress = p0.tpl_name && Object.keys(p0.answers || {}).length
          setStep(hasProgress ? 'preview' : 'project')
          if (modeParam === 'ai' && !p0.ai) setAutoAi(true)      // auto-run extraction once
        }
      }
     } catch (e) {
        // bad / deleted quote id, or the API is down — show a real message instead of spinning forever
        setLoadError(e?.response?.status === 404 ? 'notfound' : 'error')
     } finally {
        setLoading(false)
     }
    })()
  }, [quoteId])

  const flow = mode ? FLOWS[mode] : []
  const flowIndex = flow.indexOf(step)

  // ---- live preview beside the wizard (boss demand): the REAL editable proposal, refreshed
  // whenever wizard data changes. Remounting on a debounced key keeps two guarantees: fresh
  // wizard data always flows in, and typing INSIDE the preview never gets clobbered (edits
  // auto-save to proposal_state, which the remount restores dirty-first).
  const [previewKey, setPreviewKey] = useState(0)
  const livePreview = !loading && !loadError && step && step !== 'preview'
  const previewSig = JSON.stringify([answers, client, customSpec, tpl?.n, sideViews, artworkPath, proposalNotes, paymentLink, ai?.fullSpec])
  const prevSig = useRef(previewSig)
  useEffect(() => {
    if (prevSig.current === previewSig) return
    prevSig.current = previewSig
    const t = setTimeout(() => setPreviewKey((k) => k + 1), 600)
    return () => clearTimeout(t)
  }, [previewSig])
  const aiSuggestedName = ai && ai.signType ? (matchSignType(ai.signType)?.n || null) : null
  const goto = (s) => setStep(s)
  const next = () => goto(flow[flowIndex + 1])
  const back = () => (flowIndex > 0 ? goto(flow[flowIndex - 1]) : navigate(exitTo))
  const proposalRef = useRef(null)   // LAST-page Proposal, for capturing the version snapshot image
  const multiPreviewRef = useRef(null)   // wraps all stacked pages — captured whole for the version image

  // Persist the shared payment link (top-level, one per quote) without touching parts or hooks.
  const savePaymentLink = async (url) => {
    setPaymentLink(url)
    const payload = { ...(gdRef.current || {}), payment_link: url }
    gdRef.current = payload
    setGd(payload)
    await putGenerated(quoteId, payload)
  }
  const [cpBusy, setCpBusy] = useState('')
  const [cpMsg, setCpMsg] = useState('')

  const saveAndReturn = async () => { await saveProgress(); navigate(exitTo) }   // #4 (top-bar action)

  // Manual checkpoint: flush pending edits, then mint {quote_id}-rev{n} with the rendered proposal
  // image. Same version boundary a payment creates — for saving a version without taking a payment.
  const saveCheckpoint = async () => {
    setCpBusy('1'); setCpMsg('')
    try {
      await saveProgress()   // ensure the latest edits are recorded as changes before the checkpoint
      let img = null
      try { img = await proposalRef.current?.captureSnapshot?.() } catch { /* image optional */ }
      const cp = await createCheckpoint(quoteId, img)
      setCpMsg('Saved ' + (cp?.label || 'checkpoint'))
      setTimeout(() => setCpMsg(''), 4000)
    } catch (e) {
      setCpMsg(e?.response?.data?.error || 'Could not save checkpoint.')
    } finally { setCpBusy('') }
  }

  // Snapshot the wizard hooks into the ACTIVE part's shape. proposal_state is owned by the
  // Proposal component (it flows in via `extra`), so we keep the part's existing proposal_state
  // unless a fresh one is supplied. Any part-level key passed in `extra` overrides the hook value.
  const partFromHooks = (prev = {}, extra = {}) => {
    const p = {
      ...prev,
      quote_type: mode,
      tpl_name: tpl?.n || null,
      tpl_stored_spec: tpl?.storedSpec || null,
      answers,
      ai,
      custom_spec: customSpec,
      artwork_path: (artworkPath && !artworkPath.startsWith('blob:') && !artworkPath.startsWith('data:')) ? artworkPath : null,
      side_views: sideViews,
      sign_box: signBox,
      proposal_notes: proposalNotes,
    }
    for (const k of PART_KEYS) if (extra[k] !== undefined) p[k] = extra[k]
    return p
  }

  // Keys in `extra` that belong to the whole quote, not one part.
  const SHARED_KEYS = ['payment_link', 'job_name']

  const saveProgress = async (extra = {}) => {
    // fold the live wizard hooks (+ any part-level extra) into the active part; leave the rest as-is
    const base = partsRef.current.length ? partsRef.current : [{}]
    const nextParts = base.map((p, i) => (i === activePart ? partFromHooks(p, extra) : p))
    const shared = {}
    for (const k of SHARED_KEYS) if (extra[k] !== undefined) shared[k] = extra[k]

    const payload = {
      ...(gdRef.current || {}),
      quote_type: mode,
      job_name: client.job_name,
      payment_link: paymentLink,
      parts: nextParts,
      // Top-level mirror of the FIRST part — the backend's price fallback and readers that
      // haven't moved to `parts` yet (payment link, quick view) still see a valid single sign.
      // Removed once every reader iterates parts.
      ...legacyPartFromGd(nextParts[0] || {}),
      ...shared,
    }
    partsRef.current = nextParts; gdRef.current = payload   // sync before the async write
    setParts(nextParts)
    setGd(payload)
    await putGenerated(quoteId, payload)
    // refresh dashboard/list so quote_type + price reflect the saved progress
    qc.invalidateQueries({ queryKey: ['quotes'] })
    qc.invalidateQueries({ queryKey: ['dashboard'] })
  }

  // Persist a patch to ONE part (used by the preview, where each page edits itself directly, not
  // through the wizard hooks). Does NOT fold the hooks — only touches parts[i].
  const savePart = async (i, patch) => {
    const nextParts = partsRef.current.map((p, idx) => (idx === i ? { ...p, ...patch } : p))
    const payload = { ...(gdRef.current || {}), parts: nextParts, ...legacyPartFromGd(nextParts[0] || {}) }
    partsRef.current = nextParts; gdRef.current = payload
    setParts(nextParts)
    setGd(payload)
    await putGenerated(quoteId, payload)
    qc.invalidateQueries({ queryKey: ['quotes'] })
    qc.invalidateQueries({ queryKey: ['dashboard'] })
  }

  // One part's dollar total (mirrors the backend partTotal): unit×qty + extra line items.
  const partAmount = (p) => {
    const priceRaw = p?.custom_spec?.price ?? p?.answers?.price
    const price = Number(priceRaw) || 0
    const qRaw = parseInt(p?.proposal_state?.__qty ?? p?.custom_spec?.qty ?? p?.answers?.qty ?? 1, 10)
    const q = Number.isFinite(qRaw) && qRaw > 0 ? qRaw : 1
    const extras = (Array.isArray(p?.proposal_state?.__items) ? p.proposal_state.__items : [])
      .reduce((s, it) => s + Math.max(0, Number(it.qty) || 0) * Math.max(0, Number(it.unit) || 0), 0)
    return price * q + extras
  }
  const grandTotal = parts.reduce((s, p) => s + partAmount(p), 0)

  // Rebuild a part's tpl object from its saved name (catalog entry, or a synthesized custom one).
  const tplForPart = (p) => (p?.tpl_name ? (T.find((t) => t.n === p.tpl_name) || makeCustomTpl(p.tpl_name, p.tpl_stored_spec || null)) : null)

  // Every page's Proposal instance, keyed by its stable part id — so the last page can pull a
  // clean product image from EVERY sign when it creates the combined payment link.
  const pageRefs = useRef({})

  // One sign's title for the combined payment link, WITHOUT the trailing "FOR {company}" (added
  // once at the end so "Signarama" appears a single time — Sami's rule #2).
  const signTitleOf = (p) => {
    const company = client.company_name || ''
    let d = p?.custom_spec?.itemDesc || tplForPart(p)?.desc || 'SIGN'
    if (company) {
      const esc = company.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      d = d.replace(new RegExp('\\s*FOR\\s+' + esc + '\\s*$', 'i'), '')
    }
    return d.trim() || 'SIGN'
  }
  const linkTitle = (() => {
    const company = client.company_name || ''
    return parts.map(signTitleOf).join(' & ') + (company ? ' FOR ' + company : '')
  })()

  // Clean product image for EVERY sign, in page order (skips any that fail to render).
  const collectPartImages = async () => {
    const imgs = []
    for (const p of parts) {
      const el = pageRefs.current[p.__pid]
      if (el?.captureCleanImage) { try { imgs.push(await el.captureCleanImage()) } catch { /* skip a bad page */ } }
    }
    return imgs
  }

  // Load a saved part into the wizard hooks (so the wizard / Edit specs edits THAT part).
  const loadPartIntoHooks = (p = {}) => {
    setTpl(tplForPart(p))
    setAnswers(p.answers || {})
    setAi(p.ai || null)
    setCustomSpec(p.custom_spec || null)
    setArtworkPath(p.artwork_path || null)
    setSignBox(p.sign_box || null)
    setSideViews(p.side_views || [])
    setProposalNotes(p.proposal_notes || '')
    setCustomTypeSel(''); setTypePicking(false); setTypeGroup(null)
  }

  // "+ Add page": save the current part, append a fresh blank part, and re-enter the wizard at the
  // sign-type/specs step for it. Company/client are shared, so those steps are skipped.
  const addPage = async () => {
    await saveProgress()   // fold the active part's live hooks in first
    const nextParts = [...partsRef.current, { __pid: `p${Date.now()}_${Math.random().toString(36).slice(2, 6)}` }]
    const newIndex = nextParts.length - 1
    const payload = { ...(gdRef.current || {}), parts: nextParts }
    partsRef.current = nextParts; gdRef.current = payload
    setParts(nextParts)
    setGd(payload)
    setActivePart(newIndex)
    loadPartIntoHooks({})                       // blank scratch buffer for the new sign
    await putGenerated(quoteId, payload)
    setStep(mode === 'custom' ? 'customspecs' : 'signtype')
  }

  // Delete one page (only offered when >1). Letters (A/B/…) are index-derived, so they resync
  // automatically; the active part is clamped and reloaded so the wizard stays coherent.
  const deletePage = async (i) => {
    if (partsRef.current.length <= 1) return
    const nextParts = partsRef.current.filter((_, idx) => idx !== i)
    const payload = { ...(gdRef.current || {}), parts: nextParts, ...legacyPartFromGd(nextParts[0] || {}) }
    partsRef.current = nextParts; gdRef.current = payload
    setParts(nextParts)
    setGd(payload)
    const newActive = Math.min(activePart, nextParts.length - 1)
    setActivePart(newActive)
    loadPartIntoHooks(nextParts[newActive])
    await putGenerated(quoteId, payload)
    qc.invalidateQueries({ queryKey: ['quotes'] })
    qc.invalidateQueries({ queryKey: ['dashboard'] })
  }

  // --- step handlers ---
  const saveClient = async () => {
    await updateQuote(quoteId, client)
    await saveProgress()        // also persists the payment link
    next()
  }
  // Upload + persist a chosen/edited artwork File (shared by the file picker and the crop tool #5).
  const commitArtworkFile = async (f) => {
    if (!f) return
    setArtErr('')
    setArtworkPath(URL.createObjectURL(f))   // show the picked image immediately, straight from the local file
    try {
      const path = await uploadArtwork(quoteId, f)
      setArtworkPath(path)                          // swap to the saved server copy
      // A NEW image must fit fresh: drop the previous artwork crop geometry + sign box, otherwise
      // the old crop window is applied to the new picture and it looks "picked wrong".
      const ps = parts[activePart]?.proposal_state
      const cleanPs = ps?.__layout?.artwork
        ? { ...ps, __layout: (() => { const l = { ...ps.__layout }; delete l.artwork; return l })() }
        : ps
      setSignBox(null)
      // artwork_auto:false — the rep chose this file; no re-read may ever replace it
      await saveProgress({ artwork_path: path, artwork_auto: false, proposal_state: cleanPs, sign_box: null })
    } catch (err) {
      setArtErr('Shown locally, but the server upload failed: ' + (err.response?.data?.message || err.message || 'unknown error'))
    }
  }
  const onArtwork = (e) => commitArtworkFile(e.target.files[0])
  const onCustomerFile = async (e) => {
    const f = e.target.files[0]; if (!f) return
    const path = await uploadCustomerFile(quoteId, f)
    setQuote((qd) => ({ ...qd, customer_pdf: path }))
    // if it's an image, flow it straight to the proposal artwork too (#10)
    if (/\.(png|jpe?g|gif|webp|svg)$/i.test(path)) setArtworkPath(path)
    // a replaced file means the old reading is stale — re-read automatically with the NEW file
    if (mode === 'generator' && !aiLoading) runAI(path)
  }
  // pdfOverride: pass the just-uploaded path so a replace re-reads the NEW file (state is async)
  const runAI = async (pdfOverride = null) => {
    const drawing = (typeof pdfOverride === 'string' && pdfOverride) || quote?.customer_pdf
    setAiLoading(true)
    setAiStatus('Reading customer details and generating specifications…')
    try {
      await updateQuote(quoteId, { special_requirements: special })
      // vector/CAD PDFs carry no extractable text — render page 1 to an image so vision can read it.
      // (Images and Cloudinary files are read server-side now, straight from their URL.)
      let imageData = null
      let artPath = artworkPath
      if (drawing && (isCloudDoc(drawing) || /\.pdf$/i.test(drawing))) {
        setAiStatus('Rendering the drawing for the AI…')
        let dataUrl = null
        if (isCloudDoc(drawing)) {
          // Cloudinary-stored PDF/AI: let the CDN rasterize page 1 to a PNG (no pdf.js needed)
          try {
            const blob = await (await fetch(cloudRaster(drawing, 1200))).blob()
            dataUrl = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob) })
          } catch { dataUrl = null }
        } else {
          dataUrl = await rasterizePdf(fileUrl(drawing))
        }
        if (dataUrl) {
          imageData = dataUrl.split(',')[1]
        }
        setAiStatus('Reading the drawing and generating specifications…')
      }
      const result = await generateSpecs(quoteId, special, SIDE_VIEWS.map((s) => s.key).join(','), imageData)
      setAi(result)
      // Artwork picks itself: the AI locates the sign rendering inside the drawing (artworkBox)
      // and we upload just that crop — full page only as the fallback. Also upgrades the case
      // where the raw document image was used as artwork.
      let pageUrl = (typeof imageData === 'string' && imageData) ? 'data:image/png;base64,' + imageData : null
      if (!pageUrl && drawing && /\.(png|jpe?g|gif|webp)$/i.test(drawing)) {
        try { pageUrl = await urlToDataUrl(fileUrl(drawing)) } catch { pageUrl = null }
      }
      // Re-crop is allowed when there's no artwork yet, when the artwork is just the raw
      // document, or when WE auto-set it on a previous read (artwork_auto) — a re-read must
      // re-pick. Only a rep's own manual upload is never touched.
      let croppedApplied = false
      if (pageUrl && (!artworkPath || artworkPath === drawing || gd?.artwork_auto)) {
        try {
          const cropped = await cropToBox(pageUrl, result?.artworkBox)
          const blob = await (await fetch(cropped)).blob()
          const isJpeg = cropped.startsWith('data:image/jpeg')
          const path = await uploadArtwork(quoteId, new File([blob], isJpeg ? 'drawing.jpg' : 'drawing.png', { type: blob.type }))
          artPath = path; setArtworkPath(path); croppedApplied = true
        } catch { if (!artworkPath) setArtworkPath(pageUrl) }
      }
      // snap AI signType to the closest catalog entry (robust match)
      const found = matchSignType(result.signType)
      if (found) setTpl(found)
      // #7: the retail company is OUR client (company_name); the drawing's "Client:" = end customer (client_name).
      // Fill + persist every party field the AI found, without clobbering anything the user already typed.
      const prefill = {}
      if (result.companyName && !client.company_name) prefill.company_name = result.companyName
      if (result.endCustomer && !client.client_name) prefill.client_name = result.endCustomer
      if (result.contact && !client.contact) prefill.contact = result.contact
      if (result.address && !client.address) prefill.address = result.address
      if (result.jobName && !client.job_name) prefill.job_name = result.jobName
      if (Object.keys(prefill).length) {
        setClient((c) => ({ ...c, ...prefill }))
        updateQuote(quoteId, prefill).catch(() => {})
      }
      // hybrid side-view: deterministic map (by sign type) fused with the Groq-vision suggestion
      const sv = pickSideView(found?.n || result.signType, result.sideViewKey, result.sideViewConfidence || 0)
      const svSel = sv.selected ? [sv.selected] : []
      if (sv.selected) setSideViews(svSel)
      // Persist the AI result NOW, so reopening/edit-back keeps the specs, sign type and side view
      // instead of losing them (the old code saved AI only at a much later step).
      await saveProgress({
        ai: result,
        tpl_name: found?.n || null,
        side_views: svSel,
        job_name: prefill.job_name || client.job_name || '',
        artwork_path: (artPath && !artPath.startsWith('blob:') && !artPath.startsWith('data:')) ? artPath : null,
        artwork_auto: croppedApplied ? true : (gd?.artwork_auto || false),
      })
      setAiStatus('')
    } catch (err) {
      setAiStatus('⚠ AI generation failed: ' + (err.response?.data?.error || err.message))
    } finally {
      setAiLoading(false)
    }
  }

  // Auto-run AI when arriving from Add Quote → AI Mode
  useEffect(() => {
    if (autoAi && step === 'project' && !aiLoading && !ai) {
      setAutoAi(false)
      runAI()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoAi, step])

  // When the drawing viewer opens, check the file is actually on the server (older uploads can be gone)
  useEffect(() => {
    if (!showDrawing || !quote?.customer_pdf) return
    setDrawingOk(null)
    fetch(fileUrl(quote.customer_pdf), { method: 'HEAD' })
      .then((r) => setDrawingOk(r.ok))
      .catch(() => setDrawingOk(false))
  }, [showDrawing, quote?.customer_pdf])

  // Pick a sign type → go straight to its questions (one click, no separate Next button).
  // Re-picking the SAME type keeps the answers already entered (fixes edit-back wiping specs).
  const pickSign = (t) => {
    if (tpl?.n === t.n) { goto('specs'); return }
    setTpl(t)
    setAnswers(ai ? autoAnswerFromAI(t, ai) : {})
    // a different sign type makes any saved spec text wrong — drop it so the proposal
    // rebuilds the SPECIFICATIONS block for the new type (other proposal edits are kept)
    setGd((g) => {
      if (!g?.proposal_state?.specBody) return g
      const ps = { ...g.proposal_state }
      delete ps.specBody
      ps.__dirty = (ps.__dirty || []).filter((k) => k !== 'specBody')
      return { ...g, proposal_state: ps }
    })
    goto('specs')
  }

  const finishSpecs = (finalAnswers) => { setAnswers(finalAnswers) }
  const toPreview = async () => {
    setSaving(true)
    try { await updateQuote(quoteId, { special_requirements: special }) } catch { /* non-fatal */ }
    await saveProgress()
    setSaving(false)
    goto('preview')
  }

  // save the current step, then advance to the NEXT step in the flow (not straight to preview)
  const saveNext = async () => {
    setSaving(true)
    try { await updateQuote(quoteId, { special_requirements: special }) } catch { /* non-fatal */ }
    // the wizard's Quantity is authoritative when you pass THROUGH the wizard — push it into the
    // proposal state too, else a previously saved __qty silently outranks the field forever (#5)
    const wq = parseInt(customSpec?.qty, 10)
    await saveProgress(Number.isFinite(wq) && wq > 0
      ? { proposal_state: { ...(parts[activePart]?.proposal_state || {}), __qty: wq } }
      : {})
    setSaving(false)
    next()
  }

  // typed custom sign type (AI mode) — use it AND save the name to the team catalog so it
  // shows up in both modes from now on
  const useTypedSignType = () => {
    if (!customType.trim()) return
    const NAME = customType.trim().toUpperCase()
    saveCatalogItem('sign_type', NAME, {}).then((item) => setSignLib((l) => [...l.filter((x) => x.name !== NAME), item])).catch(() => {})
    pickSign(makeCustomTpl(NAME))
  }

  // ---- custom (manual) mode helpers ----
  // load the team's saved custom sign types once (shared with AI mode's sign list)
  useEffect(() => { listCatalog('sign_type').then(setSignLib).catch(() => {}) }, [])

  // one dimension box changed → recompose the canonical H×W×D string AND keep the spec text's
  // dimensions / returns / thickness lines in sync, so the proposal can never show different
  // numbers than the boxes (#9). The D box also drives the depth in RETURNS / LETTERS THICKNESS (#6).
  const setCustomDim = (part, v) => {
    setCustomSpec((cs) => {
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
          .replace(/^(RETURNS?\s*:\s*)(?:[\d.\/]+["”]\s*)?/im, `$1${p.h}" `)
          .replace(/^(LETTERS? THICKNESS\s*:\s*).*$/im, `$1${p.h}"`)
      }
      return { ...cs, dims, specText }
    })
  }

  // Picking a sign type prefills its template spec — that template must immediately inherit the
  // dims/depth/application ALREADY typed (the "RETURNS: 3 while depth is 1" flaw): the boxes are
  // the source of truth, the template only supplies the missing lines.
  const syncSpecFromFields = (specText, cs) => {
    const p = parseDims(cs?.dims)
    const dims = composeDims(p.l, p.w, p.h)
    let s = specText || ''
    if (dims.trim()) {
      s = /^(.*DIMENSIONS[^:]*):.*$/im.test(s)
        ? s.replace(/^(.*DIMENSIONS[^:]*):.*$/im, `$1: ${dims}`)
        : (/^SIGN TYPE\s*:.*$/im.test(s) ? s.replace(/^(SIGN TYPE\s*:.*)$/im, `$1\nOVERALL DIMENSIONS: ${dims}`) : `OVERALL DIMENSIONS: ${dims}\n` + s)
    }
    if (p.h) {
      s = s.replace(/^(RETURNS?\s*:\s*)(?:[\d.\/]+["”]\s*)?/im, `$1${p.h}" `)
           .replace(/^(LETTERS? THICKNESS\s*:\s*).*$/im, `$1${p.h}"`)
    }
    const app = cs?.application
    if (app) {
      s = /^APPLICATION\s*:.*$/im.test(s) ? s.replace(/^(APPLICATION\s*:\s*).*$/im, `$1${app}`) : s
    }
    return s
  }

  // the interior/exterior choice must land in the spec's APPLICATION line too (#6)
  const setCustomApplication = (app) => {
    setCustomSpec((cs) => {
      let specText = cs?.specText || ''
      specText = /^APPLICATION\s*:.*$/im.test(specText)
        ? specText.replace(/^(APPLICATION\s*:\s*).*$/im, `$1${app}`)
        : (specText.trim() ? specText.replace(/\s*$/, '') + `\nAPPLICATION: ${app}` : specText)
      return { ...cs, application: app, specText }
    })
  }

  // manual mode still has the customer's drawing — read the dimensions off it automatically
  // (once) when they haven't been entered yet, instead of making the rep squint at the PDF
  useEffect(() => {
    if (step !== 'customspecs' || customDimsTried.current) return
    if (!quote?.customer_pdf || String(customSpec?.dims || '').trim() !== '') return
    customDimsTried.current = true
    ;(async () => {
      try {
        setCustomDimsStatus('⚡ reading the drawing…')
        let imageData = null
        if (isCloudDoc(quote.customer_pdf)) {
          const blob = await (await fetch(cloudRaster(quote.customer_pdf, 1200))).blob()
          const dataUrl = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob) })
          imageData = String(dataUrl).split(',')[1]
        } else if (/\.pdf$/i.test(quote.customer_pdf)) {
          const dataUrl = await rasterizePdf(fileUrl(quote.customer_pdf))
          if (dataUrl) imageData = dataUrl.split(',')[1]
        }
        const result = await generateSpecs(quoteId, special, '', imageData)
        if (result?.dimensions) {
          const p = parseDims(result.dimensions)
          setCustomSpec((cs) => ({ ...cs, dims: composeDims(p.l, p.w, p.h) }))
          setCustomDimsStatus('⚡ read from the drawing')
        } else {
          setCustomDimsStatus('')
        }
      } catch { setCustomDimsStatus('') }
    })()
  }, [step, quote?.customer_pdf]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <div className="center">Loading…</div>

  if (loadError) return (
    <div className="center" style={{ flexDirection: 'column', gap: 14 }}>
      <h2 style={{ margin: 0 }}>{loadError === 'notfound' ? "This quote doesn't exist" : "Couldn't load this quote"}</h2>
      <p className="muted" style={{ margin: 0, textAlign: 'center', maxWidth: 420 }}>
        {loadError === 'notfound'
          ? 'The quote may have been deleted, or the link is out of date.'
          : 'Something went wrong reaching the server. Check your connection and try again.'}
      </p>
      <button onClick={() => navigate(exitTo)}>← Back</button>
    </div>
  )

  // mode picker (#55) — DORMANT (#8): AI mode is paused, so we never ask; the loader resolves
  // every quote to a mode (custom by default). Restore this block + the null fallback above to
  // bring the AI generator back.
  // if (!mode) {
  //   return (
  //     <div className="center" style={{ flexDirection: 'column', gap: 16 }}>
  //       <h2>How do you want to build {quoteId}?</h2>
  //       <div style={{ display: 'flex', gap: 16 }}>
  //         <button onClick={() => { setMode('generator'); setStep('project') }}>Quote Generator (AI)</button>
  //         <button className="ghost" onClick={() => { setMode('custom'); setStep('customspecs') }}>Custom Quote Creator</button>
  //       </div>
  //     </div>
  //   )
  // }
  if (!mode) return <div className="center">Loading…</div>

  return (
    <>
      {/* NO top bar anywhere (#5): the wizard controls always sit right above the proposal —
          inside the preview step, and on earlier steps above the live-preview column (or at the
          top of the step card when the live preview is hidden). */}

      {/* Back on the proposal asks what to do with the quote (#3): keep it or delete it entirely */}
      {exitAsk && (
        <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setExitAsk(false)}>
          <div className="modal" style={{ width: 420 }}>
            <h2 style={{ marginTop: 0 }}>Leave this quote?</h2>
            <p className="muted" style={{ fontSize: 13.5 }}>Save it (everything is kept, you can come back any time){admin ? ', or delete the quote entirely — this cannot be undone' : ''}.</p>
            <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
              <button disabled={saving} onClick={async () => { setExitAsk(false); await saveAndReturn() }}>💾 Save &amp; leave</button>
              {admin && (
                <button className="ghost" style={{ color: '#e5484d', borderColor: '#e5484d' }} disabled={saving}
                  onClick={async () => {
                    try { await deleteQuote(quoteId); qc.invalidateQueries({ queryKey: ['quotes'] }); navigate('/quotes') }
                    catch (e) { alert(e?.response?.data?.error || 'Could not delete the quote.') }
                  }}>🗑 Delete quote</button>
              )}
              <button className="ghost" onClick={() => setExitAsk(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      <div className="page-head">
        <div>
          <h1>{mode === 'custom' ? 'Custom Quote Creator' : 'Quote Generator'}</h1>
          <div className="muted">{quoteId} — {quote?.company_name}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {quote?.customer_pdf && <button className="ghost" onClick={() => setShowDrawing(true)}>📎 View drawing</button>}
        </div>
      </div>

      {/* progress bar */}
      <div className="prog">
        {flow.map((s, i) => <div key={s} className={'prog-seg' + (i <= flowIndex ? ' done' : '')} />)}
      </div>

      <div className={'wizard' + (livePreview && step !== 'preview' ? ' wiz-cols' : '')} style={step === 'preview' ? { maxWidth: 'min(1180px, 96%)' } : livePreview ? { maxWidth: 'min(1500px, 97%)' } : undefined}>
       <div className="wiz-main">
        {step === 'client' && (
          <div className="step">
            <h3>Client Information</h3>
            {[['company_name', 'Company Name'], ['client_name', 'Client Name'], ['contact', 'Phone'], ['email', 'Email'], ['address', 'Address'], ['job_name', 'Job Name']].map(([k, label]) => (
              <div className="field" key={k}>
                <label>{label}</label>
                <input
                  type={k === 'email' ? 'email' : 'text'}
                  inputMode={k === 'contact' ? 'tel' : undefined}
                  placeholder={k === 'contact' ? 'digits only' : k === 'email' ? 'name@company.com' : ''}
                  value={client[k] || ''}
                  onChange={(e) => setClient({ ...client, [k]: k === 'contact' ? e.target.value.replace(/[^0-9()+\-.\s]/g, '') : e.target.value })}
                />
              </div>
            ))}
            <div className="field">
              <label>Sales Representative</label>
              {admin ? (() => {
                const custom = repOther || (client.sales_rep && !reps.includes(client.sales_rep))
                return (
                  <>
                    <select
                      value={custom ? '__other__' : client.sales_rep}
                      onChange={(e) => {
                        if (e.target.value === '__other__') { setRepOther(true); setClient({ ...client, sales_rep: '' }) }
                        else { setRepOther(false); setClient({ ...client, sales_rep: e.target.value }) }
                      }}
                    >
                      <option value="">— select —</option>
                      {reps.map((r) => <option key={r} value={r}>{r}</option>)}
                      <option value="__other__">Other (type a name)…</option>
                    </select>
                    {custom && (
                      <input style={{ marginTop: 8 }} placeholder="Type the sales rep's name" autoFocus
                        value={client.sales_rep} onChange={(e) => setClient({ ...client, sales_rep: e.target.value })} />
                    )}
                  </>
                )
              })() : (<input value={client.sales_rep || '—'} disabled />)}
            </div>
            {/* payment link is created later on the proposal via Shopify (#2) — not asked up front */}
            <div className="foot">
              <span />{/* Back moved to the top-left bar (#4) */}
              <button onClick={saveClient}>Next →</button>
            </div>
          </div>
        )}

        {step === 'project' && (
          <div className="step">
            <h3>{aiLoading ? 'Reading your upload(s)…' : 'Project'}</h3>
            <div className="field">
              {quote?.customer_pdf ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <button type="button" className="ghost sm" onClick={() => setShowDrawing(true)}>📎 View the customer's drawing</button>
                  <label className="muted" style={{ cursor: 'pointer', textDecoration: 'underline' }}>
                    Replace
                    <input type="file" accept=".pdf,image/*" style={{ display: 'none' }} onChange={onCustomerFile} />
                  </label>
                </div>
              ) : (
                <>
                  <label>Customer's drawing (optional)</label>
                  <input type="file" accept=".pdf,image/*" onChange={onCustomerFile} />
                </>
              )}
            </div>
            <div className="ai-box">
              {!ai
                ? <button onClick={runAI} disabled={aiLoading}>{aiLoading ? 'Reading…' : '⚡ Read the drawing with AI'}</button>
                : <span><b style={{ color: '#9ae6b4' }}>✔ Specs ready.</b><button className="ghost sm" style={{ marginLeft: 10 }} onClick={runAI} disabled={aiLoading}>{aiLoading ? 'Reading…' : '↻ Re-read'}</button></span>}
              {!ai && <span className="muted" style={{ marginLeft: 10 }}>Or skip and pick the sign type yourself.</span>}
              {aiStatus && <p className="muted" style={{ marginTop: 8 }}>{aiStatus}</p>}
              {ai && (
                <div className="ai-result">
                  {/* every field, always — '—' marks what the AI couldn't read (an empty box looked like nothing was retrieved) */}
                  {[['Our Client (retail)', ai.companyName], ['End Customer', ai.endCustomer], ['Sign Type', ai.signType], ['Job Name', ai.jobName], ['Dimensions', ai.dimensions],
                    ['Returns', ai.returns], ['Trim Cap', ai.trimcap], ['Mounting', ai.mounting], ['Illumination', ai.illumination],
                    ['Face Color', ai.faceColor], ['Return Color', ai.returnColor], ['Application', ai.application],
                    ['Price', ai.price != null ? '$' + ai.price : null], ['Notes', ai.notes]]
                    .map(([k, v]) => (
                      <div key={k} className="line">
                        <b>{k}:</b> <span style={v == null || v === '' ? { color: 'var(--text-faint)' } : undefined}>{v == null || v === '' ? '—' : String(v)}</span>
                      </div>
                    ))}
                  {ai.fullSpec && (
                    <details style={{ marginTop: 8 }}>
                      <summary style={{ cursor: 'pointer', color: 'var(--gold)', fontSize: 13 }}>Full reading from the drawing</summary>
                      <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 12.5, color: 'var(--text-dim)', marginTop: 6 }}>{ai.fullSpec}</pre>
                    </details>
                  )}
                </div>
              )}
            </div>
            <div className="foot"><span />{/* Back moved to the top-left bar (#4) */}<button onClick={() => goto('signtype')}>Next →</button></div>
          </div>
        )}

        {step === 'signtype' && (
          <div className="step">
            <h3>Select Sign Type</h3>
            <input placeholder="Search sign types…" value={signSearch} onChange={(e) => setSignSearch(e.target.value)} style={{ marginBottom: 12 }} />
            <p className="muted" style={{ marginTop: -4, marginBottom: 10 }}>
              {signSearch.trim() || signGroup ? 'Click a sign type to continue.' : 'Pick a main sign category first (#5) — searching skips straight to the types.'}
            </p>
            {/* two-level picker (#5): main categories → the specific types inside the chosen one.
                Searching bypasses the grouping and filters ALL types flat. */}
            {!signSearch.trim() && !signGroup ? (
              <div className="sign-list">
                {tpl?.customType && (
                  <div className="sign-opt sel" onClick={() => pickSign(tpl)}>{tpl.n}  ✏️ your custom type</div>
                )}
                {SIGN_GROUP_ORDER.map((g) => {
                  const count = T.filter((t) => signGroupOf(t.n) === g).length
                  return count ? (
                    <div key={g} className="sign-opt" onClick={() => setSignGroup(g)} style={{ fontWeight: 700 }}>
                      {g} <span className="muted" style={{ fontWeight: 400 }}>· {count} types →</span>
                    </div>
                  ) : null
                })}
                {signLib.length > 0 && (
                  <div className="sign-opt" onClick={() => setSignGroup('__team__')} style={{ fontWeight: 700 }}>
                    TEAM'S CUSTOM TYPES <span className="muted" style={{ fontWeight: 400 }}>· {signLib.length} types →</span>
                  </div>
                )}
              </div>
            ) : (
              <>
                {!signSearch.trim() && (
                  <button className="ghost sm" style={{ marginBottom: 10 }} onClick={() => setSignGroup(null)}>← All categories</button>
                )}
                <div className="sign-list">
                  {tpl?.customType && (
                    <div className="sign-opt sel" onClick={() => pickSign(tpl)}>{tpl.n}  ✏️ your custom type</div>
                  )}
                  {T.filter((t) => (signSearch.trim()
                      ? t.n.toLowerCase().includes(signSearch.toLowerCase())
                      : signGroupOf(t.n) === signGroup)).map((t) => (
                    <div
                      key={t.n}
                      className={'sign-opt' + (tpl?.n === t.n ? ' sel' : '') + (aiSuggestedName === t.n ? ' ai' : '')}
                      onClick={() => pickSign(t)}
                    >
                      {t.n}{aiSuggestedName === t.n ? '  ⚡ AI suggested' : ''}
                    </div>
                  ))}
                  {signLib.filter((s) => (signSearch.trim()
                      ? s.name.toLowerCase().includes(signSearch.toLowerCase())
                      : signGroup === '__team__')).map((s) => (
                    <div
                      key={'lib' + s.id}
                      className={'sign-opt' + (tpl?.n === s.name ? ' sel' : '')}
                      onClick={() => pickSign(makeCustomTpl(s.name, s.data?.spec || null))}
                    >
                      {s.name}  ✏️ team custom type
                    </div>
                  ))}
                </div>
              </>
            )}
            <div className="field" style={{ marginTop: 14 }}>
              <label>Can't find it? Type the sign type yourself (it gets saved for the whole team)</label>
              <div style={{ display: 'flex', gap: 10 }}>
                <input
                  placeholder="e.g. CHANNEL LETTERS WITH BACKER"
                  value={customType}
                  onChange={(e) => setCustomType(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && customType.trim()) useTypedSignType() }}
                />
                <button disabled={!customType.trim()} onClick={useTypedSignType}>Use this type →</button>
              </div>
            </div>
            <div className="foot">
              <span />{/* Back moved to the top-left bar (#4) */}
            </div>
          </div>
        )}

        {step === 'specs' && tpl && (() => {
          // dimensions are mandatory (#3): require both primary parts (H + W) actually filled,
          // read from the raw fields so a collapsed composed string can't sneak through.
          const noDims = !String(answers.dim_l ?? '').trim() || !String(answers.dim_w ?? '').trim()
          const priceNum = Number(answers.price)
          const overMax = Number.isFinite(priceNum) && priceNum > MAX_PRICE
          const badPrice = String(answers.price ?? '').trim() === '' || !Number.isFinite(priceNum) || priceNum <= 0 || overMax
          const hint = noDims ? 'Enter the dimensions to continue' : overMax ? `Maximum quote price is $${MAX_PRICE.toLocaleString()}` : badPrice ? 'Enter a real price (more than $0) to continue' : ''
          return (
            <div className="step">
              <h3>Specifications — {tpl.n}</h3>
              <QA tpl={tpl} ai={ai} initialAnswers={answers} onComplete={finishSpecs} />
              <div className="foot">
                <span />{/* Back moved to the top-left bar (#4) */}
                {hint && <span style={{ color: 'var(--text-faint)', fontSize: 12, alignSelf: 'center' }}>{hint}</span>}
                <button disabled={!Object.keys(answers).length || noDims || badPrice} onClick={() => next()}>Next: Upload Artwork →</button>
              </div>
            </div>
          )
        })()}

        {step === 'artwork' && (
          <div className="step">
            <h3>Artwork &amp; Notes</h3>
            {cropping && artworkPath ? (
              // #5 — crop/edit on THIS bigger canvas (easier than the small preview-page crop)
              <ArtworkCropper
                src={fileUrl(artworkPath)}
                busy={saving}
                initialBox={signBox}
                onCancel={() => setCropping(false)}
                onApply={async (file) => { await commitArtworkFile(file); setSignBox(null); await saveProgress({ sign_box: null }); setCropping(false) }}
                onMark={async (box) => { setSignBox(box); await saveProgress({ sign_box: box }); setCropping(false); }}
              />
            ) : (<>
            {/* the whole area is clickable — clicking it opens the file picker (#21) */}
            <div
              onClick={() => artInput.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) onArtwork({ target: { files: [f] } }) }}
              style={{ cursor: 'pointer', border: '2px dashed var(--border)', borderRadius: 10, padding: 16, textAlign: 'center', background: 'var(--navy-900)', maxWidth: 380 }}
              title="Click to pick artwork from your computer (or drop a file here)"
            >
              {artworkPath
                ? <img src={fileUrl(artworkPath)} alt="artwork" onError={(e) => { e.currentTarget.style.display = 'none'; setArtErr('The saved artwork could not be loaded — please re-upload it.') }} style={{ maxWidth: '100%', display: 'block', margin: '0 auto', borderRadius: 8 }} />
                : <div style={{ color: 'var(--text-dim)', padding: '24px 8px' }}><div style={{ fontSize: 26 }}>🖼️</div>Click to choose artwork<div style={{ fontSize: 11, marginTop: 4 }}>or drop an image here</div></div>}
              <div style={{ fontSize: 11, color: 'var(--gold)', marginTop: 8 }}>{artworkPath ? 'Click to replace' : ''}</div>
            </div>
            {artworkPath && <button className="ghost" style={{ marginTop: 10 }} onClick={() => { setArtErr(''); setCropping(true) }}>✂ Crop / edit image</button>}
            </>)}
            <input ref={artInput} type="file" accept="image/*" style={{ display: 'none' }} onChange={onArtwork} />
            {artErr && <p style={{ color: '#ff6b6b', fontSize: 13, marginTop: 8 }}>{artErr}</p>}
            <div className="field" style={{ marginTop: 18 }}>
              <label>Notes for the proposal (anything special not already on the drawing)</label>
              <textarea rows={3} value={proposalNotes} onChange={(e) => setProposalNotes(e.target.value)} placeholder="e.g. install timeline, special finish, access notes…" />
            </div>
            <div className="foot">
              <span />{/* Back moved to the top-left bar (#4) */}
              <button className="ghost" onClick={() => { setArtworkPath(null); toPreview() }}>Skip artwork</button>
              <button onClick={toPreview}>{saving ? 'Saving…' : 'Next →'}</button>
            </div>
          </div>
        )}

        {step === 'customspecs' && (
          <div className="step">
            <h3>Custom Specifications</h3>
            <div className="field">
              <label>Sign type</label>
              {/* Two-level, fully reversible picker (#2): main sign types first, then the
                  underlying types; "← Main sign types" walks back up at any point. */}
              {(() => {
                const pickCustomType = (v) => {
                  setCustomTypeSel(v)
                  setTypePicking(false); setTypeGroup(null)
                  if (v === '' || v === '__new__') return
                  const cat = T.find((t) => t.n === v)
                  const stored = signLib.find((s) => s.name === v)
                  // the template inherits whatever dims/depth/application are already typed —
                  // the boxes are the source of truth (fixes RETURNS not matching the D box)
                  const specText = syncSpecFromFields(
                    cat ? buildSpecLines(cat, {}, null).join('\n') : (stored?.data?.spec || `SIGN TYPE: ${v}`),
                    customSpec
                  )
                  // the sign type implies its construction side view — pick it automatically
                  if (cat && sideViews.length === 0) {
                    const sv = pickSideView(cat.n)
                    if (sv?.selected) setSideViews([sv.selected])
                  }
                  setCustomSpec({
                    ...customSpec,
                    itemDesc: `${(cat?.desc || v)} FOR ${client.company_name || 'CUSTOMER'}`,
                    specText,
                    application: customSpec?.application || 'EXTERIOR',
                    price: customSpec?.price || '',
                  })
                }
                if (!typePicking) {
                  return (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <div style={{ flex: 1, border: '1px solid var(--border)', borderRadius: 8, padding: '9px 12px', background: 'var(--navy-900)' }}>
                        {customTypeSel && customTypeSel !== '__new__' ? customTypeSel : <span className="muted">— pick a sign type (prefills the spec) —</span>}
                      </div>
                      <button type="button" className="ghost sm" onClick={() => { setTypePicking(true); setTypeGroup(null) }}>
                        {customTypeSel ? 'Change' : 'Pick a type'}
                      </button>
                    </div>
                  )
                }
                return (
                  <div style={{ border: '1px dashed var(--border)', borderRadius: 8, padding: 10 }}>
                    {typeGroup == null ? (
                      <div className="sign-list">
                        {SIGN_GROUP_ORDER.map((g) => {
                          const c = T.filter((t) => signGroupOf(t.n) === g).length
                          return c ? (
                            <div key={g} className="sign-opt" style={{ fontWeight: 700 }} onClick={() => setTypeGroup(g)}>
                              {g} <span className="muted" style={{ fontWeight: 400 }}>· {c} types →</span>
                            </div>
                          ) : null
                        })}
                        {signLib.length > 0 && (
                          <div className="sign-opt" style={{ fontWeight: 700 }} onClick={() => setTypeGroup('__team__')}>
                            TEAM'S CUSTOM TYPES <span className="muted" style={{ fontWeight: 400 }}>· {signLib.length} →</span>
                          </div>
                        )}
                        <div className="sign-opt" onClick={() => pickCustomType('__new__')}>➕ Type a new sign type…</div>
                        <div className="sign-opt muted" onClick={() => { setTypePicking(false); setTypeGroup(null) }}>Cancel</div>
                      </div>
                    ) : (
                      <>
                        <button type="button" className="ghost sm" style={{ marginBottom: 8 }} onClick={() => setTypeGroup(null)}>← Main sign types</button>
                        <div className="sign-list">
                          {typeGroup === '__team__'
                            ? signLib.map((s) => (
                                <div key={'lib' + s.id} className={'sign-opt' + (customTypeSel === s.name ? ' sel' : '')} onClick={() => pickCustomType(s.name)}>{s.name} ✏️</div>
                              ))
                            : T.filter((t) => signGroupOf(t.n) === typeGroup).map((t) => (
                                <div key={t.n} className={'sign-opt' + (customTypeSel === t.n ? ' sel' : '')} onClick={() => pickCustomType(t.n)}>{t.n}</div>
                              ))}
                        </div>
                      </>
                    )}
                  </div>
                )
              })()}
            </div>
            {customTypeSel === '__new__' && (
              <div className="field" style={{ border: '1px dashed var(--border)', borderRadius: 8, padding: 12 }}>
                <label>New sign type name</label>
                <input placeholder="e.g. CHANNEL LETTERS WITH BACKER" value={newTypeName} onChange={(e) => setNewTypeName(e.target.value)} />
                <label style={{ marginTop: 10 }}>Its spec template (optional — paste one from a past quote; it gets saved for the whole team, in both modes)</label>
                <textarea rows={5} value={newTypeSpec} onChange={(e) => setNewTypeSpec(e.target.value)} placeholder={'SIGN TYPE: …\nFACE: …\nRETURNS: …'} />
                <button className="ghost sm" style={{ marginTop: 8 }} disabled={!newTypeName.trim()} onClick={async () => {
                  const NAME = newTypeName.trim().toUpperCase()
                  const spec = newTypeSpec.trim() || `SIGN TYPE: ${NAME}`
                  try { const item = await saveCatalogItem('sign_type', NAME, { spec }); setSignLib((l) => [...l.filter((x) => x.name !== NAME), item]) } catch { /* still usable locally */ }
                  setCustomSpec({ ...customSpec, itemDesc: `${NAME} FOR ${client.company_name || 'CUSTOMER'}`, specText: spec, application: customSpec?.application || 'EXTERIOR', price: customSpec?.price || '' })
                  setCustomTypeSel(NAME)
                  setNewTypeName(''); setNewTypeSpec('')
                }}>Save & use this type</button>
              </div>
            )}
            <div className="field"><label>Item Description</label><input value={customSpec?.itemDesc || ''} onChange={(e) => setCustomSpec({ ...customSpec, itemDesc: e.target.value })} /></div>
            <div className="grid2">
              <div className="field">
                <label>Overall dimensions (H × W × D){customDimsStatus ? `  ${customDimsStatus}` : ''}</label>
                <div className="dims-row">
                  {['l', 'w', 'h'].map((part, i) => (
                    <div className="dims-cell" key={part}>
                      <input type="text" inputMode="decimal" placeholder={['H', 'W', 'D'][i]}
                        value={parseDims(customSpec?.dims)[part] || ''}
                        onChange={(e) => setCustomDim(part, e.target.value)} />
                      {i < 2 && <span className="dims-x">×</span>}
                    </div>
                  ))}
                  <span className="dims-unit">in</span>
                </div>
              </div>
              <div className="field"><label>Price per unit (USD)</label><MoneyInput value={customSpec?.price || ''} onChange={(v) => setCustomSpec({ ...customSpec, price: v })} placeholder="e.g. 2500" /></div>
            </div>
            <div className="grid2">
              <div className="field">
                <label>Quantity</label>
                <input type="number" min="1" step="1" value={customSpec?.qty ?? 1}
                  onChange={(e) => { const n = parseInt(e.target.value, 10); setCustomSpec({ ...customSpec, qty: Number.isFinite(n) && n > 0 ? n : 1 }) }} />
              </div>
              <div className="field">
                <label>Total</label>
                <input disabled value={(() => { const t = (Number(customSpec?.price) || 0) * (parseInt(customSpec?.qty, 10) > 0 ? parseInt(customSpec?.qty, 10) : 1); return t > 0 ? '$' + t.toLocaleString() : '—' })()} />
              </div>
            </div>
            <div className="field">
              <label>Application</label>
              <select value={customSpec?.application || 'EXTERIOR'} onChange={(e) => setCustomApplication(e.target.value)}>
                <option value="EXTERIOR">EXTERIOR</option><option value="INTERIOR">INTERIOR</option>
              </select>
            </div>
            <div className="field"><label>Specification Text</label><textarea rows={10} value={customSpec?.specText || ''} onChange={(e) => setCustomSpec({ ...customSpec, specText: e.target.value })} /></div>
            <div className="field">
              <label>Special requirements (anything unusual about this job)</label>
              <textarea rows={2} value={special} onChange={(e) => setSpecial(e.target.value)} placeholder="e.g. rush order, special finish, permits…" />
            </div>
            <div className="foot">
              <span />{/* Back moved to the top-left bar (#4) */}
              {(() => {
                const n = Number(customSpec?.price)
                const overMax = Number.isFinite(n) && n > MAX_PRICE
                const badPrice = String(customSpec?.price ?? '').trim() === '' || !Number.isFinite(n) || n <= 0 || overMax
                const dp = parseDims(customSpec?.dims); const noDims = !dp.l || !dp.w
                const hint = noDims ? 'Enter the dimensions to continue' : overMax ? `Maximum quote price is $${MAX_PRICE.toLocaleString()}` : badPrice ? 'Enter a real price (more than $0) to continue' : ''
                return (
                  <>
                    {hint && <span style={{ color: 'var(--text-faint)', fontSize: 12, alignSelf: 'center' }}>{hint}</span>}
                    <button disabled={badPrice || noDims} onClick={saveNext}>{saving ? 'Saving…' : 'Next →'}</button>
                  </>
                )
              })()}
            </div>
          </div>
        )}

        {step === 'preview' && (
          <div className="step">
            {/* the wizard controls live right above the proposal (#2). "Done" saves a version
                (rev) with the rendered image (#4); Back asks save-or-delete (#3). "+ Add sign page"
                appends another sign to this quote (top-right of the preview canvas). */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <h3 style={{ margin: 0, marginRight: 6 }}>Proposal{parts.length > 1 ? ` — ${parts.length} signs` : ''}</h3>
              <button className="ghost sm" onClick={() => setExitAsk(true)}>← Back</button>
              <button className="ghost sm" onClick={() => (flowIndex > 0 ? goto(flow[flowIndex - 1]) : null)} title="Go back to the wizard steps (specs, artwork) without leaving">✎ Edit specs</button>
              {/* ONE finish button: Done = save everything, mint the version (rev + image), leave */}
              <button className="sm" disabled={!!cpBusy || saving}
                title="Save everything, record this version (rev with the rendered proposal image) and return"
                onClick={async () => { await saveCheckpoint(); navigate(exitTo) }}>
                {cpBusy ? 'Saving version…' : '✓ Done'}
              </button>
              <button className="ghost sm" style={{ marginLeft: 'auto' }} disabled={saving}
                title="Add another sign to this quote — one client, one combined total"
                onClick={addPage}>＋ Add sign page</button>
              {cpMsg && <span className="muted" style={{ fontSize: 12.5 }}>{cpMsg}</span>}
            </div>

            {/* one full proposal PAGE per sign part, stacked. Each page edits ITSELF (savePart);
                only the LAST page carries the combined total, downloads and payment. */}
            <div ref={multiPreviewRef} style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
              {parts.map((p, i) => {
                const isLast = i === parts.length - 1
                const multi = parts.length > 1
                // key includes letter + last-ness so a page REMOUNTS when those change (add/delete/
                // reorder) — its write-once proposal ID + price columns are recomputed correctly.
                const pageKey = `${p.__pid}|${multi ? partLetter(i) : 's'}|${isLast ? 'L' : '_'}`
                return (
                  <div key={pageKey} style={{ position: 'relative' }}>
                    {multi && (
                      <button className="ghost sm" onClick={() => deletePage(i)} disabled={saving}
                        title={`Delete sign page ${partLetter(i)}`}
                        style={{ position: 'absolute', top: 0, right: 0, zIndex: 5, color: '#e05661', borderColor: '#e05661' }}>
                        🗑 Delete page {partLetter(i)}
                      </button>
                    )}
                    <Proposal
                      ref={(el) => { pageRefs.current[p.__pid] = el; if (isLast) proposalRef.current = el }}
                      mode={p.quote_type || mode}
                      tpl={tplForPart(p)}
                      answers={p.answers || {}}
                      customSpec={p.custom_spec}
                      info={{ company: client.company_name, client: client.client_name, contact: client.contact, email: client.email, address: client.address, job: client.job_name, quoteId }}
                      quoteId={quoteId}
                      mainView
                      partLabel={multi ? partLetter(i) : null}
                      multi={multi}
                      isLast={isLast}
                      quoteTotal={multi ? grandTotal : null}
                      collectImages={multi ? collectPartImages : null}
                      linkTitle={multi ? linkTitle : null}
                      canCreatePaymentLinks={canCreatePaymentLinks}
                      onPaymentLinkCreated={(url) => savePaymentLink(url)}
                      artworkPath={p.artwork_path}
                      logo={logo}
                      aiResult={p.ai}
                      paymentLink={paymentLink}
                      approval={{ locked: quote?.approval_locked, approved: quote?.price_approved }}
                      proposalNotes={p.proposal_notes}
                      savedState={p.proposal_state}
                      sideViews={p.side_views || []}
                      signBox={p.sign_box}
                      onSideViews={(sv) => savePart(i, { side_views: sv })}
                      onSave={(proposalState) => savePart(i, { proposal_state: proposalState })}
                    />
                  </div>
                )
              })}
            </div>
          </div>
        )}
       </div>

       {/* LIVE PREVIEW — the real proposal rendered beside every WIZARD step (not the final
           preview step, which already shows the full proposal — a second one there was the
           "extra canvas" gap #1). Editable; remounted via a debounced key so typing survives. */}
       {livePreview && step !== 'preview' && (
         <aside className="wiz-live">
           {/* wizard controls right above the (live) proposal on every step (#5) */}
           <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' }}>
             <button className="ghost sm" onClick={back}>← Back</button>
             <button className="ghost sm" onClick={saveAndReturn} disabled={saving}>{saving ? 'Saving…' : '💾 Save & Return'}</button>
           </div>
           <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>Live preview — updates as you fill the steps; you can edit it directly.</div>
           <Proposal
             key={'live' + previewKey}
             mode={mode}
             tpl={tpl}
             answers={answers}
             customSpec={customSpec}
             info={{ company: client.company_name, client: client.client_name, contact: client.contact, email: client.email, address: client.address, job: client.job_name, quoteId }}
             artworkPath={artworkPath}
             logo={logo}
             aiResult={ai}
             paymentLink={paymentLink}
             approval={{ locked: quote?.approval_locked, approved: quote?.price_approved }}
             proposalNotes={proposalNotes}
             savedState={parts[activePart]?.proposal_state}
             sideViews={sideViews}
             signBox={signBox}
             onSideViews={setSideViews}
             onSave={(proposalState) => saveProgress({ proposal_state: proposalState, side_views: sideViews })}
           />
         </aside>
       )}
      </div>

      {showDrawing && quote?.customer_pdf && (
        <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setShowDrawing(false)}>
          <div className="modal" style={{ width: 'min(900px, 96%)', height: '88vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <b>Customer's drawing</b>
              <div style={{ display: 'flex', gap: 8 }}>
                <a className="ghost sm" href={fileUrl(quote.customer_pdf)} target="_blank" rel="noreferrer" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>Open in new tab</a>
                <button className="ghost sm" onClick={() => setShowDrawing(false)}>Close</button>
              </div>
            </div>
            {drawingOk === null ? (
              <div className="center" style={{ flex: 1, color: 'var(--text-dim)' }}>Loading…</div>
            ) : drawingOk === false ? (
              <div className="center" style={{ flex: 1, flexDirection: 'column', gap: 6, color: 'var(--text-dim)', textAlign: 'center', padding: 24 }}>
                <div style={{ fontSize: 15, color: 'var(--text)' }}>This drawing isn't on the server.</div>
                <div style={{ fontSize: 13 }}>It looks like an older upload from before files were stored permanently. Re-upload it with "Replace" on the project step.</div>
              </div>
            ) : isCloudDoc(quote.customer_pdf)
              ? <img src={cloudRaster(quote.customer_pdf)} alt="Customer drawing" style={{ flex: 1, objectFit: 'contain', minHeight: 0, background: '#fff', borderRadius: 8 }} />
              : /\.pdf$/i.test(quote.customer_pdf)
                ? <iframe title="Customer drawing" src={fileUrl(quote.customer_pdf)} style={{ flex: 1, border: '1px solid var(--border)', borderRadius: 8, background: '#fff', minHeight: 0 }} />
                : <img src={fileUrl(quote.customer_pdf)} alt="Customer drawing" style={{ flex: 1, objectFit: 'contain', minHeight: 0 }} />}
          </div>
        </div>
      )}
    </>
  )
}
