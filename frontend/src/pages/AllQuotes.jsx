import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuotes, useConstants, useUpdateQuote, useUpdateStatus, useUpdateTags, useDeleteQuote } from '../hooks'
import useAuthStore from '../store/authStore'
import { fileUrl } from '../api/client'

// Commits on blur only when the value actually changed
function EditCell({ value, onCommit, type = 'text', width = 120 }) {
  const [v, setV] = useState(value ?? '')
  const commit = () => { if (String(v) !== String(value ?? '')) onCommit(v) }
  return (
    <input
      type={type}
      value={v}
      style={{ width }}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
    />
  )
}

export default function AllQuotes() {
  const navigate = useNavigate()
  const { isAdmin } = useAuthStore()
  const { data: constants } = useConstants()
  const update = useUpdateQuote()
  const updateStatus = useUpdateStatus()
  const updateTags = useUpdateTags()
  const del = useDeleteQuote()

  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [mine, setMine] = useState(false)
  const [viewing, setViewing] = useState(null)

  const params = {}
  if (search) params.search = search
  if (status) params.status = status
  if (mine) params.assigned = 'me'
  const { data: quotes = [], isLoading } = useQuotes(params)

  const statuses = constants?.statuses || []
  const reps = constants?.sales_reps || []
  const team = constants?.team || []
  const admin = isAdmin()

  const patch = (id, field, value) => update.mutate({ id, patch: { [field]: value } })

  const remove = (q) => {
    if (window.confirm(`Delete quote ${q.quote_id}? This cannot be undone.`)) del.mutate(q.quote_id)
  }

  return (
    <>
      <div className="page-head"><h1>All Quotes</h1></div>

      <div className="toolbar">
        <input className="grow" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 'auto' }}>
          <option value="">All statuses</option>
          <option value="__pending__">Pending (not Done)</option>
          {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', cursor: 'pointer' }} title="Only quotes assigned to me">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} style={{ width: 'auto' }} />
          My quotes
        </label>
      </div>

      {isLoading ? (
        <div className="center">Loading…</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Quote ID</th><th>Company</th><th>Client</th><th>Contact</th>
                <th>Job</th><th>Price</th>
                <th>Sales Rep</th><th>Assigned</th><th>Status</th><th>Files</th><th></th>
              </tr>
            </thead>
            <tbody>
              {quotes.map((q) => (
                <tr key={q.id}>
                  <td><b>{q.quote_id}</b>{q.is_test && <span className="pill pill-amber" style={{ marginLeft: 6, fontSize: 10 }}>TEST</span>}</td>
                  <td><EditCell value={q.company_name} onCommit={(v) => patch(q.quote_id, 'company_name', v)} width={140} /></td>
                  <td><EditCell value={q.client_name} onCommit={(v) => patch(q.quote_id, 'client_name', v)} /></td>
                  <td><EditCell value={q.contact} onCommit={(v) => patch(q.quote_id, 'contact', v)} /></td>
                  <td><EditCell value={q.job_name} onCommit={(v) => patch(q.quote_id, 'job_name', v)} /></td>
                  <td><EditCell value={q.price ?? ''} type="number" width={80} onCommit={(v) => patch(q.quote_id, 'price', v)} /></td>
                  <td>
                    {admin ? (
                      <select value={q.sales_rep || ''} style={{ width: 110 }} onChange={(e) => patch(q.quote_id, 'sales_rep', e.target.value)}>
                        <option value="">—</option>
                        {reps.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                    ) : (q.sales_rep || '—')}
                  </td>
                  <td>
                    <select value={q.assigned_to || ''} style={{ width: 110 }} title="Who is working this quote" onChange={(e) => patch(q.quote_id, 'assigned_to', e.target.value)}>
                      <option value="">—</option>
                      {team.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </td>
                  <td>
                    <select value={q.status} style={{ width: 150 }} onChange={(e) => updateStatus.mutate({ id: q.quote_id, status: e.target.value })}>
                      {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                    {/* extra "also waiting on…" chips — a quote can wait on several people at once.
                        The main status drives the numbers; chips add visibility. */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4, maxWidth: 190, alignItems: 'center' }}>
                      {(q.tags || []).map((t) => (
                        <span key={t} className="pill pill-purple" style={{ cursor: 'pointer', fontSize: 10 }} title="Click to remove"
                          onClick={() => updateTags.mutate({ id: q.quote_id, tags: (q.tags || []).filter((x) => x !== t) })}>
                          {t} ×
                        </span>
                      ))}
                      <select value="" style={{ width: 26, padding: '0 2px', height: 20, fontSize: 11 }} title="Also waiting on…"
                        onChange={(e) => { const t = e.target.value; if (t) updateTags.mutate({ id: q.quote_id, tags: [...new Set([...(q.tags || []), t])] }) }}>
                        <option value="">+</option>
                        {statuses.filter((s) => s !== q.status && s !== 'Done' && !(q.tags || []).includes(s)).map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {q.customer_pdf && <a href={fileUrl(q.customer_pdf)} target="_blank" rel="noreferrer">PDF</a>}{' '}
                    {q.artwork_url && <a href={fileUrl(q.artwork_url)} target="_blank" rel="noreferrer">Art</a>}{' '}
                    {q.crunched_artwork && <a href={fileUrl(q.crunched_artwork)} target="_blank" rel="noreferrer">Crunch</a>}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="ghost sm" onClick={() => setViewing(q)}>View</button>{' '}
                    <button className="ghost sm" onClick={() => navigate(`/quotes/${q.quote_id}/generate`)}>Edit</button>{' '}
                    {admin && <><button className="ghost sm" title="Everything that ever happened to this quote" onClick={() => navigate(`/activity?quote=${q.quote_id}`)}>History</button>{' '}</>}
                    {admin && <><button className="ghost sm" title={q.is_test ? 'Unmark test — counts again in all numbers' : 'Mark as TEST — excluded from every KPI, pipeline and report'} onClick={() => patch(q.quote_id, 'is_test', !q.is_test)}>{q.is_test ? 'Untest' : 'Test'}</button>{' '}</>}
                    <button className="danger sm" onClick={() => remove(q)}>Delete</button>
                  </td>
                </tr>
              ))}
              {quotes.length === 0 && <tr><td colSpan={11} className="center">No quotes found.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {viewing && (
        <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setViewing(null)}>
          <div className="modal">
            <h2>Quote {viewing.quote_id}</h2>
            {[
              ['Company', viewing.company_name], ['Client', viewing.client_name],
              ['Contact', viewing.contact], ['Address', viewing.address],
              ['Job', viewing.job_name],
              ['Price', viewing.price ? `$${Number(viewing.price).toLocaleString()}` : '—'], ['Sales Rep', viewing.sales_rep],
              ['Status', viewing.status], ['Assigned To', viewing.assigned_to],
              ['Special Requirements', viewing.special_requirements],
              ['Created By', viewing.added_by], ['Finalized By', viewing.created_by_name],
            ].map(([k, v]) => (
              <div key={k} className="line" style={{ marginBottom: 6 }}><span className="muted">{k}:</span> {v || '—'}</div>
            ))}
            <div className="foot"><button onClick={() => setViewing(null)}>Close</button></div>
          </div>
        </div>
      )}
    </>
  )
}
