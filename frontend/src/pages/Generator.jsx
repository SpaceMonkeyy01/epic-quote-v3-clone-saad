import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { getQuote, updateQuote, putGenerated, uploadArtwork, uploadCustomerFile, generateSpecs } from '../api/quotes'
import { getLogo } from '../api/meta'
import { T, CUSTOM_TEMPLATES } from '../generator/catalog'
import { autoAnswerFromAI } from '../generator/questions'
import { SIDE_VIEWS, pickSideView } from '../generator/sideviews'
import { rasterizePdf } from '../generator/pdfRaster'
import { fileUrl } from '../api/client'
import QA from '../generator/QA'
import Proposal from '../components/Proposal'

const FLOWS = {
  generator: ['client', 'project', 'signtype', 'specs', 'artwork', 'preview'],
  custom: ['customspecs', 'preview'], // straight to the questions; client captured at intake
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

  const [quote, setQuote] = useState(null)
  const [gd, setGd] = useState(null)            // existing generated_data
  const [mode, setMode] = useState(null)        // 'generator' | 'custom'
  const [step, setStep] = useState(null)
  const [loading, setLoading] = useState(true)

  // wizard state
  const [client, setClient] = useState({ company_name: '', client_name: '', contact: '', address: '', job_name: '' })
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
  const [saving, setSaving] = useState(false)
  const [ai, setAi] = useState(null)
  const [aiStatus, setAiStatus] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const artInput = useRef(null)

  useEffect(() => {
    (async () => {
      const q = await getQuote(quoteId)
      setQuote(q)
      const g = q.generated_data || {}
      setGd(g)
      setClient({
        company_name: q.company_name || '', client_name: q.client_name || '',
        contact: q.contact || '', address: q.address || '',
        job_name: g.job_name || q.job_name || '',
      })
      setSpecial(q.special_requirements || '')
      if (g.tpl_name) setTpl(T.find((t) => t.n === g.tpl_name) || null)
      setAnswers(g.answers || {})
      setAi(g.ai || null)
      setCustomSpec(g.custom_spec || null)
      if (g.artwork_path) setArtworkPath(g.artwork_path)
      // #10: if no artwork chosen yet but the customer uploaded an image of the sign, use it
      else if (q.customer_pdf && /\.(png|jpe?g|gif|webp|svg)$/i.test(q.customer_pdf)) setArtworkPath(q.customer_pdf)
      if (g.side_views) setSideViews(g.side_views)
      if (g.payment_link) setPaymentLink(g.payment_link)
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
      setLoading(false)
    })()
  }, [quoteId])

  const flow = mode ? FLOWS[mode] : []
  const flowIndex = flow.indexOf(step)
  const goto = (s) => setStep(s)
  const next = () => goto(flow[flowIndex + 1])
  const back = () => (flowIndex > 0 ? goto(flow[flowIndex - 1]) : navigate('/dashboard'))

  const saveProgress = async (extra = {}) => {
    const payload = {
      ...(gd || {}),
      quote_type: mode,
      job_name: client.job_name,
      tpl_name: tpl?.n || null,
      answers,
      ai,
      custom_spec: customSpec,
      artwork_path: (artworkPath && !artworkPath.startsWith('blob:') && !artworkPath.startsWith('data:')) ? artworkPath : null,
      side_views: sideViews,
      payment_link: paymentLink,
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
  }
  const runAI = async () => {
    setAiLoading(true)
    setAiStatus('Reading customer details and generating specifications…')
    try {
      await updateQuote(quoteId, { special_requirements: special })
      // vector/CAD PDFs carry no extractable text — render page 1 to an image so vision can read it
      let imageData = null
      if (quote?.customer_pdf && /\.pdf$/i.test(quote.customer_pdf)) {
        setAiStatus('Rendering the PDF for the AI…')
        const dataUrl = await rasterizePdf(fileUrl(quote.customer_pdf))
        if (dataUrl) {
          imageData = dataUrl.split(',')[1]
          // persist the rendered page as the proposal artwork (survives reload; not a giant data-URL)
          if (!artworkPath) {
            try {
              const blob = await (await fetch(dataUrl)).blob()
              const path = await uploadArtwork(quoteId, new File([blob], 'drawing.png', { type: 'image/png' }))
              setArtworkPath(path)
            } catch { setArtworkPath(dataUrl) }
          }
        }
        setAiStatus('Reading the drawing and generating specifications…')
      }
      const result = await generateSpecs(quoteId, special, SIDE_VIEWS.map((s) => s.key).join(','), imageData)
      setAi(result)
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
      if (sv.selected) setSideViews([sv.selected])
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

  // AI mode now routes through the Q&A pages (sign type + specs) so the rep can review/adjust
  // the AI-extracted values instead of jumping straight to artwork.
  const continueFromAI = () => {
    if (!tpl) setAiStatus('AI did not return a matching sign type — please pick one manually.')
    goto('signtype')
  }

  // project-step forward: save the brief, then continue (to artwork if AI matched a sign type, else sign-type)
  const proceedFromProject = async () => {
    await updateQuote(quoteId, { special_requirements: special })
    continueFromAI()
  }

  const finishSpecs = (finalAnswers) => { setAnswers(finalAnswers) }
  const toPreview = async () => { setSaving(true); await saveProgress(); setSaving(false); goto('preview') }

  if (loading) return <div className="center">Loading…</div>

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
        <button className="ghost" onClick={() => navigate('/dashboard')}>Exit</button>
      </div>

      {/* progress bar */}
      <div className="prog">
        {flow.map((s, i) => <div key={s} className={'prog-seg' + (i <= flowIndex ? ' done' : '')} />)}
      </div>

      <div className="wizard" style={step === 'preview' ? { maxWidth: 'min(1180px, 96%)' } : undefined}>
        {step === 'client' && (
          <div className="step">
            <h3>Client Information</h3>
            {['company_name', 'client_name', 'contact', 'address', 'job_name'].map((k) => (
              <div className="field" key={k}>
                <label>{k.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())}</label>
                <input value={client[k]} onChange={(e) => setClient({ ...client, [k]: e.target.value })} />
              </div>
            ))}
            <div className="foot"><button className="ghost" onClick={back}>Back</button><button onClick={saveClient}>Next →</button></div>
          </div>
        )}

        {step === 'project' && (
          <div className="step">
            <h3>Project Information</h3>
            <div className="field">
              <label>Special Requirements</label>
              <textarea rows={4} value={special} onChange={(e) => setSpecial(e.target.value)} />
            </div>
            <div className="field">
              {quote?.customer_pdf ? (
                <div className="muted" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <a href={fileUrl(quote.customer_pdf)} target="_blank" rel="noreferrer">📎 View attached file</a>
                  <label style={{ cursor: 'pointer', textDecoration: 'underline' }}>
                    Replace
                    <input type="file" accept=".pdf,image/*" style={{ display: 'none' }} onChange={onCustomerFile} />
                  </label>
                </div>
              ) : (
                <input type="file" accept=".pdf,image/*" onChange={onCustomerFile} />
              )}
            </div>
            <div className="ai-box">
              <button onClick={runAI} disabled={aiLoading}>{aiLoading ? 'Generating…' : '⚡ Generate Specs with AI'}</button>
              <span className="muted" style={{ marginLeft: 10 }}>Optional — or fill specs manually in the next steps.</span>
              {aiStatus && <p className="muted" style={{ marginTop: 8 }}>{aiStatus}</p>}
              {ai && (
                <div className="ai-result">
                  <b style={{ color: '#c4b5fd' }}>✔ AI specifications generated</b>
                  {[['Our Client (retail)', ai.companyName], ['End Customer', ai.endCustomer], ['Sign Type', ai.signType], ['Job Name', ai.jobName], ['Dimensions', ai.dimensions],
                    ['Returns', ai.returns], ['Trim Cap', ai.trimcap], ['Mounting', ai.mounting],
                    ['Illumination', ai.illumination], ['Face Color', ai.faceColor], ['Return Color', ai.returnColor],
                    ['Application', ai.application], ['Price', ai.price != null ? '$' + ai.price : null], ['Notes', ai.notes]]
                    .filter(([, v]) => v != null && v !== '')
                    .map(([k, v]) => <div key={k} className="line"><b>{k}:</b> {String(v)}</div>)}
                  {ai.fullSpec && (
                    <div style={{ marginTop: 10 }}>
                      <label>Full extracted specification</label>
                      <pre className="spec-dump" style={{ maxHeight: 220 }}>{ai.fullSpec}</pre>
                    </div>
                  )}
                  <p className="muted" style={{ marginTop: 6 }}>Pre-filled from the drawing — review above, then click Next.</p>
                </div>
              )}
            </div>
            <div className="foot"><button className="ghost" onClick={back}>Back</button><button onClick={proceedFromProject}>Next →</button></div>
          </div>
        )}

        {step === 'signtype' && (
          <div className="step">
            <h3>Select Sign Type</h3>
            <input placeholder="Search sign types…" value={signSearch} onChange={(e) => setSignSearch(e.target.value)} style={{ marginBottom: 12 }} />
            <div className="sign-list">
              {T.filter((t) => t.n.toLowerCase().includes(signSearch.toLowerCase())).map((t) => (
                <div
                  key={t.n}
                  className={'sign-opt' + (tpl?.n === t.n ? ' sel' : '')}
                  onClick={() => setTpl(t)}
                >
                  {t.n}{ai && tpl?.n === t.n ? '  ⚡ AI suggested' : ''}
                </div>
              ))}
            </div>
            <div className="foot">
              <button className="ghost" onClick={back}>Back</button>
              <button disabled={!tpl} onClick={() => { setAnswers(ai ? autoAnswerFromAI(tpl, ai) : {}); next() }}>Next →</button>
            </div>
          </div>
        )}

        {step === 'specs' && tpl && (
          <div className="step">
            <h3>Specifications — {tpl.n}</h3>
            <QA tpl={tpl} ai={ai} initialAnswers={answers} onComplete={finishSpecs} />
            <div className="foot">
              <button className="ghost" onClick={back}>Back</button>
              <button disabled={!Object.keys(answers).length} onClick={() => next()}>Next: Upload Artwork →</button>
            </div>
          </div>
        )}

        {step === 'artwork' && (
          <div className="step">
            <h3>Artwork</h3>
            {artworkPath && <img src={fileUrl(artworkPath)} alt="artwork" style={{ maxWidth: 360, display: 'block', margin: '8px 0', border: '1px solid var(--border)', borderRadius: 8 }} />}
            <input ref={artInput} type="file" accept="image/*" onChange={onArtwork} />
            {artErr && <p style={{ color: '#ff6b6b', fontSize: 13, marginTop: 8 }}>{artErr}</p>}
            <div className="foot">
              <button className="ghost" onClick={back}>Back</button>
              <button className="ghost" onClick={() => { setArtworkPath(null); toPreview() }}>Skip</button>
              <button onClick={toPreview}>{saving ? 'Saving…' : 'Next →'}</button>
            </div>
          </div>
        )}

        {step === 'customspecs' && (
          <div className="step">
            <h3>Custom Specifications</h3>
            <div className="tmpl-row">
              {CUSTOM_TEMPLATES.map((t, i) => (
                <button key={i} className="ghost sm" onClick={() => setCustomSpec({
                  itemDesc: t.itemDesc.replace('[COMPANY NAME]', client.company_name || 'CUSTOMER'),
                  dims: t.dims, specText: t.spec, application: t.application, price: customSpec?.price || '',
                })}>{t.name}</button>
              ))}
            </div>
            <div className="field"><label>Item Description</label><input value={customSpec?.itemDesc || ''} onChange={(e) => setCustomSpec({ ...customSpec, itemDesc: e.target.value })} /></div>
            <div className="grid2">
              <div className="field"><label>Dimensions</label><input value={customSpec?.dims || ''} onChange={(e) => setCustomSpec({ ...customSpec, dims: e.target.value })} /></div>
              <div className="field"><label>Price (USD)</label><input type="number" value={customSpec?.price || ''} onChange={(e) => setCustomSpec({ ...customSpec, price: e.target.value })} /></div>
            </div>
            <div className="field">
              <label>Application</label>
              <select value={customSpec?.application || 'EXTERIOR'} onChange={(e) => setCustomSpec({ ...customSpec, application: e.target.value })}>
                <option value="EXTERIOR">EXTERIOR</option><option value="INTERIOR">INTERIOR</option>
              </select>
            </div>
            <div className="field"><label>Specification Text</label><textarea rows={10} value={customSpec?.specText || ''} onChange={(e) => setCustomSpec({ ...customSpec, specText: e.target.value })} /></div>
            <div className="foot">
              <button className="ghost" onClick={back}>Back</button>
              <button onClick={toPreview}>{saving ? 'Saving…' : 'Next →'}</button>
            </div>
          </div>
        )}

        {step === 'preview' && (
          <div className="step">
            <h3>Proposal</h3>
            <div style={{ background: 'var(--navy-700)', border: '1px solid var(--gold)', borderRadius: 8, padding: '12px 14px', margin: '4px 0 16px', maxWidth: 640 }}>
              <label style={{ fontWeight: 700, display: 'block', marginBottom: 4 }}>💳 Payment link</label>
              <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>Already have a payment link in hand? Paste it — the proposal's “Click here to make payment” button will use it. Leave blank otherwise.</div>
              <input type="url" placeholder="https://…" value={paymentLink} onChange={(e) => setPaymentLink(e.target.value)} style={{ width: '100%' }} />
            </div>
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
    </>
  )
}
