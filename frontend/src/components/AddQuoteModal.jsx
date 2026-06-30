import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useConstants, useCreateQuote } from '../hooks'
import { extractParty, putGenerated, uploadExtraFile } from '../api/quotes'
import { rasterizePdf } from '../generator/pdfRaster'
import useAuthStore from '../store/authStore'

const EMPTY = {
  company_name: '', client_name: '', contact: '', address: '',
  job_name: '', special_requirements: '', sales_rep: '', payment_link: '',
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

  const [choice, setChoice] = useState(null)     // null | 'custom' | 'ai'
  const [source, setSource] = useState('file')   // ai: 'file' | 'text' (inline toggle, same page)
  const [form, setForm] = useState(EMPTY)
  const [files, setFiles] = useState([])         // one or more uploaded files
  const [error, setError] = useState('')
  const [autofilling, setAutofilling] = useState(false)
  const [revealed, setRevealed] = useState(false) // party fields show only after AI reads

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  // Merge only into blank fields, so reading a second file (or a re-read) never wipes what's there.
  const mergeParty = (d) => setForm((f) => ({
    ...f,
    company_name: f.company_name || d.company_name || '',
    client_name: f.client_name || d.client_name || '',
    contact: f.contact || d.contact || '',
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
    if (!form.company_name.trim()) return setError('Company Name is required.')
    if (isAdmin() && !form.sales_rep) return setError('Please choose a Sales Representative.')

    const payload = { ...form }
    if (files[0]) payload.customer_pdf = files[0]   // first file is the primary drawing
    try {
      const created = await create.mutateAsync(payload)
      // Keep the rest: extra files + payment link, all in generated_data (nothing is lost).
      const extras = files.slice(1)
      const gd = {}
      if (form.payment_link?.trim()) gd.payment_link = form.payment_link.trim()
      if (extras.length) {
        const paths = []
        for (const f of extras) { try { paths.push(await uploadExtraFile(created.quote_id, f)) } catch { /* skip a bad one */ } }
        if (paths.length) gd.extra_uploads = paths
      }
      if (Object.keys(gd).length) { try { await putGenerated(created.quote_id, gd) } catch { /* non-fatal */ } }
      navigate(`/quotes/${created.quote_id}/generate?mode=${choice}`)
    } catch (err) {
      const errs = err.response?.data?.errors
      setError(errs ? Object.values(errs)[0][0] : (err.response?.data?.error || err.response?.data?.message || 'Failed to create quote'))
    }
  }

  const reps = constants?.sales_reps || []

  const back = () => { setChoice(null); setRevealed(false); setFiles([]); setForm(EMPTY) }

  // The party fields — shared by AI (after read) and Custom.
  const partyFields = (
    <>
      <div className="field">
        <label>Company Name {choice === 'ai' && <span className="muted" style={{ fontWeight: 400 }}>(the sign company on the drawing)</span>}</label>
        <input value={form.company_name} onChange={set('company_name')} />
      </div>
      <div className="grid2">
        <div className="field"><label>Client Name</label><input value={form.client_name} onChange={set('client_name')} /></div>
        <div className="field"><label>Contact (email/phone)</label><input value={form.contact} onChange={set('contact')} /></div>
      </div>
      <div className="field"><label>Address</label><input value={form.address} onChange={set('address')} /></div>
      <div className="field"><label>Job Name</label><input value={form.job_name} onChange={set('job_name')} /></div>
      <div className="field">
        <label>Sales Representative {!isAdmin() && '(you)'}</label>
        {isAdmin() ? (
          <select value={form.sales_rep} onChange={set('sales_rep')}>
            <option value="">— select —</option>
            {reps.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        ) : (<input value={user?.full_name || ''} disabled />)}
      </div>
      <div className="field">
        <label>💳 Payment link (optional — paste it if you already have one)</label>
        <input type="url" placeholder="https://…" value={form.payment_link} onChange={set('payment_link')} />
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
              {partyFields}
              <button type="button" className="ghost sm" disabled={autofilling}
                onClick={() => (source === 'file' ? files.length && autofillFromFiles(files) : autofillFromText())}>
                {autofilling ? 'Reading…' : '↻ Re-read'}
              </button>
            </>
          )}

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
        <h2>New Quote — Custom</h2>
        {partyFields}
        <div className="field">
          <label>Special Requirements</label>
          <textarea rows={2} value={form.special_requirements} onChange={set('special_requirements')} />
        </div>
        <div className="field">
          <label>Customer's sign drawing(s) (optional, PDF or image)</label>
          <input type="file" accept=".pdf,image/*" multiple onChange={(e) => setFiles(Array.from(e.target.files || []))} />
        </div>

        {error && <p className="err">{error}</p>}

        <div className="foot">
          <button type="button" className="ghost" onClick={back}>← Back</button>
          <button type="submit" disabled={create.isPending}>
            {create.isPending ? 'Creating…' : 'Create & Continue →'}
          </button>
        </div>
      </form>
    </div>
  )
}
