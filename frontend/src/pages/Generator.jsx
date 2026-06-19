import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { getQuote, updateQuote, putGenerated, uploadArtwork, uploadCustomerFile, generateSpecs } from '../api/quotes'
import { getLogo, setLogo as apiSetLogo } from '../api/meta'
import { T, CUSTOM_TEMPLATES } from '../generator/catalog'
import { autoAnswerFromAI } from '../generator/questions'
import QA from '../generator/QA'
import Proposal from '../components/Proposal'

const FLOWS = {
  generator: ['client', 'project', 'signtype', 'specs', 'artwork', 'preview'],
  custom: ['client', 'artwork', 'customspecs', 'preview'],
}

export default function Generator() {
  const { quoteId } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [searchParams] = useSearchParams()
  const aiParam = searchParams.get('ai')
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
      getLogo().then((l) => setLogoUrl(l.logo)).catch(() => {})

      const resolvedMode = g.quote_type || null
      if (resolvedMode) {
        setMode(resolvedMode)
        const hasProgress = (resolvedMode === 'generator' && g.tpl_name && Object.keys(g.answers || {}).length)
          || (resolvedMode === 'custom' && g.custom_spec)
        setStep(hasProgress ? 'preview' : FLOWS[resolvedMode][0])
      } else if (aiParam) {
        // Came from Add Quote → AI Mode: jump into generator + auto-run AI
        setMode('generator')
        setStep('project')
        setAutoAi(true)
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
      artwork_path: artworkPath,
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
  const saveProject = async () => {
    await updateQuote(quoteId, { special_requirements: special })
    next()
  }
  const onLogo = async (e) => {
    const f = e.target.files[0]; if (!f) return
    const res = await apiSetLogo(f); setLogoUrl(res.logo)
  }
  const onArtwork = async (e) => {
    const f = e.target.files[0]; if (!f) return
    const path = await uploadArtwork(quoteId, f)
    setArtworkPath(path)
  }
  const onCustomerFile = async (e) => {
    const f = e.target.files[0]; if (!f) return
    await uploadCustomerFile(quoteId, f)
  }
  const runAI = async () => {
    setAiLoading(true)
    setAiStatus('Reading customer details and generating specifications…')
    try {
      await updateQuote(quoteId, { special_requirements: special })
      const result = await generateSpecs(quoteId, special)
      setAi(result)
      // match AI signType to catalog verbatim, then loose contains (V1 logic)
      if (result.signType) {
        const up = result.signType.toUpperCase()
        const found = T.find((t) => t.n === result.signType)
          || T.find((t) => t.n.includes(up)) || T.find((t) => up.includes(t.n))
        if (found) setTpl(found)
      }
      if (result.jobName && !client.job_name) setClient((c) => ({ ...c, job_name: result.jobName }))
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

  // V1 continueFromAI — skip Q&A, use AI defaults, jump to artwork (#80)
  const continueFromAI = () => {
    if (!tpl) { setAiStatus('AI did not return a matching sign type — please pick one manually.'); goto('signtype'); return }
    setAnswers(autoAnswerFromAI(tpl, ai))
    goto('artwork')
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
          <button onClick={() => { setMode('generator'); setStep('client') }}>Quote Generator</button>
          <button className="ghost" onClick={() => { setMode('custom'); setStep('client') }}>Custom Quote Creator</button>
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
            {logo && <div style={{ margin: '8px 0' }}><img src={logo} alt="logo" style={{ height: 40 }} /></div>}
            <label>Company logo (global — appears on all quotes)</label>
            <input type="file" accept="image/*" onChange={onLogo} style={{ marginBottom: 12 }} />
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
              <label>Customer PDF / Image</label>
              <input type="file" accept=".pdf,image/*" onChange={onCustomerFile} />
            </div>
            <div className="ai-box">
              <button onClick={runAI} disabled={aiLoading}>{aiLoading ? 'Generating…' : '⚡ Generate Specs with AI'}</button>
              <span className="muted" style={{ marginLeft: 10 }}>Optional — or fill specs manually in the next steps.</span>
              {aiStatus && <p className="muted" style={{ marginTop: 8 }}>{aiStatus}</p>}
              {ai && (
                <div className="ai-result">
                  <b style={{ color: '#c4b5fd' }}>✔ AI specifications generated</b>
                  {[['Sign Type', ai.signType], ['Job Name', ai.jobName], ['Dimensions', ai.dimensions],
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
                  <p className="muted" style={{ marginTop: 6 }}>Pre-filled as defaults below — review/change, or jump to artwork.</p>
                  <button className="ghost sm" style={{ marginTop: 8 }} onClick={continueFromAI}>Continue to Artwork Upload →</button>
                </div>
              )}
            </div>
            <div className="foot"><button className="ghost" onClick={back}>Back</button><button onClick={saveProject}>Next →</button></div>
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
              <button disabled={!tpl} onClick={() => { setAnswers({}); next() }}>Next →</button>
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
            {artworkPath && <img src={artworkPath} alt="artwork" style={{ maxWidth: 360, display: 'block', margin: '8px 0', border: '1px solid var(--border)', borderRadius: 8 }} />}
            <input ref={artInput} type="file" accept="image/*" onChange={onArtwork} />
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
            <Proposal
              mode={mode}
              tpl={tpl}
              answers={answers}
              customSpec={customSpec}
              info={{ company: client.company_name, client: client.client_name, contact: client.contact, address: client.address, job: client.job_name, quoteId }}
              artworkPath={artworkPath}
              logo={logo}
              savedState={gd?.proposal_state}
              onSave={(proposalState) => saveProgress({ proposal_state: proposalState })}
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
