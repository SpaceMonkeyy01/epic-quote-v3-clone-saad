import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDashboard, useQuotes, useConstants, useUpdateQuote } from '../hooks'
import AddQuoteModal from '../components/AddQuoteModal'
import useAuthStore from '../store/authStore'

// status → pill colour (read status by colour, everywhere)
const COLOR = {
  'To Do': 'gray', 'In Progress': 'blue', 'Artwork Needed': 'amber', 'Quote Approval Needed': 'pink',
  'Need Payment Link Sent': 'coral', 'Need To Share With Customer': 'teal',
  'Awaiting Customer Response': 'purple', 'Awaiting Rod Response': 'purple', 'Awaiting Sir Sami Response': 'purple',
  'On Hold': 'gray', 'Rejected by Client': 'coral', 'Out of Scope': 'gray',
  'Done': 'green',
}
// status → the next action the rep must take (the "needs attention" chip)
const ACTION = {
  'Artwork Needed': 'Upload artwork', 'Quote Approval Needed': 'Get approval', 'Need Payment Link Sent': 'Send payment link',
  'Need To Share With Customer': 'Share with customer', 'Awaiting Customer Response': 'Chase customer',
  'Awaiting Rod Response': 'Chase Rod', 'Awaiting Sir Sami Response': 'Chase Sami',
}
const ATTN = Object.keys(ACTION)
const money = (n) => '$' + Number(n || 0).toLocaleString()

export default function Dashboard() {
  const navigate = useNavigate()
  const { data: dash } = useDashboard()
  const { data: constants } = useConstants()
  const user = useAuthStore((s) => s.user)
  const update = useUpdateQuote()
  const [showAdd, setShowAdd] = useState(false)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')

  const params = {}
  if (search) params.search = search
  if (status) params.status = status
  const { data: quotes = [] } = useQuotes(params)

  const cards = dash?.cards || {}
  const statuses = constants?.statuses || []
  const needs = dash?.needs_attention || []
  const total = statuses.reduce((n, s) => n + (cards[s] || 0), 0)
  const attnCount = ATTN.reduce((n, s) => n + (cards[s] || 0), 0)
  const openCount = dash?.reports?.pending_count ?? 0

  // sparkline for "Quotes this month" — built from real monthly counts (dash.quotes_trend)
  const trend = dash?.quotes_trend || []
  const trendMax = Math.max(1, ...trend.map((t) => t.count))
  const trendPts = trend.map((t, i) => {
    const x = trend.length > 1 ? (i / (trend.length - 1)) * 120 : 0
    const y = 22 - (t.count / trendMax) * 20
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')

  const hour = new Date().getHours()
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const dateStr = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
  const firstName = (user?.full_name || user?.username || 'there').split(' ')[0]

  const recent = quotes.slice(0, 8)

  return (
    <div className="dash">
      <div className="dash-head">
        <div>
          <h1 style={{ marginBottom: 2 }}>{greet}, {firstName}</h1>
          <div className="muted" style={{ fontSize: 13 }}>
            {dateStr}{attnCount ? ` · ${attnCount} quote${attnCount > 1 ? 's' : ''} need you today` : ' · all clear'}
          </div>
        </div>
        {user?.role !== 'viewer'
          ? <button onClick={() => setShowAdd(true)}>+ New quote</button>
          : <span className="pill pill-gray" title="Your account can see everything but change nothing">👁 View-only account</span>}
      </div>

      <div className="kpis">
        <div className="kpi">
          <div className="k">Quotes · last 30 days</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, marginTop: 5 }}>
            <div style={{ fontSize: 23, fontWeight: 700 }}>{dash?.totals?.total_quotes_month ?? '—'}</div>
            {dash?.quotes_delta != null && <div style={{ fontSize: 11, fontWeight: 600, color: dash.quotes_delta >= 0 ? '#97c459' : '#f0997b' }}>{dash.quotes_delta >= 0 ? '+' : ''}{dash.quotes_delta}%</div>}
          </div>
          {trend.length > 1
            ? <svg width="100%" height="22" viewBox="0 0 120 22" preserveAspectRatio="none" style={{ marginTop: 6, display: 'block' }} aria-hidden="true"><polyline points={trendPts} fill="none" stroke="var(--gold)" strokeWidth="1.6" /></svg>
            : <div className="sub">{dash?.month_label || ''}</div>}
        </div>
        <div className="kpi"><div className="k">Pipeline value</div><div className="v">{dash ? money(dash.pipeline_value) : '—'}</div><div className="sub">{openCount} open quote{openCount === 1 ? '' : 's'}</div></div>
        <div className="kpi"><div className="k">Avg quote value</div><div className="v">{dash ? money(dash.avg_quote_value) : '—'}</div><div className="sub">across open work</div></div>
        <div className="kpi attn"><div className="k">Needs attention</div><div className="v">{dash ? attnCount : '—'}</div><div className="sub">act today</div></div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <b>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#f9a600" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: '-2px', marginRight: 6 }}>
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            Needs attention
          </b>
          <span className="muted" style={{ fontSize: 12 }}>Sorted by urgency</span>
        </div>
        {needs.length === 0 ? (
          <div className="na-empty">Nothing waiting on you right now. Nice.</div>
        ) : needs.map((q) => {
          const action = ACTION[q.status] || q.status
          const chip = q.days_waiting > 0 ? `${action} · ${q.days_waiting}d` : action
          return (
            <div key={q.quote_id} className="na-row">
              <div className="na-info">
                <div className="na-id">{q.quote_id} · {q.company_name || '—'}</div>
                <div className="na-sub">{q.job_name || ''}{q.assigned_to ? `${q.job_name ? ' · ' : ''}with ${q.assigned_to}` : ''}</div>
              </div>
              <div className="na-act">
                {q.rush === 'Super Rush' && <span className="pill pill-coral" style={{ fontWeight: 700 }}>SUPER RUSH</span>}
                {q.rush === 'Rush' && <span className="pill pill-amber" style={{ fontWeight: 600 }}>RUSH</span>}
                <span className={'pill pill-' + (COLOR[q.status] || 'gray')}>{chip}</span>
                {(q.tags || []).map((t) => <span key={t} className="pill pill-purple" style={{ fontSize: 10 }}>also: {ACTION[t] || t}</span>)}
                <div className="na-val">{money(q.price)}</div>
                <button className="ghost sm" onClick={() => navigate(`/quotes/${q.quote_id}/generate`)}>Open</button>
              </div>
            </div>
          )
        })}
      </div>

      {(dash?.followups || []).length > 0 && (
        <div className="panel">
          <div className="panel-head">
            <b>✉ Follow-ups needed</b>
            <span className="muted" style={{ fontSize: 12 }}>Waiting on the customer — nobody has chased yet</span>
          </div>
          {dash.followups.map((q) => (
            <div key={q.quote_id} className="na-row">
              <div className="na-info">
                <div className="na-id">{q.quote_id} · {q.company_name || '—'}</div>
                <div className="na-sub">{q.status}{q.days_waiting > 0 ? ` · waiting ${q.days_waiting}d` : ''}</div>
                {user?.role !== 'viewer' && <input
                  defaultValue={q.followup_notes}
                  placeholder="Follow-up notes… (saved when you click away)"
                  style={{ marginTop: 4, fontSize: 12, width: '100%', maxWidth: 420 }}
                  onBlur={(e) => { if (e.target.value !== q.followup_notes) update.mutate({ id: q.quote_id, patch: { followup_notes: e.target.value } }) }}
                />}
              </div>
              <div className="na-act">
                <div className="na-val">{money(q.price)}</div>
                <button className="ghost sm" onClick={() => navigate(`/quotes/${q.quote_id}/generate`)}>Open</button>
                {user?.role !== 'viewer' && <button className="sm" title="Mark the follow-up as sent — drops off this list" onClick={() => update.mutate({ id: q.quote_id, patch: { followup_sent: true } })}>✓ Sent</button>}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="panel" style={{ padding: '14px 16px' }}>
        <div className="panel-row">
          <b>Pipeline</b>
          <span className="muted" style={{ fontSize: 12 }}>{total} active · click a stage to filter</span>
        </div>
        <div className="pipe">
          {statuses.map((s) => {
            const c = cards[s] || 0
            return c ? <div key={s} className={'pipe-seg seg-' + (COLOR[s] || 'gray')} style={{ flexGrow: c }} title={`${s}: ${c}`} onClick={() => setStatus(status === s ? '' : s)} /> : null
          })}
        </div>
        <div className="pipe-legend">
          {statuses.map((s) => (
            <div key={s} className={'item' + (status === s ? ' on' : '')} onClick={() => setStatus(status === s ? '' : s)}>
              <span className={'dot seg-' + (COLOR[s] || 'gray')} /> {s} <b>{cards[s] || 0}</b>
            </div>
          ))}
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <b>{status || 'Recent quotes'}</b>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <input className="dash-search" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
            {status && <span className="muted" style={{ fontSize: 12, cursor: 'pointer' }} onClick={() => setStatus('')}>Clear</span>}
            <span style={{ color: 'var(--gold)', fontSize: 12, cursor: 'pointer' }} onClick={() => navigate('/quotes')}>View all</span>
          </div>
        </div>
        <table className="dash-table">
          <thead>
            <tr><th>Quote</th><th>Company</th><th>Rep</th><th>Assigned</th><th style={{ textAlign: 'right' }}>Value</th><th style={{ textAlign: 'right' }}>Status</th></tr>
          </thead>
          <tbody>
            {recent.length === 0 ? (
              <tr><td colSpan={6} className="center" style={{ padding: 20 }}>No quotes found.</td></tr>
            ) : recent.map((q) => (
              <tr key={q.id} onClick={() => navigate(`/quotes/${q.quote_id}/generate`)}>
                <td><b>{q.quote_id}</b></td>
                <td>{q.company_name || '—'}</td>
                <td className="muted">{q.sales_rep || '—'}</td>
                <td className="muted">{q.assigned_to || '—'}</td>
                <td style={{ textAlign: 'right', fontWeight: 600 }}>{q.price ? money(q.price) : '—'}</td>
                <td style={{ textAlign: 'right' }}>
                  <span className={'pill pill-' + (COLOR[q.status] || 'gray')}>{q.status}</span>
                  {(q.tags || []).map((t) => <span key={t} className="pill pill-purple" style={{ fontSize: 10, marginLeft: 4 }}>+{t}</span>)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showAdd && <AddQuoteModal onClose={() => setShowAdd(false)} />}
    </div>
  )
}
