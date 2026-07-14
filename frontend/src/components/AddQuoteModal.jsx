import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useConstants, useCreateQuote } from '../hooks'
import { extractParty, putGenerated, uploadExtraFile } from '../api/quotes'
import { rasterizePdf } from '../generator/pdfRaster'
import useAuthStore from '../store/authStore'
import client from '../api/client'

const EMPTY = {
  company_name: '', client_name: '', contact: '', email: '', address: '',
  job_name: '', special_requirements: '', sales_rep: '', quote_source: '',
}

// Turn a data URL (rasterized PDF page) into a File so the vision model can read it.
function dataURLtoFile(dataUrl, name) {
  const [head, b64] = dataUrl.split(',')
  const mime = (head.match(/:(.*?);/) || [, 'image/png'])[1]
  const bin = atob(b64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return new File([arr], name, { type: mime })
}

export default function AddQuoteModal({ onClose }) {
  const navigate = useNavigate()
  const { data: constants } = useConstants()
  const create = useCreateQuote()
  const { user, isAdmin } = useAuthStore()

  // AI mode is paused (#8): open straight into Custom and skip the "AI vs Custom" chooser.
  // Set back to useState(null) to bring the chooser (and AI mode) back.
  const [choice, setChoice] = useState('custom') // null | 'custom' | 'ai'
  const [source, setSource] = useState('file')   // ai: 'file' | 'text' (inline toggle, same page)
  const [form, setForm] = useState(EMPTY)
  const [files, setFiles] = useState([])         // one or more uploaded files
  const [error, setError] = useState('')
  const [autofilling, setAutofilling] = useState(false)
  const [revealed, setRevealed] = useState(false) // party fields show only after AI reads
  const [repOther, setRepOther] = useState(false)  // typing a custom sales rep

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  // Company autofill (#8/#9): known companies suggest as you type. When you land on an exact
  // known company we bring back its address AND its most-recent saved contact (client name,
  // phone, email) — every real contact the team typed before, kept per-company so Signarama and
  // "Signarama Redmond" never share data. A field you've hand-edited is never overwritten; if a
  // company has several past contacts a picker appears so you can choose one.
  const [companyHits, setCompanyHits] = useState([])
  const [exactHit, setExactHit] = useState(null)   // the matched company (with .contacts) for the picker
  const autoFilled = useRef({ address: '', client_name: '', contact: '', email: '' })
  // apply a saved contact into any field the user hasn't manually changed
  const applyAuto = (patch) => {
    // Snapshot the previous auto-values BEFORE mutating the ref: React runs the setForm updater
    // later (batched), so mutating first made the updater compare the old field value against the
    // NEW patch — every field looked "manually edited" and picking a second company changed nothing.
    const prevAuto = { ...autoFilled.current }
    autoFilled.current = { ...autoFilled.current, ...patch }
    setForm((f) => {
      const next = { ...f }
      for (const k of Object.keys(patch)) {
        const wasAuto = !f[k] || f[k] === prevAuto[k]
        if (wasAuto) next[k] = patch[k] || ''
      }
      return next
    })
  }
  const onCompanyChange = async (e) => {
    const name = e.target.value
    setForm((f) => ({ ...f, company_name: name }))
    if (name.trim().length < 2) { setCompanyHits([]); setExactHit(null); return }
    try {
      const { data } = await client.get('/companies/suggest', { params: { q: name } })
      setCompanyHits(data || [])
      const hit = (data || []).find((c) => c.name.toLowerCase() === name.trim().toLowerCase())
      setExactHit(hit || null)
      if (hit) {
        // Dropdown-ONLY autofill (#3, Sami 2026-07-14): a known company fills its ADDRESS, but
        // contact details are never auto-applied — the rep picks the exact contact from the
        // dropdown below (the data still carries duplicates/mislabeled rows; auto-applying the
        // first one kept picking wrong people).
        applyAuto({ address: hit.address || '' })
        // pre-pick the rep who handled this company's latest quote (#5) — only when untouched
        if (hit.last_sales_rep) {
          setForm((f) => (f.sales_rep ? f : { ...f, sales_rep: hit.last_sales_rep }))
        }
      }
    } catch { /* suggestions are best-effort */ }
  }
  // pick a specific saved contact from the dropdown
  const applyContact = (c) => applyAuto({ client_name: c.client_name || '', contact: c.contact || '', email: c.email || '' })

  // Merge only into blank fields, so reading a second file (or a re-read) never wipes what's there.
  const mergeParty = (d) => setForm((f) => ({
    ...f,
    company_name: f.company_name || d.company_name || '',
    client_name: f.client_name || d.client_name || '',
    contact: f.contact || d.contact || '',
    email: f.email || d.email || '',          // was dropped — email never made it in from autofill
    address: f.address || d.address || '',
    job_name: f.job_name || d.job_name || '',
  }))

  // Read EVERY uploaded file for the party fields. PDFs are rendered to an image first so the
  // vision model can read the sign company's LOGO (where the company name usually lives).
  const autofillFromFiles = async (fs) => {
    if (!fs.length) return
    setAutofilling(true); setError('')
    try {
      for (const f of fs) {
        let toRead = f
        const isPdf = f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
        if (isPdf) {
          const url = URL.createObjectURL(f)
          const dataUrl = await rasterizePdf(url)
          URL.revokeObjectURL(url)
          if (dataUrl) toRead = dataURLtoFile(dataUrl, 'page.png')
        }
        try { mergeParty(await extractParty(toRead)) } catch { /* keep going with the rest */ }
      }
    } finally {
      setAutofilling(false); setRevealed(true)
    }
  }

  const autofillFromText = async () => {
    const t = form.special_requirements.trim()
    if (!t) return
    setAutofilling(true); setError('')
    try {
      mergeParty(await extractParty(t))
    } catch (err) {
      setError('Auto-fill failed: ' + (err.response?.data?.error || err.message || 'unknown error'))
    } finally {
      setAutofilling(false); setRevealed(true)
    }
  }

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    // At least ONE of Company / Client is required — either is fine (#7).
    if (!form.company_name.trim() && !form.client_name.trim()) return setError('Enter a Company Name or a Client Name (at least one).')
    // Job Name is required (#6).
    if (!form.job_name.trim()) return setError('Job Name is required.')
    // Sales rep is optional (#13): blank = N/A (shared quote). Payment links are created
    // later from the proposal via Shopify — they're never pasted in at intake anymore.

    const payload = { ...form }
    // If this is a KNOWN company and the address you typed differs from the one on file,
    // offer to update the company's saved details (#5) — otherwise the old address stays.
    const known = companyHits.find((c) => c.name.toLowerCase() === form.company_name.trim().toLowerCase())
    const newAddr = form.address.trim()
    if (known && newAddr && newAddr !== (known.address || '').trim()) {
      const msg = known.address
        ? `You entered a different address for "${form.company_name}".\n\nOn file:  ${known.address}\nEntered:  ${newAddr}\n\nUpdate this company's saved address?`
        : `"${form.company_name}" has no saved address yet.\n\nSave "${newAddr}" as this company's address?`
      if (window.confirm(msg)) payload.update_company_address = true
    }
    if (files[0]) payload.customer_pdf = files[0]   // first file is the primary drawing
    try {
      const created = await create.mutateAsync(payload)
      // Keep the extra uploaded files in generated_data (nothing is lost).
      const extras = files.slice(1)
      const gd = {}
      if (extras.length) {
        const paths = []
        for (const f of extras) { try { paths.push(await uploadExtraFile(created.quote_id, f)) } catch { /* skip a bad one */ } }
        if (paths.length) gd.extra_uploads = paths
      }
      if (Object.keys(gd).length) { try { await putGenerated(created.quote_id, gd) } catch { /* non-fatal */ } }
      navigate(`/quotes/${created.quote_id}/generate?mode=${choice}`, { state: { from: '/quotes' } })
    } catch (err) {
      const errs = err.response?.data?.errors
      setError(errs ? Object.values(errs)[0][0] : (err.response?.data?.error || err.response?.data?.message || 'Failed to create quote'))
    }
  }

  const reps = constants?.sales_reps || []

  const back = () => { setChoice(null); setRevealed(false); setFiles([]); setForm(EMPTY) }

  // Party fields that AI fills in (shown only after the read in AI mode; always in Custom).
  const extractedFields = (
    <>
      <div className="field">
        <label>Company Name <span className="muted" style={{ fontWeight: 400 }}>(Company or Client required)</span>{choice === 'ai' && <span className="muted" style={{ fontWeight: 400 }}> — the sign company on the drawing</span>}</label>
        <input list="company-suggestions" placeholder="Start typing — repeat customers autofill" value={form.company_name} onChange={onCompanyChange} />
        <datalist id="company-suggestions">
          {companyHits.map((c) => <option key={c.name} value={c.name} />)}
        </datalist>
        {exactHit && (
          <div className="muted" style={{ fontSize: 11, color: 'var(--gold)', marginTop: 4 }}>✓ Known company — details autofilled (edit anything that changed)</div>
        )}
        {exactHit && (exactHit.contacts || []).length > 0 && (
          <select
            style={{ marginTop: 6, fontSize: 12 }}
            onChange={(e) => { const c = exactHit.contacts[Number(e.target.value)]; if (c) applyContact(c) }}
            defaultValue=""
            title="Every saved contact for this company — pick one to autofill"
          >
            <option value="" disabled>Saved contacts for this company ({exactHit.contacts.length}) — pick one…</option>
            {exactHit.contacts.map((c, i) => (
              <option key={i} value={i}>{[c.client_name, c.contact, c.email].filter(Boolean).join(' · ') || '(blank)'}</option>
            ))}
          </select>
        )}
      </div>
      <div className="grid2">
        <div className="field"><label>Client Name <span className="muted" style={{ fontWeight: 400 }}>(Company or Client required)</span></label><input value={form.client_name} onChange={set('client_name')} /></div>
        <div className="field"><label>Phone</label><input inputMode="tel" placeholder="digits only" value={form.contact} onChange={(e) => setForm((f) => ({ ...f, contact: e.target.value.replace(/[^0-9()+\-.\s]/g, '') }))} /></div>
      </div>
      <div className="field"><label>Email</label><input type="email" placeholder="name@company.com" value={form.email} onChange={set('email')} /></div>
      <div className="field"><label>Address</label><input value={form.address} onChange={set('address')} /></div>
      <div className="field"><label>Job Name <span className="muted" style={{ fontWeight: 400 }}>(required)</span></label><input value={form.job_name} onChange={set('job_name')} /></div>
      <div className="field">
        <label>Where did this quote come from?</label>
        <select value={form.quote_source} onChange={set('quote_source')}>
          <option value="">— not sure —</option>
          {(constants?.quote_sources || []).map((qs) => <option key={qs} value={qs}>{qs}</option>)}
        </select>
      </div>
    </>
  )
  // Rep + payment link — not AI-driven, so always shown up front.
  const repPayFields = (
    <>
      <div className="field">
        <label>Sales Representative {isAdmin() ? '(optional)' : '(you)'}</label>
        {isAdmin() ? (() => {
          const custom = repOther || (form.sales_rep && !reps.includes(form.sales_rep))
          return (
            <>
              <select
                value={custom ? '__other__' : form.sales_rep}
                onChange={(e) => {
                  if (e.target.value === '__other__') { setRepOther(true); setForm((f) => ({ ...f, sales_rep: '' })) }
                  else { setRepOther(false); setForm((f) => ({ ...f, sales_rep: e.target.value })) }
                }}
              >
                <option value="">— N/A (no rep — shared) —</option>
                {reps.map((r) => <option key={r} value={r}>{r}</option>)}
                <option value="__other__">Other (type a name)…</option>
              </select>
              {custom && (
                <input style={{ marginTop: 8 }} placeholder="Type the sales rep's name" autoFocus
                  value={form.sales_rep} onChange={set('sales_rep')} />
              )}
            </>
          )
        })() : (<input value={user?.full_name || ''} disabled />)}
      </div>
    </>
  )

  // ---- Step 1: AI vs Custom ----
  if (!choice) {
    return (
      <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose(false)}>
        <div className="modal modal-quote">
          <h2>New Quote — how do you want to start?</h2>
          <div className="choice-row">
            <div className="choice-tile" onClick={() => setChoice('ai')}>
              <div className="ico">⚡</div>
              <h3>AI Mode</h3>
              <p>Give us the customer's drawing or brief. AI reads it and fills in the company, client and specs.</p>
            </div>
            <div className="choice-tile" onClick={() => setChoice('custom')}>
              <div className="ico">✍️</div>
              <h3>Custom</h3>
              <p>Write the specification yourself — straight to the custom questions, no AI.</p>
            </div>
          </div>
          <div className="foot"><button className="ghost" onClick={() => onClose(false)}>Cancel</button></div>
        </div>
      </div>
    )
  }

  // ---- AI Mode: one page. Inline File/Text toggle, then the details fill in below after AI reads. ----
  if (choice === 'ai') {
    return (
      <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose(false)}>
        <form className="modal modal-quote" onSubmit={submit}>
          <h2>⚡ New Quote — AI Mode</h2>
          <p className="muted" style={{ marginTop: -8, marginBottom: 12 }}>Give us the sign as file(s) or text — AI reads it and fills the details below.</p>

          <div className="seg">
            <button type="button" className={'seg-btn' + (source === 'file' ? ' on' : '')} onClick={() => setSource('file')}>📄 Upload file(s)</button>
            <button type="button" className={'seg-btn' + (source === 'text' ? ' on' : '')} onClick={() => setSource('text')}>✉️ Paste text</button>
          </div>

          {source === 'file' ? (
            <div className="field">
              <label>Upload the sign drawing(s) — PDF or image, you can add more than one (max 25 MB each)</label>
              <input type="file" accept=".pdf,image/*" multiple autoFocus
                onChange={(e) => { const fs = Array.from(e.target.files || []); setFiles(fs); if (fs.length) autofillFromFiles(fs) }} />
              {files.length > 0 && <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{files.length} file(s): {files.map((f) => f.name).join(', ')}</div>}
            </div>
          ) : (
            <div className="field">
              <label>Paste the customer's email or brief</label>
              <textarea rows={4} value={form.special_requirements} onChange={set('special_requirements')} placeholder="Paste here…" />
              {!revealed && (
                <button type="button" className="ghost sm" style={{ marginTop: 6 }} disabled={autofilling || !form.special_requirements.trim()} onClick={autofillFromText}>
                  {autofilling ? 'Reading…' : 'Read it →'}
                </button>
              )}
            </div>
          )}

          {!revealed && (
            <p className="muted" style={{ fontSize: 13 }}>
              {autofilling ? '⏳ Reading your upload(s) and filling the details…' : 'The company, client, contact, address and job will fill in here once AI reads.'}
            </p>
          )}

          {revealed && (
            <>
              {extractedFields}
              <button type="button" className="ghost sm" disabled={autofilling} style={{ marginBottom: 14 }}
                onClick={() => (source === 'file' ? files.length && autofillFromFiles(files) : autofillFromText())}>
                {autofilling ? 'Reading…' : '↻ Re-read'}
              </button>
            </>
          )}

          {repPayFields}

          {error && <p className="err">{error}</p>}

          <div className="foot">
            <button type="button" className="ghost" onClick={back}>← Back</button>
            <button type="submit" disabled={create.isPending || !revealed}>
              {create.isPending ? 'Creating…' : 'Create & Run AI →'}
            </button>
          </div>
        </form>
      </div>
    )
  }

  // ---- Custom mode ----
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose(false)}>
      <form className="modal modal-quote" onSubmit={submit}>
        <h2>New Quote</h2>
        {extractedFields}
        {repPayFields}
        {/* Artwork is NOT asked here anymore (#5) — it's collected once, on the Artwork step near
            the end of the wizard. Special requirements live on the Custom Specifications page. */}

        {error && <p className="err">{error}</p>}

        <div className="foot">
          <button type="button" className="ghost" onClick={() => onClose(false)}>Cancel</button>
          <button type="submit" disabled={create.isPending}>
            {create.isPending ? 'Creating…' : 'Create & Continue →'}
          </button>
        </div>
      </form>
    </div>
  )
}
