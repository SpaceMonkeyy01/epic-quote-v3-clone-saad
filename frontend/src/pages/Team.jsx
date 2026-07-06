import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import client from '../api/client'

const money = (n) => '$' + Number(n || 0).toLocaleString()

/* Team transparency (T15): one card per member — live workload, rush load,
   done/created in the last 30 days, last activity. Click a card to drill
   into that person's quotes on All Quotes. */
export default function Team() {
  const navigate = useNavigate()
  const { data: team = [], isLoading } = useQuery({
    queryKey: ['team'],
    queryFn: async () => (await client.get('/team')).data,
  })

  const ago = (iso) => {
    if (!iso) return 'never'
    const d = Math.floor((Date.now() - new Date(iso + (iso.includes('Z') || iso.includes('+') ? '' : 'Z')).getTime()) / 86400000)
    return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`
  }

  return (
    <>
      <div className="page-head">
        <h1>Team</h1>
        <span className="muted" style={{ fontSize: 13 }}>Live workload — click a person to see their quotes</span>
      </div>
      {isLoading ? <div className="center">Loading…</div> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
          {team.map((m) => (
            <div key={m.username} className="panel" style={{ padding: 16, cursor: 'pointer' }}
              title={`See every quote assigned to ${m.name}`}
              onClick={() => navigate(`/quotes?assigned=${encodeURIComponent(m.name)}`)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <b style={{ fontSize: 15 }}>{m.name}</b>
                <span className="pill pill-gray" style={{ fontSize: 10 }}>{m.role.replace('_', ' ')}</span>
              </div>
              <div style={{ display: 'flex', gap: 18, marginTop: 12 }}>
                <div><div style={{ fontSize: 22, fontWeight: 700 }}>{m.assigned_open}</div><div className="muted" style={{ fontSize: 11 }}>open assigned</div></div>
                <div><div style={{ fontSize: 22, fontWeight: 700 }}>{money(m.assigned_value)}</div><div className="muted" style={{ fontSize: 11 }}>on their desk</div></div>
                <div><div style={{ fontSize: 22, fontWeight: 700, color: m.assigned_rush ? '#e5484d' : undefined }}>{m.assigned_rush}</div><div className="muted" style={{ fontSize: 11 }}>rush</div></div>
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
                Done (30d): <b>{m.assigned_done_30d}</b> · Created (30d): <b>{m.created_30d}</b> · Own-rep open: <b>{m.rep_open}</b>
              </div>
              {Object.keys(m.statuses || {}).length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
                  {Object.entries(m.statuses).map(([st, c]) => (
                    <span key={st} className="pill pill-gray" style={{ fontSize: 10 }}>{st}: {c}</span>
                  ))}
                </div>
              )}
              <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>Last active: {ago(m.last_active)}</div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
