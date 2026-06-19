import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuotes, useConstants, useUpdateQuote, useDeleteQuote } from '../hooks'
import useAuthStore from '../store/authStore'

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
  const del = useDeleteQuote()

  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [viewing, setViewing] = useState(null)

  const params = {}
  if (search) params.search = search
  if (status) params.status = status
  const { data: quotes = [], isLoading } = useQuotes(params)

  const statuses = constants?.statuses || []
  const reps = constants?.sales_reps || []
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
                <th>Sales Rep</th><th>Status</th><th>Files</th><th></th>
              </tr>
            </thead>
            <tbody>
              {quotes.map((q) => (
                <tr key={q.id}>
                  <td><b>{q.quote_id}</b></td>
                  <td><EditCell value={q.company_name} onCommit={(v) => patch(q.quote_id, 'company_name', v)} width={140} /></td>
                  <td><EditCell value={q.client_name} onCommit={(v) => patch(q.quote_id, 'client_name', v)} /></td>
                  <td><EditCell value={q.contact} onCommit={(v) => patch(q.quote_id, 'contact', v)} /></td>
                  <td><EditCell value={q.job_name} onCommit={(v) => patch(q.quote_id, 'job_name', v)} /></td>
                  <td><EditCell value={q.price} type="number" width={80} onCommit={(v) => patch(q.quote_id, 'price', v)} /></td>
                  <td>
                    {admin ? (
                      <select value={q.sales_rep || ''} style={{ width: 110 }} onChange={(e) => patch(q.quote_id, 'sales_rep', e.target.value)}>
                        <option value="">—</option>
                        {reps.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                    ) : (q.sales_rep || '—')}
                  </td>
                  <td>
                    <select value={q.status} style={{ width: 150 }} onChange={(e) => patch(q.quote_id, 'status', e.target.value)}>
                      {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {q.customer_pdf && <a href={q.customer_pdf} target="_blank" rel="noreferrer">PDF</a>}{' '}
                    {q.artwork_url && <a href={q.artwork_url} target="_blank" rel="noreferrer">Art</a>}{' '}
                    {q.crunched_artwork && <a href={q.crunched_artwork} target="_blank" rel="noreferrer">Crunch</a>}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="ghost sm" onClick={() => setViewing(q)}>View</button>{' '}
                    <button className="ghost sm" onClick={() => navigate(`/quotes/${q.quote_id}/generate`)}>Edit</button>{' '}
                    <button className="danger sm" onClick={() => remove(q)}>Delete</button>
                  </td>
                </tr>
              ))}
              {quotes.length === 0 && <tr><td colSpan={10} className="center">No quotes found.</td></tr>}
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
              ['Price', viewing.price], ['Sales Rep', viewing.sales_rep],
              ['Status', viewing.status],
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
