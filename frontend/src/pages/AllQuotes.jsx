import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuotes, useConstants, useUpdateQuote, useUpdateStatus, useUpdateTags, useDeleteQuote } from '../hooks'
import useAuthStore from '../store/authStore'
import { fileUrl } from '../api/client'
import { useSortable, SortTh, useColumns, ColumnPicker, gridKeyNav } from '../components/grid'

// Commits on blur only when the value actually changed
function EditCell({ value, onCommit, type = 'text', width = 120, col, row }) {
  const [v, setV] = useState(value ?? '')
  const commit = () => { if (String(v) !== String(value ?? '')) onCommit(v) }
  return (
    <input
      type={type}
      value={v}
      style={{ width }}
      data-col={col}
      data-row={row}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => (col != null ? gridKeyNav(e, col, row) : e.key === 'Enter' && e.currentTarget.blur())}
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
  const [rushOnly, setRushOnly] = useState(false)
  const [sourceF, setSourceF] = useState('')
  const [viewing, setViewing] = useState(null)

  const params = {}
  if (search) params.search = search
  if (status) params.status = status
  if (mine) params.assigned = 'me'
  if (rushOnly) params.rush = '1'
  if (sourceF) params.source = sourceF
  const { data: quotes = [], isLoading } = useQuotes(params)
  const sort = useSortable(quotes)
  // Grid v2: hideable columns (choice remembered per browser)
  const columns = useColumns('aq_cols', [
    { key: 'company', label: 'Company' }, { key: 'client', label: 'Client' }, { key: 'contact', label: 'Contact' },
    { key: 'job', label: 'Job' }, { key: 'price', label: 'Price' }, { key: 'be', label: 'Breakevens' },
    { key: 'profit', label: 'Profit' }, { key: 'rep', label: 'Sales Rep' }, { key: 'assigned', label: 'Assigned' },
    { key: 'rush', label: 'Rush' }, { key: 'approval', label: 'Approval' }, { key: 'order', label: 'Order' },
    { key: 'files', label: 'Files' },
  ])

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
        <select value={sourceF} onChange={(e) => setSourceF(e.target.value)} style={{ width: 'auto' }} title="Filter by where the quote came from">
          <option value="">All sources</option>
          {(constants?.quote_sources || []).map((qs) => <option key={qs} value={qs}>{qs}</option>)}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', cursor: 'pointer' }} title="Only Rush / Super Rush quotes">
          <input type="checkbox" checked={rushOnly} onChange={(e) => setRushOnly(e.target.checked)} style={{ width: 'auto' }} />
          Rush only
        </label>
        <ColumnPicker columns={columns} />
      </div>

      {isLoading ? (
        <div className="center">Loading…</div>
      ) : (
        <div className="grid-wrap" style={{ overflow: 'auto', maxHeight: '72vh' }}>
          <table>
            <thead>
              <tr>
                <th title="Row number">#</th>
                <SortTh k="quote_id" sort={sort}>Quote ID</SortTh>
                {columns.has('company') && <SortTh k="company_name" sort={sort}>Company</SortTh>}
                {columns.has('client') && <SortTh k="client_name" sort={sort}>Client</SortTh>}
                {columns.has('contact') && <th>Contact</th>}
                {columns.has('job') && <SortTh k="job_name" sort={sort}>Job</SortTh>}
                {columns.has('price') && <SortTh k="price" sort={sort}>Price</SortTh>}
                {columns.has('be') && <th title="Breakeven production cost — internal only">BE Prod</th>}
                {columns.has('be') && <th title="Breakeven shipping cost — internal only">BE Ship</th>}
                {columns.has('profit') && <SortTh k="profit" sort={sort} title="Auto: price minus breakevens — internal only. Click to sort.">Profit</SortTh>}
                {columns.has('rep') && <SortTh k="sales_rep" sort={sort}>Sales Rep</SortTh>}
                {columns.has('assigned') && <SortTh k="assigned_to" sort={sort}>Assigned</SortTh>}
                {columns.has('rush') && <SortTh k="rush" sort={sort}>Rush</SortTh>}
                {columns.has('approval') && <th title="Price approval: ✓ = approved (who/when logged); 🔒 = locked — cannot send PDF/PNG/payment link until approved">Approval</th>}
                {columns.has('order') && <th title="Customer placed the order — date is stamped automatically">Order</th>}
                <SortTh k="status" sort={sort}>Status</SortTh>{columns.has('files') && <th>Files</th>}<th></th>
              </tr>
            </thead>
            <tbody>
              {sort.sorted.map((q, i) => (
                <tr key={q.id}>
                  <td className="muted" style={{ fontSize: 11 }}>{i + 1}</td>
                  <td><b>{q.quote_id}</b>{q.is_test && <span className="pill pill-amber" style={{ marginLeft: 6, fontSize: 10 }}>TEST</span>}{q.rush === 'Super Rush' && <span className="pill pill-coral" style={{ marginLeft: 6, fontSize: 10 }}>SUPER RUSH</span>}{q.rush === 'Rush' && <span className="pill pill-amber" style={{ marginLeft: 6, fontSize: 10 }}>RUSH</span>}</td>
                  {columns.has('company') && <td><EditCell col="company" row={i} value={q.company_name} onCommit={(v) => patch(q.quote_id, 'company_name', v)} width={140} /></td>}
                  {columns.has('client') && <td><EditCell col="client" row={i} value={q.client_name} onCommit={(v) => patch(q.quote_id, 'client_name', v)} /></td>}
                  {columns.has('contact') && <td><EditCell col="contact" row={i} value={q.contact} onCommit={(v) => patch(q.quote_id, 'contact', v)} /></td>}
                  {columns.has('job') && <td><EditCell col="job" row={i} value={q.job_name} onCommit={(v) => patch(q.quote_id, 'job_name', v)} /></td>}
                  {columns.has('price') && <td><EditCell col="price" row={i} value={q.price ?? ''} type="number" width={80} onCommit={(v) => patch(q.quote_id, 'price', v)} /></td>}
                  {columns.has('be') && <td><EditCell col="bep" row={i} value={q.breakeven_production ?? ''} type="number" width={70} onCommit={(v) => patch(q.quote_id, 'breakeven_production', v)} /></td>}
                  {columns.has('be') && <td><EditCell col="bes" row={i} value={q.breakeven_shipping ?? ''} type="number" width={70} onCommit={(v) => patch(q.quote_id, 'breakeven_shipping', v)} /></td>}
                  {columns.has('profit') && <td style={{ whiteSpace: 'nowrap', fontWeight: 600, color: q.profit == null ? undefined : q.profit >= 0 ? '#97c459' : '#e5484d' }}>
                    {q.profit == null ? '—' : `$${Number(q.profit).toLocaleString()} (${q.profit_pct}%)`}
                  </td>}
                  {columns.has('rep') && <td>
                    {admin ? (
                      <select value={q.sales_rep || ''} style={{ width: 110 }} onChange={(e) => patch(q.quote_id, 'sales_rep', e.target.value)}>
                        <option value="">—</option>
                        {reps.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                    ) : (q.sales_rep || '—')}
                  </td>}
                  {columns.has('assigned') && <td>
                    <select value={q.assigned_to || ''} style={{ width: 110 }} title="Who is working this quote" onChange={(e) => patch(q.quote_id, 'assigned_to', e.target.value)}>
                      <option value="">—</option>
                      {team.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </td>}
                  {columns.has('rush') && <td>
                    <select value={q.rush || ''} style={{ width: 100, ...(q.rush === 'Super Rush' ? { borderColor: '#e5484d', color: '#e5484d', fontWeight: 700 } : q.rush === 'Rush' ? { borderColor: '#f9a600', color: '#f9a600', fontWeight: 600 } : {}) }} title="Rush level — rush quotes jump the needs-attention queue" onChange={(e) => patch(q.quote_id, 'rush', e.target.value)}>
                      <option value="">—</option>
                      <option value="Rush">Rush</option>
                      <option value="Super Rush">Super Rush</option>
                    </select>
                  </td>}
                  {columns.has('approval') && <td style={{ whiteSpace: 'nowrap' }}>
                    <label title={q.price_approved ? `Approved by ${q.approved_by}${q.approved_at ? ' on ' + new Date(q.approved_at).toLocaleDateString() : ''}` : 'Tick to approve the price (you + date are logged)'} style={{ cursor: 'pointer' }}>
                      <input type="checkbox" checked={!!q.price_approved} style={{ width: 'auto' }} onChange={(e) => patch(q.quote_id, 'price_approved', e.target.checked)} /> ✓
                    </label>{' '}
                    <label title={q.approval_locked ? 'LOCKED — PDF/PNG/payment link blocked until the price is approved. Click to unlock.' : 'Lock this quote until the price is approved'} style={{ cursor: 'pointer', opacity: q.approval_locked ? 1 : 0.5 }}>
                      <input type="checkbox" checked={!!q.approval_locked} style={{ width: 'auto' }} onChange={(e) => patch(q.quote_id, 'approval_locked', e.target.checked)} /> 🔒
                    </label>
                  </td>}
                  {columns.has('order') && <td style={{ textAlign: 'center' }}>
                    <label title={q.order_confirmed ? `Order placed${q.order_placed_at ? ' on ' + new Date(q.order_placed_at).toLocaleDateString() : ''}` : 'Tick when the customer places the order (date is stamped)'} style={{ cursor: 'pointer' }}>
                      <input type="checkbox" checked={!!q.order_confirmed} style={{ width: 'auto' }} onChange={(e) => patch(q.quote_id, 'order_confirmed', e.target.checked)} /> 📦
                    </label>
                  </td>}
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
                  {columns.has('files') && <td style={{ whiteSpace: 'nowrap' }}>
                    {q.customer_pdf && <a href={fileUrl(q.customer_pdf)} target="_blank" rel="noreferrer">PDF</a>}{' '}
                    {q.artwork_url && <a href={fileUrl(q.artwork_url)} target="_blank" rel="noreferrer">Art</a>}{' '}
                    {q.crunched_artwork && <a href={fileUrl(q.crunched_artwork)} target="_blank" rel="noreferrer">Crunch</a>}
                  </td>}
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="ghost sm" onClick={() => setViewing(q)}>View</button>{' '}
                    <button className="ghost sm" onClick={() => navigate(`/quotes/${q.quote_id}/generate`)}>Edit</button>{' '}
                    {admin && <><button className="ghost sm" title="Everything that ever happened to this quote" onClick={() => navigate(`/activity?quote=${q.quote_id}`)}>History</button>{' '}</>}
                    {admin && <><button className="ghost sm" title={q.is_test ? 'Unmark test — counts again in all numbers' : 'Mark as TEST — excluded from every KPI, pipeline and report'} onClick={() => patch(q.quote_id, 'is_test', !q.is_test)}>{q.is_test ? 'Untest' : 'Test'}</button>{' '}</>}
                    <button className="danger sm" onClick={() => remove(q)}>Delete</button>
                  </td>
                </tr>
              ))}
              {quotes.length === 0 && <tr><td colSpan={18} className="center">No quotes found.</td></tr>}
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
              ['Price', viewing.price ? `$${Number(viewing.price).toLocaleString()}` : '—'],
              ['Breakeven (production + shipping)', (viewing.breakeven_production != null || viewing.breakeven_shipping != null) ? `$${Number(viewing.breakeven_production || 0).toLocaleString()} + $${Number(viewing.breakeven_shipping || 0).toLocaleString()}` : '—'],
              ['Profit (internal)', viewing.profit != null ? `$${Number(viewing.profit).toLocaleString()} (${viewing.profit_pct}%)` : '—'],
              ['Price Approval', viewing.price_approved ? `Approved by ${viewing.approved_by}${viewing.approved_at ? ' on ' + new Date(viewing.approved_at).toLocaleString() : ''}` : (viewing.approval_locked ? 'LOCKED — awaiting approval' : 'Not approved')],
              ['Follow-up', `${viewing.followup_sent ? 'Sent' : 'Not sent'}${viewing.followup_notes ? ' — ' + viewing.followup_notes : ''}`],
              ['Quote Source', viewing.quote_source],
              ['Order', viewing.order_confirmed ? `Placed${viewing.order_placed_at ? ' on ' + new Date(viewing.order_placed_at).toLocaleString() : ''}` : 'Not placed yet'], ['Sales Rep', viewing.sales_rep],
              ['Status', viewing.status], ['Assigned To', viewing.assigned_to],
              ['Special Requirements', viewing.special_requirements],
              ['Created By', viewing.added_by], ['Finalized By', viewing.created_by_name],
            ].map(([k, v]) => (
              <div key={k} className="line" style={{ marginBottom: 6 }}><span className="muted">{k}:</span> {v || '—'}</div>
            ))}
            {/* the three note lanes — editable right here, saved when you click away */}
            {[['revision_notes', 'Revision notes', 'What the client asked to change'],
              ['important_notes', 'Important notes', 'Things the team must not miss'],
              ['internal_notes', 'Internal notes', 'Internal-only — never shown to the client']].map(([field, label, hint]) => (
              <div key={field} className="field" style={{ marginTop: 8 }}>
                <label title={hint}>{label}</label>
                <textarea
                  defaultValue={viewing[field] || ''}
                  rows={2}
                  placeholder={hint + '… (saved when you click away)'}
                  onBlur={(e) => { if (e.target.value !== (viewing[field] || '')) { patch(viewing.quote_id, field, e.target.value); setViewing({ ...viewing, [field]: e.target.value }) } }}
                />
              </div>
            ))}
            <div className="foot"><button onClick={() => setViewing(null)}>Close</button></div>
          </div>
        </div>
      )}
    </>
  )
}
