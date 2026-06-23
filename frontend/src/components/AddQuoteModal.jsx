import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useConstants, useCreateQuote } from '../hooks'
import { extractParty, putGenerated } from '../api/quotes'
import useAuthStore from '../store/authStore'

const EMPTY = {
  company_name: '', client_name: '', contact: '', address: '',
  job_name: '', special_requirements: '', sales_rep: '', payment_link: '',
}

export default function AddQuoteModal({ onClose }) {
  const navigate = useNavigate()
  const { data: constants } = useConstants()
  const create = useCreateQuote()
  const { user, isAdmin } = useAuthStore()

  const [choice, setChoice] = useState(null)   // null | 'custom' | 'ai'
  const [form, setForm] = useState(EMPTY)
  const [file, setFile] = useState(null)
  const [error, setError] = useState('')
  const [autofilling, setAutofilling] = useState(false)

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  // Real-time autofill of the party/job fields from the uploaded file (or pasted brief).
  // Only fills fields the user hasn't already typed, so it never clobbers manual edits.
  const autofill = async (source) => {
    if (!source || (typeof source === 'string' && !source.trim())) return
    setAutofilling(true); setError('')
    try {
      const d = await extractParty(source)
      setForm((f) => ({
        ...f,
        company_name: f.company_name || d.company_name || '',
        client_name: f.client_name || d.client_name || '',
        contact: f.contact || d.contact || '',
        address: f.address || d.address || '',
        job_name: f.job_name || d.job_name || '',
      }))
    } catch (err) {
      setError('Auto-fill failed: ' + (err.response?.data?.error || err.message || 'unknown error'))
    } finally { setAutofilling(false) }
  }

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (choice === 'custom' && !form.company_name.trim()) return setError('Company Name is required')
    if (choice === 'ai' && !file && !form.special_requirements.trim()) {
      return setError('AI mode needs a PDF/image or some project details to read from.')
    }

    const payload = { ...form }
    if (file) payload.customer_pdf = file
    try {
      const created = await create.mutateAsync(payload)
      // Payment link is captured here on the first page; persist it into generated_data.
      if (form.payment_link?.trim()) {
        try { await putGenerated(created.quote_id, { payment_link: form.payment_link.trim() }) } catch { /* non-fatal */ }
      }
      // Mode is chosen here once and carried in the URL; the wizard never re-asks.
      navigate(`/quotes/${created.quote_id}/generate?mode=${choice}`)
    } catch (err) {
      const errs = err.response?.data?.errors
      setError(errs ? Object.values(errs)[0][0] : (err.response?.data?.error || err.response?.data?.message || 'Failed to create quote'))
    }
  }

  const reps = constants?.sales_reps || []

  // Step 1 — choose how to build
  if (!choice) {
    return (
      <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose(false)}>
        <div className="modal" style={{ width: 620 }}>
          <h2>New Quote — how do you want to start?</h2>
          <div className="choice-row">
            <div className="choice-tile" onClick={() => setChoice('ai')}>
              <div className="ico">⚡</div>
              <h3>AI Mode</h3>
              <p>Upload the customer's PDF/image of the sign required (or paste the brief). AI reads it and pre-fills the sign type and specs.</p>
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

  // Step 2 — quote details form (Quote ID is auto-generated; no Order ID / Source)
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose(false)}>
      <form className="modal" onSubmit={submit}>
        <h2>{choice === 'ai' ? '⚡ New Quote — AI Mode' : 'New Quote — Custom'}</h2>
        <p className="muted" style={{ marginTop: -8, marginBottom: 16 }}>
          A unique Quote ID is assigned automatically.
          {choice === 'ai' && ' Attach the sign PDF/image (or describe the project) — AI extracts the specs next.'}
        </p>

        {choice === 'ai' && (
          <div className="field">
            <label>Customer's PDF/image of the sign required — AI reads this first (max 25 MB)</label>
            <input type="file" accept=".pdf,image/*" autoFocus onChange={(e) => { const f = e.target.files[0] || null; setFile(f); if (f) autofill(f) }} />
            <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
              {autofilling ? '⏳ Reading the file and filling the fields below…' : 'Company, client, contact, address & job auto-fill from the file.'}
            </div>
          </div>
        )}

        <div className="field">
          <label>Company Name {choice === 'custom' ? '*' : '(optional — from the PDF)'}</label>
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
          <label>{choice === 'ai' ? 'Project brief (what the customer wants)' : 'Special Requirements'}</label>
          <textarea rows={choice === 'ai' ? 3 : 2} value={form.special_requirements} onChange={set('special_requirements')} />
          {choice === 'ai' && form.special_requirements.trim() && (
            <button type="button" className="ghost sm" style={{ marginTop: 6 }} disabled={autofilling} onClick={() => autofill(form.special_requirements)}>
              {autofilling ? 'Reading…' : '⚡ Auto-fill fields from this text'}
            </button>
          )}
        </div>

        <div className="field">
          <label>💳 Payment link (optional — paste it if you already have one)</label>
          <input type="url" placeholder="https://…" value={form.payment_link} onChange={set('payment_link')} />
        </div>

        {choice === 'custom' && (
          <div className="field">
            <label>Customer's PDF/image of the sign required (optional, max 25 MB)</label>
            <input type="file" accept=".pdf,image/*" onChange={(e) => setFile(e.target.files[0] || null)} />
          </div>
        )}

        {error && <p className="err">{error}</p>}

        <div className="foot">
          <button type="button" className="ghost" onClick={() => setChoice(null)}>← Back</button>
          <button type="submit" disabled={create.isPending}>
            {create.isPending ? 'Creating…' : choice === 'ai' ? 'Create & Run AI →' : 'Create & Continue →'}
          </button>
        </div>
      </form>
    </div>
  )
}
