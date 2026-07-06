import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuotes, useConstants, useUpdateQuote, useUpdateStatus, useUpdateTags, useDeleteQuote } from '../hooks'
import useAuthStore from '../store/authStore'
import { fileUrl } from '../api/client'
import { useSortable, SortTh, useColumns, ColumnPicker, gridKeyNav, downloadCsv, copyTsv } from '../components/grid'

// Commits on blur only when the value actually changed
function EditCell({ value, onCommit, type = 'text', width = 120, col, row, onPasteDown, readOnly }) {
  const [v, setV] = useState(value ?? '')
  const [focused, setFocused] = useState(false)
  // follow server updates (bulk paste, another user's edit) — but never clobber active typing
  useEffect(() => { if (!focused) setV(value ?? '') }, [value, focused])
  const commit = () => { setFocused(false); if (String(v) !== String(value ?? '')) onCommit(v) }
  if (readOnly) return <span>{value === null || value === undefined || value === '' ? '—' : String(value)}</span>
  return (
    <input
      type={type}
      value={v}
      style={{ width }}
      data-col={col}
      data-row={row}
      onChange={(e) => setV(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={commit}
      onKeyDown={(e) => (col != null ? gridKeyNav(e, col, row) : e.key === 'Enter' && e.currentTarget.blur())}
      onPaste={(e) => {
        // Excel-style: pasting a multi-line clipboard fills this column downwards, one row per line
        if (!onPasteDown) return
        const text = e.clipboardData.getData('text')
        if (text.includes('\n')) {
          e.preventDefault()
          const values = text.replace(/\r/g, '').split('\n').filter((x, idx, arr) => x !== '' || idx < arr.length - 1)
          setV(values[0] ?? '')
          onPasteDown(values)
        }
      }}
    />
  )
}

export default function AllQuotes() {
  const navigate = useNavigate()
  const { isAdmin, isViewer } = useAuthStore()
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
  const [selected, setSelected] = useState(() => new Set())   // quote_ids ticked for bulk actions
  const [searchParams, setSearchParams] = useSearchParams()
  const assignedF = searchParams.get('assigned') || ''       // drill-down from the Team page

  const params = {}
  if (search) params.search = search
  if (status) params.status = status
  if (mine) params.assigned = 'me'
  else if (assignedF) params.assigned = assignedF
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
  const readOnly = isViewer()   // viewer accounts: the grid becomes a pure report

  const patch = (id, field, value) => update.mutate({ id, patch: { [field]: value } })

  const remove = (q) => {
    if (window.confirm(`Delete quote ${q.quote_id}? This cannot be undone.`)) del.mutate(q.quote_id)
  }

  // ---- Grid v3: multi-select + bulk actions ----
  const toggleSel = (id) => setSelected((prev) => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })
  const allVisibleSelected = quotes.length > 0 && quotes.every((q) => selected.has(q.quote_id))
  const toggleAll = () => setSelected(allVisibleSelected ? new Set() : new Set(quotes.map((q) => q.quote_id)))
  const selIds = quotes.filter((q) => selected.has(q.quote_id)).map((q) => q.quote_id)
  const bulkStatus = (st) => { if (st) selIds.forEach((id) => updateStatus.mutate({ id, status: st })) }
  const bulkAssign = (name) => selIds.forEach((id) => update.mutate({ id, patch: { assigned_to: name } }))
  // ---- Grid v4: export + copy + paste-down ----
  const EXPORT_COLS = [
    ['Quote ID', (q) => q.quote_id], ['Company', (q) => q.company_name], ['Client', (q) => q.client_name],
    ['Contact', (q) => q.contact], ['Job', (q) => q.job_name], ['Price', (q) => q.price ?? ''],
    ['Breakeven Production', (q) => q.breakeven_production ?? ''], ['Breakeven Shipping', (q) => q.breakeven_shipping ?? ''],
    ['Profit', (q) => q.profit ?? ''], ['Profit %', (q) => q.profit_pct ?? ''],
    ['Sales Rep', (q) => q.sales_rep], ['Assigned To', (q) => q.assigned_to], ['Rush', (q) => q.rush],
    ['Price Approved', (q) => (q.price_approved ? 'yes' : 'no')], ['Approved By', (q) => q.approved_by],
    ['Order Placed', (q) => (q.order_confirmed ? 'yes' : 'no')], ['Order Date', (q) => q.order_placed_at || ''],
    ['Status', (q) => q.status], ['Source', (q) => q.quote_source],
    ['Revision Notes', (q) => q.revision_notes], ['Important Notes', (q) => q.important_notes], ['Internal Notes', (q) => q.internal_notes],
    ['Created', (q) => q.created_at || ''],
  ]
  const exportRows = () => (selIds.length ? sort.sorted.filter((q) => selected.has(q.quote_id)) : sort.sorted)
  const exportCsv = () => downloadCsv(
    `quotes-${new Date().toISOString().slice(0, 10)}.csv`,
    EXPORT_COLS.map(([h]) => h),
    exportRows().map((q) => EXPORT_COLS.map(([, f]) => f(q)))
  )
  const copyRows = async () => {
    const ok = await copyTsv(EXPORT_COLS.map(([h]) => h), exportRows().map((q) => EXPORT_COLS.map(([, f]) => f(q))))
    window.alert(ok ? `Copied ${exportRows().length} row(s) — paste straight into Excel/Sheets.` : 'Copy failed — your browser blocked clipboard access.')
  }
  // pasting a multi-line clipboard into a cell fills that column downwards (Excel-style)
  const COL_FIELD = { company: 'company_name', client: 'client_name', contact: 'contact', job: 'job_name', price: 'price', bep: 'breakeven_production', bes: 'breakeven_shipping' }
  const pasteDown = (col, startRow) => (values) => {
    const field = COL_FIELD[col]
    if (!field) return
    values.forEach((val, offset) => {
      const target = sort.sorted[startRow + offset]
      if (target) patch(target.quote_id, field, val)
    })
  }

  const bulkDelete = () => {
    if (window.confirm(`Delete ${selIds.length} quote${selIds.length > 1 ? 's' : ''} (${selIds.join(', ')})? This cannot be undone.`)) {
      selIds.forEach((id) => del.mutate(id))
      setSelected(new Set())
    }
  }

  return (
    <>
      <div className="page-head">
        <h1>All Quotes</h1>
        {assignedF && (
          <span className="pill pill-purple" style={{ cursor: 'pointer' }} title="Click to clear this filter"
            onClick={() => setSearchParams({})}>assigned to {assignedF} ✕</span>
        )}
      </div>

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
        <button className="ghost sm" title="Download the current view (or just the ticked rows) as a spreadsheet file" onClick={exportCsv}>⬇ CSV</button>
        <button className="ghost sm" title="Copy the current view (or just the ticked rows) — paste into Excel/Google Sheets" onClick={copyRows}>⧉ Copy</button>
        <ColumnPicker columns={columns} />
      </div>

      {selIds.length > 0 && (
        <div className="toolbar" style={{ background: 'rgba(249,166,0,0.08)', border: '1px solid rgba(249,166,0,0.35)', borderRadius: 8, padding: '6px 10px', alignItems: 'center' }}>
          <b style={{ whiteSpace: 'nowrap' }}>{selIds.length} selected</b>
          <select defaultValue="" style={{ width: 'auto' }} title="Set this status on every selected quote" onChange={(e) => { bulkStatus(e.target.value); e.target.value = '' }}>
            <option value="">Set status…</option>
            {statuses.map((st) => <option key={st} value={st}>{st}</option>)}
          </select>
          <select defaultValue="__none__" style={{ width: 'auto' }} title="Assign every selected quote to this person" onChange={(e) => { if (e.target.value !== '__none__') bulkAssign(e.target.value); e.target.value = '__none__' }}>
            <option value="__none__">Assign to…</option>
            <option value="">— unassign —</option>
            {team.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          {admin && <button className="danger sm" onClick={bulkDelete}>Delete selected</button>}
          <button className="ghost sm" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}

      {isLoading ? (
        <div className="center">Loading…</div>
      ) : (
        <div className="grid-wrap" style={{ overflow: 'auto', maxHeight: '72vh' }}>
          <table>
            <thead>
              <tr>
                <th>{!readOnly && <input type="checkbox" checked={allVisibleSelected} title="Select every quote in the current view" style={{ width: 'auto' }} onChange={toggleAll} />}</th>
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
                <tr key={q.id} style={selected.has(q.quote_id) ? { background: 'rgba(249,166,0,0.07)' } : undefined}>
                  <td>{!readOnly && <input type="checkbox" checked={selected.has(q.quote_id)} style={{ width: 'auto' }} onChange={() => toggleSel(q.quote_id)} />}</td>
                  <td className="muted" style={{ fontSize: 11 }}>{i + 1}</td>
                  <td><b>{q.quote_id}</b>{q.is_test && <span className="pill pill-amber" style={{ marginLeft: 6, fontSize: 10 }}>TEST</span>}{q.rush === 'Super Rush' && <span className="pill pill-coral" style={{ marginLeft: 6, fontSize: 10 }}>SUPER RUSH</span>}{q.rush === 'Rush' && <span className="pill pill-amber" style={{ marginLeft: 6, fontSize: 10 }}>RUSH</span>}</td>
                  {columns.has('company') && <td><EditCell readOnly={readOnly} col="company" row={i} onPasteDown={pasteDown('company', i)} value={q.company_name} onCommit={(v) => patch(q.quote_id, 'company_name', v)} width={140} /></td>}
                  {columns.has('client') && <td><EditCell readOnly={readOnly} col="client" row={i} onPasteDown={pasteDown('client', i)} value={q.client_name} onCommit={(v) => patch(q.quote_id, 'client_name', v)} /></td>}
                  {columns.has('contact') && <td><EditCell readOnly={readOnly} col="contact" row={i} onPasteDown={pasteDown('contact', i)} value={q.contact} onCommit={(v) => patch(q.quote_id, 'contact', v)} /></td>}
                  {columns.has('job') && <td><EditCell readOnly={readOnly} col="job" row={i} onPasteDown={pasteDown('job', i)} value={q.job_name} onCommit={(v) => patch(q.quote_id, 'job_name', v)} /></td>}
                  {columns.has('price') && <td><EditCell readOnly={readOnly} col="price" row={i} onPasteDown={pasteDown('price', i)} value={q.price ?? ''} type="number" width={80} onCommit={(v) => patch(q.quote_id, 'price', v)} /></td>}
                  {columns.has('be') && <td><EditCell readOnly={readOnly} col="bep" row={i} onPasteDown={pasteDown('bep', i)} value={q.breakeven_production ?? ''} type="number" width={70} onCommit={(v) => patch(q.quote_id, 'breakeven_production', v)} /></td>}
                  {columns.has('be') && <td><EditCell readOnly={readOnly} col="bes" row={i} onPasteDown={pasteDown('bes', i)} value={q.breakeven_shipping ?? ''} type="number" width={70} onCommit={(v) => patch(q.quote_id, 'breakeven_shipping', v)} /></td>}
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
                    <select disabled={readOnly} value={q.assigned_to || ''} style={{ width: 110 }} title="Who is working this quote" onChange={(e) => patch(q.quote_id, 'assigned_to', e.target.value)}>
                      <option value="">—</option>
                      {team.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </td>}
                  {columns.has('rush') && <td>
                    <select disabled={readOnly} value={q.rush || ''} style={{ width: 100, ...(q.rush === 'Super Rush' ? { borderColor: '#e5484d', color: '#e5484d', fontWeight: 700 } : q.rush === 'Rush' ? { borderColor: '#f9a600', color: '#f9a600', fontWeight: 600 } : {}) }} title="Rush level — rush quotes jump the needs-attention queue" onChange={(e) => patch(q.quote_id, 'rush', e.target.value)}>
                      <option value="">—</option>
                      <option value="Rush">Rush</option>
                      <option value="Super Rush">Super Rush</option>
                    </select>
                  </td>}
                  {columns.has('approval') && <td style={{ whiteSpace: 'nowrap' }}>
                    <label title={q.price_approved ? `Approved by ${q.approved_by}${q.approved_at ? ' on ' + new Date(q.approved_at).toLocaleDateString() : ''}` : 'Tick to approve the price (you + date are logged)'} style={{ cursor: 'pointer' }}>
                      <input type="checkbox" disabled={readOnly} checked={!!q.price_approved} style={{ width: 'auto' }} onChange={(e) => patch(q.quote_id, 'price_approved', e.target.checked)} /> ✓
                    </label>{' '}
                    <label title={q.approval_locked ? 'LOCKED — PDF/PNG/payment link blocked until the price is approved. Click to unlock.' : 'Lock this quote until the price is approved'} style={{ cursor: 'pointer', opacity: q.approval_locked ? 1 : 0.5 }}>
                      <input type="checkbox" disabled={readOnly} checked={!!q.approval_locked} style={{ width: 'auto' }} onChange={(e) => patch(q.quote_id, 'approval_locked', e.target.checked)} /> 🔒
                    </label>
                  </td>}
                  {columns.has('order') && <td style={{ textAlign: 'center' }}>
                    <label title={q.order_confirmed ? `Order placed${q.order_placed_at ? ' on ' + new Date(q.order_placed_at).toLocaleDateString() : ''}` : 'Tick when the customer places the order (date is stamped)'} style={{ cursor: 'pointer' }}>
                      <input type="checkbox" disabled={readOnly} checked={!!q.order_confirmed} style={{ width: 'auto' }} onChange={(e) => patch(q.quote_id, 'order_confirmed', e.target.checked)} /> 📦
                    </label>
                  </td>}
                  <td>
                    <select disabled={readOnly} value={q.status} style={{ width: 150 }} onChange={(e) => updateStatus.mutate({ id: q.quote_id, status: e.target.value })}>
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
                      <select disabled={readOnly} value="" style={{ width: 26, padding: '0 2px', height: 20, fontSize: 11 }} title="Also waiting on…"
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
                    {!readOnly && <><button className="ghost sm" onClick={() => navigate(`/quotes/${q.quote_id}/generate`)}>Edit</button>{' '}</>}
                    {admin && <><button className="ghost sm" title="Everything that ever happened to this quote" onClick={() => navigate(`/activity?quote=${q.quote_id}`)}>History</button>{' '}</>}
                    {admin && <><button className="ghost sm" title={q.is_test ? 'Unmark test — counts again in all numbers' : 'Mark as TEST — excluded from every KPI, pipeline and report'} onClick={() => patch(q.quote_id, 'is_test', !q.is_test)}>{q.is_test ? 'Untest' : 'Test'}</button>{' '}</>}
                    {!readOnly && <button className="danger sm" onClick={() => remove(q)}>Delete</button>}
                  </td>
                </tr>
              ))}
              {quotes.length === 0 && <tr><td colSpan={19} className="center">No quotes found.</td></tr>}
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
              ['Order', viewing.order_confirmed ? `Placed${viewing.order_placed_at ? ' on ' + new Date(viewing.order_placed_at).toLocaleString() : ''}` : 'Not placed yet'],
              ['Time to Done', viewing.days_to_done != null ? `${viewing.days_to_done} day${viewing.days_to_done === 1 ? '' : 's'} (finished ${new Date(viewing.done_at).toLocaleDateString()})` : 'Not done yet'], ['Sales Rep', viewing.sales_rep],
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
