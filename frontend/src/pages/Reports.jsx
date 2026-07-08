import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSalesReps } from '../hooks'
import client from '../api/client'

const money = (n) => '$' + Number(n || 0).toLocaleString()

function StatBlock({ title, s }) {
  return (
    <div className="box" style={{ minWidth: 220 }}>
      <div className="k" style={{ marginBottom: 8, fontWeight: 600, color: 'var(--text)' }}>{title}</div>
      <div className="line">Received: <b>{s.total_quotes_received}</b></div>
      <div className="line">Converted: <b>{s.quotes_converted}</b></div>
      <div className="line">Conversion: <b>{s.conversion_rate}%</b></div>
    </div>
  )
}

/* Monthly report (T17): real calendar months. Grey bars = quotes created; gold bars = won
   (first hit Done that month). The table under it carries the exact numbers. */
function MonthlyReport() {
  const { data: months = [] } = useQuery({
    queryKey: ['reports-monthly'],
    queryFn: async () => (await client.get('/reports/monthly')).data,
  })
  const [hover, setHover] = useState(null)   // { m, x, y } — the hovered month + cursor position
  if (!months.length) return null
  const max = Math.max(1, ...months.map((m) => m.created))
  const W = 720, H = 150, bw = W / months.length

  return (
    <div className="panel" style={{ padding: 16, marginBottom: 24, position: 'relative' }}>
      <h3 style={{ marginBottom: 12 }}>Month by month — last 12 months</h3>
      <div style={{ position: 'relative' }} onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H + 20}`} style={{ width: '100%', maxWidth: 860, display: 'block' }}>
          {months.map((m, i) => {
            const ch = (m.created / max) * H
            const dh = (m.done / max) * H
            const active = hover?.m?.month === m.month
            const track = (e) => setHover({ m, x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY })
            return (
              <g key={m.month} onMouseEnter={track} onMouseMove={track} style={{ cursor: 'pointer' }}>
                {/* full-height hit area so hovering anywhere in the column shows the tooltip */}
                <rect x={i * bw} y={0} width={bw} height={H} fill={active ? 'rgba(249,166,0,0.06)' : 'transparent'} />
                <rect x={i * bw + 6} y={H - ch} width={bw - 18} height={ch} fill={active ? '#7b8698' : '#aeb7c6'} rx="2" />
                <rect x={i * bw + 6} y={H - dh} width={(bw - 18) / 2} height={dh} fill="#f9a600" rx="2" />
                <text x={i * bw + bw / 2} y={H + 14} textAnchor="middle" fontSize="9" fill={active ? '#f9a600' : '#8a94a6'}>{m.label}</text>
              </g>
            )
          })}
        </svg>
        {hover && (
          <div style={{
            position: 'absolute', pointerEvents: 'none', zIndex: 20,
            left: `calc(${(hover.x / W) * 100}% + 12px)`, top: Math.max(0, hover.y - 10),
            background: '#ffffff', border: '1px solid var(--border)', color: 'var(--text)',
            borderRadius: 8, padding: '8px 11px', fontSize: 12, minWidth: 150, boxShadow: '0 8px 24px rgba(15,23,42,0.14)',
          }}>
            <div style={{ fontWeight: 700, color: 'var(--gold)', marginBottom: 4 }}>{hover.m.label}</div>
            <div>Created: <b>{hover.m.created}</b></div>
            <div>Quoted value: <b>{money(hover.m.quoted_value)}</b></div>
            <div>Won: <b>{hover.m.done}</b></div>
            <div>Won value: <b>{money(hover.m.done_value)}</b></div>
            <div>Conversion: <b>{hover.m.conversion == null ? '—' : hover.m.conversion + '%'}</b></div>
          </div>
        )}
      </div>
      <div className="muted" style={{ fontSize: 11, margin: '6px 0 12px' }}>Grey = quotes created · Gold = quotes won that month · hover a month for details</div>
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead><tr><th>Month</th><th>Created</th><th>Quoted value</th><th>Won</th><th>Won value</th><th>Conversion</th></tr></thead>
          <tbody>
            {[...months].reverse().map((m) => (
              <tr key={m.month}>
                <td><b>{m.label}</b></td>
                <td>{m.created}</td>
                <td>{money(m.quoted_value)}</td>
                <td>{m.done}</td>
                <td>{money(m.done_value)}</td>
                <td>{m.conversion == null ? '—' : m.conversion + '%'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function Reports() {
  const { data: reps = [], isLoading } = useSalesReps()

  return (
    <>
      <div className="page-head"><h1>Sales Reports</h1></div>
      <MonthlyReport />
      {isLoading ? (
        <div className="center">Loading…</div>
      ) : (
        reps.map((r) => (
          <div key={r.name} style={{ marginBottom: 24 }}>
            <h3 style={{ marginBottom: 10 }}>{r.name}</h3>
            <div className="totals">
              <StatBlock title="Last 7 days" s={r.weekly} />
              <StatBlock title="Last 30 days" s={r.monthly} />
            </div>
          </div>
        ))
      )}
    </>
  )
}
