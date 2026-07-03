import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useActivity } from '../hooks'

/* Team activity, zero abstraction: filter the raw feed by USER, QUOTE and ACTION, with a
   per-user analytics strip (who created / edited / deleted / re-tagged how much) computed
   over exactly what's on screen. /activity?quote=EC100123 deep-links a single quote's history. */
export default function Activity() {
  const [sp, setSp] = useSearchParams()
  const [user, setUser] = useState(sp.get('user') || '')
  const [quote, setQuote] = useState(sp.get('quote') || '')
  const [action, setAction] = useState(sp.get('action') || '')
  const [showLogins, setShowLogins] = useState(false)

  const params = {}
  if (user) params.user = user
  if (quote) params.quote = quote
  if (action) params.action = action
  const { data: logs = [], isLoading } = useActivity(params)

  const shown = showLogins ? logs : logs.filter((l) => l.action !== 'login')
  const hiddenCount = logs.length - shown.length

  // distinct values for the dropdowns, from the loaded window
  const users = useMemo(() => [...new Set(logs.map((l) => l.user))].sort(), [logs])
  const actions = useMemo(() => [...new Set(logs.map((l) => l.action))].sort(), [logs])

  // per-user analytics over the filtered window
  const perUser = useMemo(() => {
    const m = {}
    for (const l of shown) {
      const u = (m[l.user] ||= { total: 0 })
      u.total++
      u[l.action] = (u[l.action] || 0) + 1
    }
    return Object.entries(m).sort((a, b) => b[1].total - a[1].total)
  }, [shown])

  const setFilter = (setter, key) => (e) => {
    setter(e.target.value)
    const next = new URLSearchParams(sp)
    if (e.target.value) next.set(key, e.target.value); else next.delete(key)
    setSp(next, { replace: true })
  }

  return (
    <>
      <div className="page-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <h1>Activity Log</h1>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={user} onChange={setFilter(setUser, 'user')} style={{ width: 150 }}>
            <option value="">All users</option>
            {users.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
          <input placeholder="Quote ID (e.g. EC100123)" value={quote} onChange={setFilter(setQuote, 'quote')} style={{ width: 180 }} />
          <select value={action} onChange={setFilter(setAction, 'action')} style={{ width: 160 }}>
            <option value="">All actions</option>
            {actions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <label className="muted" style={{ fontSize: 13, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
            <input type="checkbox" checked={showLogins} onChange={(e) => setShowLogins(e.target.checked)} style={{ marginRight: 6, verticalAlign: '-2px' }} />
            Show logins{!showLogins && hiddenCount > 0 ? ` (${hiddenCount} hidden)` : ''}
          </label>
        </div>
      </div>

      {/* per-user analytics for whatever is filtered on screen */}
      {perUser.length > 0 && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
          {perUser.map(([u, c]) => (
            <div key={u} className="box" style={{ padding: '10px 14px', cursor: 'pointer' }} onClick={() => setFilter(setUser, 'user')({ target: { value: user === u ? '' : u } })} title="Click to filter by this user">
              <div style={{ fontWeight: 700, fontSize: 13 }}>{u} <span className="muted" style={{ fontWeight: 400 }}>· {c.total} action{c.total === 1 ? '' : 's'}</span></div>
              <div className="muted" style={{ fontSize: 11.5, marginTop: 3 }}>
                {Object.entries(c).filter(([k]) => k !== 'total').sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k.replace(/_/g, ' ')}: ${n}`).join(' · ')}
              </div>
            </div>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="center">Loading…</div>
      ) : (
        <table>
          <thead><tr><th>When</th><th>User</th><th>Action</th><th>Details</th></tr></thead>
          <tbody>
            {shown.map((l, i) => (
              <tr key={i}>
                <td style={{ whiteSpace: 'nowrap' }} className="muted">{l.at ? new Date(l.at).toLocaleString() : ''}</td>
                <td>{l.user}</td>
                <td><span className="badge">{l.action}</span></td>
                <td>{l.details}</td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={4} className="center">No activity found for these filters.</td></tr>}
          </tbody>
        </table>
      )}
    </>
  )
}
