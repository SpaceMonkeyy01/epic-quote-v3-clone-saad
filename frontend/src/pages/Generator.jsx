import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { getQuote, updateQuote, putGenerated, uploadArtwork, uploadCustomerFile, generateSpecs } from '../api/quotes'
import { getLogo } from '../api/meta'
import { useConstants } from '../hooks'
import useAuthStore from '../store/authStore'
import { T } from '../generator/catalog'
import { autoAnswerFromAI, parseDims, composeDims } from '../generator/questions'
import { buildSpecLines } from '../generator/proposal'
import { listCatalog, saveCatalogItem } from '../api/catalog'
import { SIDE_VIEWS, pickSideView } from '../generator/sideviews'
import { rasterizePdf } from '../generator/pdfRaster'
import { fileUrl } from '../api/client'
import QA from '../generator/QA'
import Proposal from '../components/Proposal'

const FLOWS = {
  generator: ['client', 'project', 'signtype', 'specs', 'artwork', 'preview'],
  custom: ['client', 'customspecs', 'preview'], // Back from the questions shows client details, not the dashboard
}

// Cloudinary-stored PDF/Illustrator drawings can't render in an <img>/<iframe> directly —
// ask the CDN to rasterize page 1 to a PNG instead (free URL transformation).
const isCloudDoc = (p) => /res\.cloudinary\.com/.test(p || '') && /\.(pdf|ai)$/i.test(p || '')
const cloudRaster = (p, w = 1600) =>
  p.replace('/upload/', `/upload/pg_1,f_png,w_${w}/`).replace(/\.(pdf|ai)$/i, '.png')

// A sign type the catalog doesn't have: free-form template (like monuments) — the spec body
// comes from the AI's full reading of the drawing when available, and the wizard asks the
// generic questions (dimensions, illumination, mounting, colors, application, price).
// Crop a data-URL image to the AI-located artwork box (fractions 0..1). Falls back to the
// full image when the box is missing or implausible (tiny/inverted), so it can never lose data.
const cropToBox = (dataUrl, box) => new Promise((resolve) => {
  const ok = box && [box.x, box.y, box.w, box.h].every((v) => typeof v === 'number' && v >= 0 && v <= 1) && box.w > 0.08 && box.h > 0.05
  if (!ok) return resolve(dataUrl)
  const img = new Image()
  img.onload = () => {
    try {
      const c = document.createElement('canvas')
      c.width = Math.max(1, Math.round(img.width * Math.min(box.w, 1 - box.x)))
      c.height = Math.max(1, Math.round(img.height * Math.min(box.h, 1 - box.y)))
      c.getContext('2d').drawImage(img, -Math.round(img.width * box.x), -Math.round(img.height * box.y))
      resolve(c.toDataURL('image/png'))
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
  const qc = useQueryClient()
  const [searchParams] = useSearchParams()
  const [autoAi, setAutoAi] = useState(false)
  const { data: constants } = useConstants()
  const admin = useAuthStore((s) => s.isAdmin)()
  const reps = constants?.sales_reps || []

  const [quote, setQuote] = useState(null)
  const [gd, setGd] = useState(null)            // existing generated_data
  const [mode, setMode] = useState(null)        // 'generator' | 'custom'
  const [step, setStep] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')   // set when the quote can't be loaded (e.g. bad/deleted id)

  // wizard state
  const [client, setClient] = useState({ company_name: '', client_name: '', contact: '', address: '', job_name: '', sales_rep: '' })
  const [special, setSpecial] = useState('')
  const [tpl, setTpl] = useState(null)
  const [answers, setAnswers] = useState({})
  const [artworkPath, setArtworkPath] = useState(null)
  const [artErr, setArtErr] = useState('')
  const [paymentLink, setPaymentLink] = useState('')
  const [sideViews, setSideViews] = useState([])   // chosen side-view keys
  const [customSpec, setCustomSpec] = useState(null)
  const [logo, setLogoUrl] = useState(null)
  const [signSearch, setSignSearch] = useState('')
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
        contact: q.contact || '', address: q.address || '',
        job_name: g.job_name || q.job_name || '', sales_rep: q.sales_rep || '',
      })
      setSpecial(q.special_requirements || '')
      if (g.tpl_name) setTpl(T.find((t) => t.n === g.tpl_name) || makeCustomTpl(g.tpl_name, g.tpl_stored_spec || null))
      setAnswers(g.answers || {})
      setAi(g.ai || null)
      setCustomSpec(g.custom_spec || null)
      if (g.artwork_path) setArtworkPath(g.artwork_path)
      // #10: if no artwork chosen yet but the customer uploaded an image of the sign, use it
      else if (q.customer_pdf && /\.(png|jpe?g|gif|webp|svg)$/i.test(q.customer_pdf)) setArtworkPath(q.customer_pdf)
      if (g.side_views) setSideViews(g.side_views)
      if (g.payment_link) setPaymentLink(g.payment_link)
      setProposalNotes(g.proposal_notes || '')
      getLogo().then((l) => setLogoUrl(l.logo)).catch(() => {})

      // Mode comes from the intake choice (?mode=ai|custom) or the persisted quote_type — never re-asked.
      const modeParam = searchParams.get('mode')
      const resolvedMode = g.quote_type
        || (modeParam === 'custom' ? 'custom' : modeParam === 'ai' ? 'generator' : null)
      if (resolvedMode) {
        setMode(resolvedMode)
        if (resolvedMode === 'custom') {
          setStep(g.custom_spec ? 'preview' : 'customspecs')   // straight to the questions
        } else {
          const hasProgress = g.tpl_name && Object.keys(g.answers || {}).length
          setStep(hasProgress ? 'preview' : 'project')
          if (modeParam === 'ai' && !g.ai) setAutoAi(true)      // auto-run extraction once
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
  const back = () => (flowIndex > 0 ? goto(flow[flowIndex - 1]) : navigate('/dashboard'))

  const saveProgress = async (extra = {}) => {
    const payload = {
      ...(gd || {}),
      quote_type: mode,
      job_name: client.job_name,
      tpl_name: tpl?.n || null,
      tpl_stored_spec: tpl?.storedSpec || null,
      answers,
      ai,
      custom_spec: customSpec,
      artwork_path: (artworkPath && !artworkPath.startsWith('blob:') && !artworkPath.startsWith('data:')) ? artworkPath : null,
      side_views: sideViews,
      payment_link: paymentLink,
      proposal_notes: proposalNotes,
      ...extra,
    }
    await putGenerated(quoteId, payload)
    setGd(payload)
    // refresh dashboard/list so quote_type + price reflect the saved progress
    qc.invalidateQueries({ queryKey: ['quotes'] })
    qc.invalidateQueries({ queryKey: ['dashboard'] })
  }

  // --- step handlers ---
  const saveClient = async () => {
    await updateQuote(quoteId, client)
    await saveProgress()        // also persists the payment link
    next()
  }
  const onArtwork = async (e) => {
    const f = e.target.files[0]; if (!f) return
    setArtErr('')
    setArtworkPath(URL.createObjectURL(f))   // show the picked image immediately, straight from the local file
    try {
      const path = await uploadArtwork(quoteId, f)
      setArtworkPath(path)                          // swap to the saved server copy
      await saveProgress({ artwork_path: path })    // persist now so it survives reopen
    } catch (err) {
      setArtErr('Shown locally, but the server upload failed: ' + (err.response?.data?.message || err.message || 'unknown error'))
    }
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
      if (pageUrl && (!artworkPath || artworkPath === drawing)) {
        try {
          const cropped = await cropToBox(pageUrl, result?.artworkBox)
          const blob = await (await fetch(cropped)).blob()
          const path = await uploadArtwork(quoteId, new File([blob], 'drawing.png', { type: 'image/png' }))
          artPath = path; setArtworkPath(path)
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
  // dimensions line in sync, so the proposal can never show different numbers than the boxes
  const setCustomDim = (part, v) => {
    setCustomSpec((cs) => {
      const p = parseDims(cs?.dims)
      p[part] = v
      const dims = composeDims(p.l, p.w, p.h)
      let specText = cs?.specText || ''
      if (/^(.*DIMENSIONS[^:]*):.*$/im.test(specText)) {
        specText = specText.replace(/^(.*DIMENSIONS[^:]*):.*$/im, `$1: ${dims}`)
      }
      return { ...cs, dims, specText }
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
      <button onClick={() => navigate('/dashboard')}>Back to dashboard</button>
    </div>
  )

  // mode picker (#55)
  if (!mode) {
    return (
      <div className="center" style={{ flexDirection: 'column', gap: 16 }}>
        <h2>How do you want to build {quoteId}?</h2>
        <div style={{ display: 'flex', gap: 16 }}>
          <button onClick={() => { setMode('generator'); setStep('project') }}>Quote Generator (AI)</button>
          <button className="ghost" onClick={() => { setMode('custom'); setStep('customspecs') }}>Custom Quote Creator</button>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{mode === 'custom' ? 'Custom Quote Creator' : 'Quote Generator'}</h1>
          <div className="muted">{quoteId} — {quote?.company_name}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {quote?.customer_pdf && <button className="ghost" onClick={() => setShowDrawing(true)}>📎 View drawing</button>}
          <button className="ghost" onClick={() => navigate('/dashboard')}>Exit</button>
        </div>
      </div>

      {/* progress bar */}
      <div className="prog">
        {flow.map((s, i) => <div key={s} className={'prog-seg' + (i <= flowIndex ? ' done' : '')} />)}
      </div>

      <div className={'wizard' + (livePreview ? ' wiz-cols' : '')} style={step === 'preview' ? { maxWidth: 'min(1180px, 96%)' } : livePreview ? { maxWidth: 'min(1500px, 97%)' } : undefined}>
       <div className="wiz-main">
        {step === 'client' && (
          <div className="step">
            <h3>Client Information</h3>
            {['company_name', 'client_name', 'contact', 'address', 'job_name'].map((k) => (
              <div className="field" key={k}>
                <label>{k.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())}</label>
                <input value={client[k]} onChange={(e) => setClient({ ...client, [k]: e.target.value })} />
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
            <div className="field">
              <label>💳 Payment link (optional)</label>
              <input type="url" placeholder="https://…" value={paymentLink} onChange={(e) => setPaymentLink(e.target.value)} />
              {paymentLink.trim() !== '' && !/^https?:\/\/\S+\.\S+/i.test(paymentLink.trim()) && (
                <p style={{ color: '#ff6b6b', fontSize: 13, marginTop: 6 }}>
                  That's not a working link — it must start with https:// (this goes on the customer's proposal).
                </p>
              )}
            </div>
            <div className="foot">
              <button className="ghost" onClick={back}>Back</button>
              <button disabled={paymentLink.trim() !== '' && !/^https?:\/\/\S+\.\S+/i.test(paymentLink.trim())} onClick={saveClient}>Next →</button>
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
            <div className="foot"><button className="ghost" onClick={back}>Back</button><button onClick={() => goto('signtype')}>Next →</button></div>
          </div>
        )}

        {step === 'signtype' && (
          <div className="step">
            <h3>Select Sign Type</h3>
            <input placeholder="Search sign types…" value={signSearch} onChange={(e) => setSignSearch(e.target.value)} style={{ marginBottom: 12 }} />
            <p className="muted" style={{ marginTop: -4, marginBottom: 10 }}>Click a sign type to continue.</p>
            <div className="sign-list">
              {tpl?.customType && (
                <div className="sign-opt sel" onClick={() => pickSign(tpl)}>
                  {tpl.n}  ✏️ your custom type
                </div>
              )}
              {T.filter((t) => t.n.toLowerCase().includes(signSearch.toLowerCase())).map((t) => (
                <div
                  key={t.n}
                  className={'sign-opt' + (tpl?.n === t.n ? ' sel' : '') + (aiSuggestedName === t.n ? ' ai' : '')}
                  onClick={() => pickSign(t)}
                >
                  {t.n}{aiSuggestedName === t.n ? '  ⚡ AI suggested' : ''}
                </div>
              ))}
              {signLib.filter((s) => s.name.toLowerCase().includes(signSearch.toLowerCase())).map((s) => (
                <div
                  key={'lib' + s.id}
                  className={'sign-opt' + (tpl?.n === s.name ? ' sel' : '')}
                  onClick={() => pickSign(makeCustomTpl(s.name, s.data?.spec || null))}
                >
                  {s.name}  ✏️ team custom type
                </div>
              ))}
            </div>
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
              <button className="ghost" onClick={back}>Back</button>
            </div>
          </div>
        )}

        {step === 'specs' && tpl && (() => {
          const noDims = !String(answers.dimensions || '').trim()
          const priceNum = Number(answers.price)
          const badPrice = String(answers.price ?? '').trim() === '' || !Number.isFinite(priceNum) || priceNum <= 0
          const hint = noDims ? 'Enter the dimensions to continue' : badPrice ? 'Enter a real price (more than $0) to continue' : ''
          return (
            <div className="step">
              <h3>Specifications — {tpl.n}</h3>
              <QA tpl={tpl} ai={ai} initialAnswers={answers} onComplete={finishSpecs} />
              <div className="foot">
                <button className="ghost" onClick={back}>Back</button>
                {hint && <span style={{ color: 'var(--text-faint)', fontSize: 12, alignSelf: 'center' }}>{hint}</span>}
                <button disabled={!Object.keys(answers).length || noDims || badPrice} onClick={() => next()}>Next: Upload Artwork →</button>
              </div>
            </div>
          )
        })()}

        {step === 'artwork' && (
          <div className="step">
            <h3>Artwork &amp; Notes</h3>
            {artworkPath && <img src={fileUrl(artworkPath)} alt="artwork" onError={(e) => { e.currentTarget.style.display = 'none'; setArtErr('The saved artwork could not be loaded — please re-upload it.') }} style={{ maxWidth: 360, display: 'block', margin: '8px 0', border: '1px solid var(--border)', borderRadius: 8 }} />}
            <input ref={artInput} type="file" accept="image/*" onChange={onArtwork} />
            {artErr && <p style={{ color: '#ff6b6b', fontSize: 13, marginTop: 8 }}>{artErr}</p>}
            <div className="field" style={{ marginTop: 18 }}>
              <label>Notes for the proposal (anything special not already on the drawing)</label>
              <textarea rows={3} value={proposalNotes} onChange={(e) => setProposalNotes(e.target.value)} placeholder="e.g. install timeline, special finish, access notes…" />
            </div>
            <div className="foot">
              <button className="ghost" onClick={back}>Back</button>
              <button className="ghost" onClick={() => { setArtworkPath(null); toPreview() }}>Skip artwork</button>
              <button onClick={toPreview}>{saving ? 'Saving…' : 'Next →'}</button>
            </div>
          </div>
        )}

        {step === 'customspecs' && (
          <div className="step">
            <h3>Custom Specifications</h3>
            <div className="field">
              <label>Sign type — the full catalog, the team's saved custom types, or type a new one</label>
              <select
                value={customTypeSel}
                onChange={(e) => {
                  const v = e.target.value
                  setCustomTypeSel(v)
                  if (v === '' || v === '__new__') return
                  const cat = T.find((t) => t.n === v)
                  const stored = signLib.find((s) => s.name === v)
                  const specText = cat
                    ? buildSpecLines(cat, {}, null).join('\n')
                    : (stored?.data?.spec || `SIGN TYPE: ${v}`)
                  // the sign type implies its construction side view — pick it automatically
                  // (same curated map the AI mode uses); the rep can still change it on the proposal
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
                }}
              >
                <option value="">— pick a sign type (prefills the spec) —</option>
                {T.map((t) => <option key={t.n} value={t.n}>{t.n}</option>)}
                {signLib.length > 0 && <option disabled>── team's custom types ──</option>}
                {signLib.map((s) => <option key={'lib' + s.id} value={s.name}>{s.name} ✏️</option>)}
                <option value="__new__">➕ Type a new sign type…</option>
              </select>
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
              <div className="field"><label>Price (USD)</label><input type="number" min={0} value={customSpec?.price || ''} onChange={(e) => setCustomSpec({ ...customSpec, price: e.target.value })} /></div>
            </div>
            <div className="field">
              <label>Application</label>
              <select value={customSpec?.application || 'EXTERIOR'} onChange={(e) => setCustomSpec({ ...customSpec, application: e.target.value })}>
                <option value="EXTERIOR">EXTERIOR</option><option value="INTERIOR">INTERIOR</option>
              </select>
            </div>
            <div className="field"><label>Specification Text</label><textarea rows={10} value={customSpec?.specText || ''} onChange={(e) => setCustomSpec({ ...customSpec, specText: e.target.value })} /></div>
            <div className="field">
              <label>Special requirements (anything unusual about this job)</label>
              <textarea rows={2} value={special} onChange={(e) => setSpecial(e.target.value)} placeholder="e.g. rush order, special finish, permits…" />
            </div>
            <div className="foot">
              <button className="ghost" onClick={back}>Back</button>
              {(() => {
                const n = Number(customSpec?.price)
                const badPrice = String(customSpec?.price ?? '').trim() === '' || !Number.isFinite(n) || n <= 0
                const noDims = !String(customSpec?.dims || '').trim()
                const hint = noDims ? 'Enter the dimensions to continue' : badPrice ? 'Enter a real price (more than $0) to continue' : ''
                return (
                  <>
                    {hint && <span style={{ color: 'var(--text-faint)', fontSize: 12, alignSelf: 'center' }}>{hint}</span>}
                    <button disabled={badPrice || noDims} onClick={toPreview}>{saving ? 'Saving…' : 'Next →'}</button>
                  </>
                )
              })()}
            </div>
          </div>
        )}

        {step === 'preview' && (
          <div className="step">
            <h3>Proposal</h3>
            <Proposal
              mode={mode}
              tpl={tpl}
              answers={answers}
              customSpec={customSpec}
              info={{ company: client.company_name, client: client.client_name, contact: client.contact, address: client.address, job: client.job_name, quoteId }}
              artworkPath={artworkPath}
              logo={logo}
              aiResult={ai}
              paymentLink={paymentLink}
              proposalNotes={proposalNotes}
              savedState={gd?.proposal_state}
              sideViews={sideViews}
              onSideViews={setSideViews}
              onSave={(proposalState) => saveProgress({ proposal_state: proposalState, side_views: sideViews })}
            />
            <div className="foot" style={{ marginTop: 14 }}>
              <button className="ghost" onClick={back}>Back</button>
              <button onClick={async () => { await saveProgress(); navigate('/dashboard') }}>Save & Return to Dashboard</button>
            </div>
          </div>
        )}
       </div>

       {/* LIVE PREVIEW — the real proposal rendered beside every step, fully editable, updating
           as the wizard changes (remounted via a debounced key so typing here is never clobbered) */}
       {livePreview && (
         <aside className="wiz-live">
           <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>Live preview — updates as you fill the steps; you can edit it directly.</div>
           <Proposal
             key={'live' + previewKey}
             mode={mode}
             tpl={tpl}
             answers={answers}
             customSpec={customSpec}
             info={{ company: client.company_name, client: client.client_name, contact: client.contact, address: client.address, job: client.job_name, quoteId }}
             artworkPath={artworkPath}
             logo={logo}
             aiResult={ai}
             paymentLink={paymentLink}
             proposalNotes={proposalNotes}
             savedState={gd?.proposal_state}
             sideViews={sideViews}
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
