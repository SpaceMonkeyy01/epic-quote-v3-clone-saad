import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDashboard, useQuotes, useConstants, useUpdateQuote } from '../hooks'
import useAuthStore from '../store/authStore'
import {
  IcSun, IcPlus, IcTrendUp, IcDollar, IcGauge, IcBell, IcChevR, IcAlert, IcMail, IcSend,
  IcClipboard, IcSpinner, IcImage, IcCheck, IcCard, IcShare, IcClock, IcHourglass, IcPause, IcX,
} from '../components/icons'

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
// status → a stage icon for the pipeline grid
const STATUS_ICON = {
  'To Do': IcClipboard, 'In Progress': IcSpinner, 'Artwork Needed': IcImage, 'Quote Approval Needed': IcCheck,
  'Need Payment Link Sent': IcCard, 'Need To Share With Customer': IcShare, 'Awaiting Customer Response': IcClock,
  'Awaiting Rod Response': IcHourglass, 'Awaiting Sir Sami Response': IcHourglass, 'On Hold': IcPause,
  'Rejected by Client': IcX, 'Out of Scope': IcX, 'Done': IcCheck,
}
const ATTN = Object.keys(ACTION)
const money = (n) => '$' + Number(n || 0).toLocaleString()

// ---- tiny inline charts (SVG, real data) ----
function spark(counts, w = 220, h = 52, pad = 5) {
  if (!counts?.length) return null
  const max = Math.max(1, ...counts), min = Math.min(...counts)
  const rng = Math.max(1, max - min)
  const x = (i) => (counts.length > 1 ? pad + (i / (counts.length - 1)) * (w - 2 * pad) : w / 2)
  const y = (v) => h - pad - ((v - min) / rng) * (h - 2 * pad)
  const pts = counts.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`)
  return { line: pts.join(' '), area: `M${x(0)},${h} L${pts.join(' L')} L${x(counts.length - 1)},${h} Z`, w, h }
}
function AreaSpark({ counts, stroke, id }) {
  const s = spark(counts); if (!s) return null
  return (
    <svg viewBox={`0 0 ${s.w} ${s.h}`} preserveAspectRatio="none" className="mini">
      <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={stroke} stopOpacity="0.30" /><stop offset="1" stopColor={stroke} stopOpacity="0" />
      </linearGradient></defs>
      <path d={s.area} fill={`url(#${id})`} />
      <polyline points={s.line} fill="none" stroke={stroke} strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
function MiniLine({ counts, stroke }) {
  const s = spark(counts, 220, 46); if (!s) return null
  return (
    <svg viewBox={`0 0 ${s.w} ${s.h}`} preserveAspectRatio="none" className="mini">
      <polyline points={s.line} fill="none" stroke={stroke} strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
function MiniBars({ counts, color }) {
  if (!counts?.length) return null
  const max = Math.max(1, ...counts), n = counts.length, bw = 100 / n
  return (
    <svg viewBox="0 0 100 46" preserveAspectRatio="none" className="mini">
      {counts.map((v, i) => {
        const bh = Math.max(2, (v / max) * 42)
        return <rect key={i} x={i * bw + bw * 0.22} y={46 - bh} width={bw * 0.56} height={bh} rx="1" fill={color} opacity={i === n - 1 ? 1 : 0.5} />
      })}
    </svg>
  )
}
function Ring({ pct, color }) {
  const r = 20, c = 2 * Math.PI * r
  return (
    <svg viewBox="0 0 52 52" width="52" height="52" aria-hidden="true">
      <circle cx="26" cy="26" r={r} fill="none" stroke="rgba(15,23,42,.10)" strokeWidth="6" />
      <circle cx="26" cy="26" r={r} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(1, Math.max(0, pct)))} transform="rotate(-90 26 26)" />
    </svg>
  )
}

export default function Dashboard() {
  const navigate = useNavigate()
  const { data: dash } = useDashboard()
  const { data: constants } = useConstants()
  const user = useAuthStore((s) => s.user)
  const update = useUpdateQuote()
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

  const trend = (dash?.quotes_trend || []).map((t) => t.count)
  const isViewer = user?.role === 'viewer'

  const hour = new Date().getHours()
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const dateStr = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
  const firstName = (user?.full_name || user?.username || 'there').split(' ')[0]
  const recent = quotes.slice(0, 8)

  return (
    <div className="dash">
      {/* ---- top bar ---- */}
      <div className="dash-topbar">
        <div className="greet">
          <div className="greet-row">
            <span className="greet-sun"><IcSun size={20} /></span>
            <h1>{greet}, {firstName}</h1>
          </div>
          <div className="greet-sub">
            {dateStr}{attnCount ? ` · ${attnCount} quote${attnCount > 1 ? 's' : ''} need your attention today` : ' · all clear today'}
          </div>
        </div>
        {isViewer
          ? <span className="pill pill-gray" title="Your account can see everything but change nothing">View-only account</span>
          : <button className="btn-new" onClick={() => navigate('/quotes', { state: { openNew: true } })}><IcPlus size={17} /> New quote</button>}
      </div>

      {/* ---- KPI row ---- */}
      <div className="kpis">
        <div className="kpi feature">
          <div className="kpi-head"><span className="kpi-ico gold"><IcTrendUp size={16} /></span><span className="kpi-k">Quotes · last 30 days</span></div>
          <div className="kpi-v">
            {dash?.totals?.total_quotes_month ?? '—'}
            {dash?.quotes_delta != null && <span className={'kpi-delta ' + (dash.quotes_delta >= 0 ? 'up' : 'down')}>{dash.quotes_delta >= 0 ? '▲' : '▼'} {Math.abs(dash.quotes_delta)}%</span>}
          </div>
          <div className="kpi-sub">vs previous 30 days</div>
          <div className="kpi-chart"><AreaSpark counts={trend} stroke="#f9a600" id="sparkHero" /></div>
        </div>

        <div className="kpi">
          <div className="kpi-head"><span className="kpi-ico blue"><IcDollar size={16} /></span><span className="kpi-k">Pipeline value</span></div>
          <div className="kpi-v">{dash ? money(dash.pipeline_value) : '—'}</div>
          <div className="kpi-sub">{openCount} open quote{openCount === 1 ? '' : 's'}</div>
          <div className="kpi-chart"><MiniBars counts={trend} color="#378add" /></div>
        </div>

        <div className="kpi">
          <div className="kpi-head"><span className="kpi-ico teal"><IcGauge size={16} /></span><span className="kpi-k">Avg quote value</span></div>
          <div className="kpi-v">{dash ? money(dash.avg_quote_value) : '—'}</div>
          <div className="kpi-sub">across open work</div>
          <div className="kpi-chart"><MiniLine counts={trend} stroke="#1d9e75" /></div>
        </div>

        <div className="kpi">
          <div className="kpi-head"><span className="kpi-ico gold"><IcBell size={16} /></span><span className="kpi-k">Needs attention</span></div>
          <div className="kpi-gauge">
            <div>
              <div className="kpi-v" style={{ marginTop: 0 }}>{dash ? attnCount : '—'}</div>
              <div className="kpi-sub">act today</div>
            </div>
            <Ring pct={total ? attnCount / total : 0} color="#f9a600" />
          </div>
        </div>
      </div>

      {/* ---- two-column body ---- */}
      <div className="dash-cols">
        {/* LEFT: needs attention + recent quotes */}
        <div className="dash-col">
          <div className="panel">
            <div className="panel-head">
              <b className="ph"><span className="ph-ico amber"><IcAlert size={14} /></span> Needs attention</b>
              <span className="muted sm">Sorted by urgency</span>
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
                    <div className="na-val">{money(q.price)}</div>
                    <button className="icon-btn" title="Open quote" onClick={() => navigate(`/quotes/${q.quote_id}/generate`, { state: { from: '/dashboard' } })}><IcChevR size={16} /></button>
                  </div>
                </div>
              )
            })}
            {needs.length > 0 && <div className="panel-foot" onClick={() => navigate('/quotes')}>View all needs attention →</div>}
          </div>

          <div className="panel">
            <div className="panel-head">
              <b className="ph">{status || 'Recent quotes'}</b>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <input className="dash-search" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
                {status && <span className="muted sm" style={{ cursor: 'pointer' }} onClick={() => setStatus('')}>Clear</span>}
                <span className="link-gold sm" onClick={() => navigate('/quotes')}>View all</span>
              </div>
            </div>
            <table className="dash-table">
              <thead>
                <tr><th>Quote</th><th>Company</th><th>Rep</th><th style={{ textAlign: 'right' }}>Value</th><th style={{ textAlign: 'right' }}>Status</th></tr>
              </thead>
              <tbody>
                {recent.length === 0 ? (
                  <tr><td colSpan={5} className="center" style={{ padding: 20 }}>No quotes found.</td></tr>
                ) : recent.map((q) => (
                  <tr key={q.id} onClick={() => navigate(`/quotes/${q.quote_id}/generate`, { state: { from: '/dashboard' } })}>
                    <td><b>{q.quote_id}</b></td>
                    <td>{q.company_name || '—'}</td>
                    <td className="muted">{q.sales_rep || '—'}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{q.price ? money(q.price) : '—'}</td>
                    <td style={{ textAlign: 'right' }}><span className={'pill pill-' + (COLOR[q.status] || 'gray')}>{q.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* RIGHT: follow-ups + pipeline grid */}
        <div className="dash-col">
          {(dash?.followups || []).length > 0 && (
            <div className="panel">
              <div className="panel-head">
                <b className="ph"><span className="ph-ico teal"><IcMail size={14} /></span> Follow-ups needed</b>
                <span className="muted sm">Nobody has chased yet</span>
              </div>
              {dash.followups.map((q) => (
                <div key={q.quote_id} className="fu-row">
                  <div className="fu-top">
                    <div className="na-info">
                      <div className="na-id">{q.quote_id} · {q.company_name || '—'}</div>
                      <div className="na-sub">{q.status}{q.days_waiting > 0 ? ` · waiting ${q.days_waiting}d` : ''}</div>
                    </div>
                    <div className="na-val">{money(q.price)}</div>
                  </div>
                  {!isViewer && <input
                    defaultValue={q.followup_notes}
                    placeholder="Follow-up notes… (saved when you click away)"
                    style={{ marginTop: 8, fontSize: 12 }}
                    onBlur={(e) => { if (e.target.value !== q.followup_notes) update.mutate({ id: q.quote_id, patch: { followup_notes: e.target.value } }) }}
                  />}
                  <div className="fu-actions">
                    <button className="ghost sm" onClick={() => navigate(`/quotes/${q.quote_id}/generate`, { state: { from: '/dashboard' } })}>Open</button>
                    {!isViewer && <button className="sm" onClick={() => update.mutate({ id: q.quote_id, patch: { followup_sent: true } })}><IcSend size={13} /> Sent</button>}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="panel">
            <div className="panel-head">
              <b className="ph">Pipeline</b>
              <span className="muted sm">{total} active · click to filter</span>
            </div>
            <div className="pipe-grid">
              {statuses.map((s) => {
                const Icon = STATUS_ICON[s] || IcClipboard
                const c = cards[s] || 0
                const on = status === s
                return (
                  <button key={s} className={'pipe-tile' + (on ? ' on' : '') + (c === 0 ? ' zero' : '')}
                    onClick={() => setStatus(on ? '' : s)} title={s}>
                    <span className={'pt-ico seg-' + (COLOR[s] || 'gray')}><Icon size={15} /></span>
                    <span className="pt-num">{c}</span>
                    <span className="pt-lbl">{s}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
