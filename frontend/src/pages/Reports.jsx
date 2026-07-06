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
  if (!months.length) return null
  const max = Math.max(1, ...months.map((m) => m.created))
  const W = 720, H = 150, bw = W / months.length

  return (
    <div className="panel" style={{ padding: 16, marginBottom: 24 }}>
      <h3 style={{ marginBottom: 12 }}>Month by month — last 12 months</h3>
      <svg viewBox={`0 0 ${W} ${H + 20}`} style={{ width: '100%', maxWidth: 860, display: 'block' }}>
        {months.map((m, i) => {
          const ch = (m.created / max) * H
          const dh = (m.done / max) * H
          return (
            <g key={m.month}>
              <rect x={i * bw + 6} y={H - ch} width={bw - 18} height={ch} fill="#3d4657" rx="2">
                <title>{m.label}: {m.created} created ({money(m.quoted_value)})</title>
              </rect>
              <rect x={i * bw + 6} y={H - dh} width={(bw - 18) / 2} height={dh} fill="#f9a600" rx="2">
                <title>{m.label}: {m.done} won ({money(m.done_value)})</title>
              </rect>
              <text x={i * bw + bw / 2} y={H + 14} textAnchor="middle" fontSize="9" fill="#8a94a6">{m.label}</text>
            </g>
          )
        })}
      </svg>
      <div className="muted" style={{ fontSize: 11, margin: '6px 0 12px' }}>Grey = quotes created · Gold = quotes won that month</div>
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
