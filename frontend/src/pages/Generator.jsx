import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate, useSearchParams, useLocation } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { getQuote, updateQuote, putGenerated, uploadArtwork, uploadCustomerFile, generateSpecs, createCheckpoint } from '../api/quotes'
import { getLogo } from '../api/meta'
import { useConstants } from '../hooks'
import { useSelector } from 'react-redux'
import { selectUser, selectIsAdmin } from '../store/authSlice'
import { autoAnswerFromAI, parseDims, composeDims } from '../generator/questions'
import { listCatalog, saveCatalogItem } from '../api/catalog'
import { SIDE_VIEWS, pickSideView } from '../generator/sideviews'
import { rasterizePdf } from '../generator/pdfRaster'
import { fileUrl } from '../api/client'
import Proposal from '../components/Proposal'
import { MAX_PRICE, FLOWS, PART_KEYS, makeCustomTpl, legacyPartFromGd, matchSignType, resolveTplByName } from '../generator/parts'
import { isCloudDoc, cloudRaster, cropToBox, urlToDataUrl } from '../generator/artwork'
import ClientStep from '../components/generator/ClientStep'
import ProjectStep from '../components/generator/ProjectStep'
import SignTypeStep from '../components/generator/SignTypeStep'
import SpecsStep from '../components/generator/SpecsStep'
import ArtworkStep from '../components/generator/ArtworkStep'
import CustomSpecsStep from '../components/generator/CustomSpecsStep'
import PreviewStep from '../components/generator/PreviewStep'
import { computeDimSpec, computeApplicationSpec } from '../generator/specSync'
import { ExitAskModal, DrawingModal } from '../components/generator/WizardModals'

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
  const admin = useSelector(selectIsAdmin)
  const canCreatePaymentLinks = useSelector(selectUser)?.can_create_payment_links || admin
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
  // A just-deleted page, kept for a few seconds so it can be undone (deleting a sign page used to be
  // irreversible). { part, index } — undoDeletePage re-inserts it at its original spot.
  const [deletedPage, setDeletedPage] = useState(null)
  const deleteTimer = useRef(null)
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
      const seenPids = new Set()
      const loadedParts = ((Array.isArray(g.parts) && g.parts.length)
        ? g.parts
        : [legacyPartFromGd(g)])
        // stable id per part → the preview keys pages by it AND the download/link collectors map
        // pageRefs by it. It MUST be unique: a missing OR duplicate id (older data, a copied part)
        // would make two pages share one ref, so every page captured the LAST one repeatedly
        // (the "both pages are B" bug). Regenerate on miss OR collision.
        .map((p, i) => {
          let pid = p.__pid
          if (!pid || seenPids.has(pid)) pid = `p${i}_${Math.random().toString(36).slice(2, 8)}_${Date.now().toString(36)}`
          seenPids.add(pid)
          return { ...p, __pid: pid }
        })
      setParts(loadedParts)
      // persist the repaired ids so the fix sticks (only when something actually changed)
      if (loadedParts.some((p, i) => p.__pid !== (g.parts?.[i]?.__pid))) {
        putGenerated(quoteId, { ...g, parts: loadedParts }).catch(() => {})
      }
      setActivePart(0)
      const p0 = loadedParts[0] || {}

      if (p0.tpl_name) setTpl(resolveTplByName(p0.tpl_name, p0.tpl_stored_spec || null))
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
      try { img = await captureAllPages() } catch { /* image optional */ }   // whole quote (all signs)
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
  const tplForPart = (p) => (p?.tpl_name ? resolveTplByName(p.tpl_name, p.tpl_stored_spec || null) : null)

  // The active part's proposal_state for the LIVE preview, with __qty forced to the wizard's
  // Quantity field — so QTY/TOTAL update on the wizard steps, not only on the preview page (#5).
  // (Price flows straight from customSpec, so it was already live.)
  const livePreviewState = () => {
    const ps = parts[activePart]?.proposal_state || {}
    const wq = parseInt(mode === 'custom' ? customSpec?.qty : answers?.qty, 10)
    return Number.isFinite(wq) && wq > 0 ? { ...ps, __qty: wq } : ps
  }

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

  // The WHOLE quote as one image for the version history: each page's full snapshot (last page
  // carries the total) stacked vertically with a grey gap between pages, so a multi-sign version
  // reads as the complete document. A single-sign quote just returns its one page.
  const captureAllPages = async () => {
    const shots = []
    for (const p of parts) {
      const el = pageRefs.current[p.__pid]
      if (el?.captureSnapshot) { try { shots.push(await el.captureSnapshot()) } catch { /* skip */ } }
    }
    if (shots.length <= 1) return shots[0] || null
    const imgs = (await Promise.all(shots.map((src) => new Promise((res) => {
      const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src
    })))).filter(Boolean)
    if (!imgs.length) return null
    const GAP = 26
    const w = Math.max(...imgs.map((im) => im.width))
    const h = imgs.reduce((s, im) => s + im.height, 0) + GAP * (imgs.length - 1)
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h
    const ctx = cv.getContext('2d')
    ctx.fillStyle = '#e9edf3'; ctx.fillRect(0, 0, w, h)   // grey between pages = page separators
    let y = 0
    for (const im of imgs) { ctx.drawImage(im, Math.round((w - im.width) / 2), y); y += im.height + GAP }
    return cv.toDataURL('image/png')
  }

  // Every sign page at HD ({url,w,h}) for the multi-page download (PDF = one page each; PNG stitched).
  const capturePagesExport = async () => {
    const out = []
    for (const p of parts) {
      const el = pageRefs.current[p.__pid]
      if (el?.captureExport) { try { out.push(await el.captureExport()) } catch { /* skip */ } }
    }
    return out
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

  // #9 — open the full wizard spec editor (sign type picker, dims, price, spec text) for ONE page:
  // make it the active part, load it into the hooks, and jump to the spec step.
  const editPart = (i) => {
    setActivePart(i)
    loadPartIntoHooks(partsRef.current[i] || {})
    setStep(mode === 'custom' ? 'customspecs' : 'signtype')
  }

  // Delete one page (only offered when >1). Letters (A/B/…) are index-derived, so they resync
  // automatically; the active part is clamped and reloaded so the wizard stays coherent.
  const deletePage = async (i) => {
    if (partsRef.current.length <= 1) return
    const removed = partsRef.current[i]                       // keep it so the delete can be undone
    const nextParts = partsRef.current.filter((_, idx) => idx !== i)
    const payload = { ...(gdRef.current || {}), parts: nextParts, ...legacyPartFromGd(nextParts[0] || {}) }
    partsRef.current = nextParts; gdRef.current = payload
    setParts(nextParts)
    setGd(payload)
    const newActive = Math.min(activePart, nextParts.length - 1)
    setActivePart(newActive)
    loadPartIntoHooks(nextParts[newActive])
    await putGenerated(quoteId, payload)
    // offer an Undo for a few seconds (a deleted sign page used to be gone for good)
    setDeletedPage({ part: removed, index: i })
    clearTimeout(deleteTimer.current)
    deleteTimer.current = setTimeout(() => setDeletedPage(null), 12000)
    qc.invalidateQueries({ queryKey: ['quotes'] })
    qc.invalidateQueries({ queryKey: ['dashboard'] })
  }

  // Undo the last page delete: re-insert the kept part at its original index and persist.
  const undoDeletePage = async () => {
    if (!deletedPage) return
    const { part, index } = deletedPage
    const arr = [...partsRef.current]
    arr.splice(Math.min(index, arr.length), 0, part)
    const payload = { ...(gdRef.current || {}), parts: arr, ...legacyPartFromGd(arr[0] || {}) }
    partsRef.current = arr; gdRef.current = payload
    setParts(arr)
    setGd(payload)
    setActivePart(index)
    loadPartIntoHooks(arr[index])
    setDeletedPage(null)
    clearTimeout(deleteTimer.current)
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
  // Per-part artwork upload used by PreviewStep's per-page ✂ Crop button. Uploads the cropped
  // file, patches ONLY that part's artwork_path (multi-sign quotes have one artwork per page),
  // and drops that part's saved artwork frame so the new image auto-fits fresh.
  const commitPartArtworkFile = async (i, f) => {
    if (!f) return
    const path = await uploadArtwork(quoteId, f)
    const cur = partsRef.current[i] || {}
    const ps = cur.proposal_state
    const cleanPs = ps?.__layout?.artwork
      ? { ...ps, __layout: (() => { const l = { ...ps.__layout }; delete l.artwork; return l })() }
      : ps
    await savePart(i, { artwork_path: path, artwork_auto: false, proposal_state: cleanPs })
    if (i === activePart) setArtworkPath(path)
  }
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

  // The spec-text sync transforms live in ../generator/specSync (pure); these thin wrappers
  // keep the setCustomSpec state update in the component.
  const setCustomDim = (part, v) => setCustomSpec((cs) => computeDimSpec(part, v, cs))
  const setCustomApplication = (app) => setCustomSpec((cs) => computeApplicationSpec(app, cs))

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

      {exitAsk && (
        <ExitAskModal admin={admin} saving={saving} saveAndReturn={saveAndReturn}
          quoteId={quoteId} qc={qc} navigate={navigate} onClose={() => setExitAsk(false)} />
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
          <ClientStep client={client} setClient={setClient} admin={admin} reps={reps}
            repOther={repOther} setRepOther={setRepOther} saveClient={saveClient} />
        )}

        {step === 'project' && (
          <ProjectStep aiLoading={aiLoading} quote={quote} setShowDrawing={setShowDrawing}
            onCustomerFile={onCustomerFile} ai={ai} runAI={runAI} aiStatus={aiStatus} goto={goto} />
        )}

        {step === 'signtype' && (
          <SignTypeStep signSearch={signSearch} setSignSearch={setSignSearch} signGroup={signGroup}
            setSignGroup={setSignGroup} tpl={tpl} pickSign={pickSign} signLib={signLib}
            aiSuggestedName={aiSuggestedName} customType={customType} setCustomType={setCustomType}
            onUseTypedSignType={useTypedSignType} />
        )}

        {step === 'specs' && tpl && (
          <SpecsStep tpl={tpl} ai={ai} answers={answers} finishSpecs={finishSpecs} next={next} />
        )}

        {step === 'artwork' && (
          <ArtworkStep cropping={cropping} setCropping={setCropping} artworkPath={artworkPath}
            setArtworkPath={setArtworkPath} saving={saving} signBox={signBox} setSignBox={setSignBox}
            commitArtworkFile={commitArtworkFile} saveProgress={saveProgress} artInput={artInput}
            onArtwork={onArtwork} artErr={artErr} setArtErr={setArtErr} proposalNotes={proposalNotes}
            setProposalNotes={setProposalNotes} toPreview={toPreview} />
        )}

        {step === 'customspecs' && (
          <CustomSpecsStep customSpec={customSpec} setCustomSpec={setCustomSpec}
            customTypeSel={customTypeSel} setCustomTypeSel={setCustomTypeSel} typePicking={typePicking}
            setTypePicking={setTypePicking} typeGroup={typeGroup} setTypeGroup={setTypeGroup}
            signLib={signLib} setSignLib={setSignLib}
            sideViews={sideViews} setSideViews={setSideViews} client={client} newTypeName={newTypeName}
            setNewTypeName={setNewTypeName} newTypeSpec={newTypeSpec} setNewTypeSpec={setNewTypeSpec}
            customDimsStatus={customDimsStatus} setCustomDim={setCustomDim}
            setCustomApplication={setCustomApplication} special={special} setSpecial={setSpecial}
            saveNext={saveNext} saving={saving} />
        )}

        {step === 'preview' && (
          <PreviewStep parts={parts} cpBusy={cpBusy} cpMsg={cpMsg} saving={saving}
            saveCheckpoint={saveCheckpoint} navigate={navigate} exitTo={exitTo} addPage={addPage}
            setExitAsk={setExitAsk} deletedPage={deletedPage} undoDeletePage={undoDeletePage}
            deleteTimer={deleteTimer} setDeletedPage={setDeletedPage} multiPreviewRef={multiPreviewRef}
            grandTotal={grandTotal} tplForPart={tplForPart} client={client} quoteId={quoteId}
            collectPartImages={collectPartImages} linkTitle={linkTitle} captureAllPages={captureAllPages}
            capturePagesExport={capturePagesExport} canCreatePaymentLinks={canCreatePaymentLinks}
            savePaymentLink={savePaymentLink} logo={logo} paymentLink={paymentLink} quote={quote}
            savePart={savePart} commitPartArtworkFile={commitPartArtworkFile}
            pageRefs={pageRefs} proposalRef={proposalRef} mode={mode}
            editPart={editPart} deletePage={deletePage} />
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
             onArtworkFile={commitArtworkFile}
             logo={logo}
             aiResult={ai}
             paymentLink={paymentLink}
             approval={{ locked: quote?.approval_locked, approved: quote?.price_approved }}
             proposalNotes={proposalNotes}
             savedState={livePreviewState()}
             sideViews={sideViews}
             signBox={signBox}
             onSideViews={setSideViews}
             onSave={(proposalState) => saveProgress({ proposal_state: proposalState, side_views: sideViews })}
           />
         </aside>
       )}
      </div>

      {showDrawing && quote?.customer_pdf && (
        <DrawingModal quote={quote} drawingOk={drawingOk} onClose={() => setShowDrawing(false)} />
      )}
    </>
  )
}
