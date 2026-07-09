import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getActivityFeed } from '../api/quotes'
import { timeAgo, fullTime } from '../utils/timeAgo'
import RevisionHistory from '../components/RevisionHistory'

/* Airtable-style activity log: a live grid of EVERY quote with its latest change in the last
   columns (what changed · who · how long ago), newest first. Click any row to open that quote's
   full version history (field diffs + the rendered proposal image at each version). */
export default function Activity() {
  const [search, setSearch] = useState('')
  const [historyFor, setHistoryFor] = useState(null)

  // refetch on an interval so the "x minutes ago" column and new edits stay current
  const { data: rows = [], isLoading, isError, error } = useQuery({
    queryKey: ['activity-feed'],
    queryFn: getActivityFeed,
    refetchInterval: 60_000,
    retry: false,
  })
  const errMsg = isError
    ? (error?.response?.status === 404
        ? 'The activity feed endpoint is not live on the server (HTTP 404). The backend needs to be restarted/redeployed with the latest code (and its route cache cleared).'
        : (error?.response?.data?.error || error?.message || 'Could not load the activity feed.'))
    : ''

  const money = (n) => (n > 0 ? '$' + Number(n).toLocaleString() : '—')

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) =>
      [r.quote_id, r.company, r.job_name, r.assigned_to, r.changed_by, r.last_change]
        .filter(Boolean).some((s) => String(s).toLowerCase().includes(q))
    )
  }, [rows, search])

  const edited = rows.filter((r) => r.changed_at).length

  return (
    <>
      <div className="page-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ marginBottom: 2 }}>Activity Log</h1>
          <div className="muted" style={{ fontSize: 13 }}>{rows.length} quote{rows.length === 1 ? '' : 's'} · {edited} with tracked changes</div>
        </div>
        <input
          placeholder="Search quote, company, person…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: 260 }}
        />
      </div>

      {errMsg && (
        <div className="err" style={{ marginBottom: 14, padding: '10px 14px', borderRadius: 8 }}>
          ⚠ {errMsg}
        </div>
      )}

      {isLoading ? (
        <div className="center">Loading…</div>
      ) : isError ? null : (
        <div style={{ overflowX: 'auto' }}>
          <table className="grid">
            <thead>
              <tr>
                <th style={{ width: 46 }}></th>
                <th>Quote</th>
                <th>Company / Job</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Price</th>
                <th>Latest change</th>
                <th>Changed by</th>
                <th style={{ whiteSpace: 'nowrap' }}>When</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.quote_id} onClick={() => setHistoryFor(r.quote_id)} style={{ cursor: 'pointer' }} title="Open full version history">
                  <td style={{ padding: 4 }}>
                    {r.snapshot_image
                      ? <img src={r.snapshot_image} alt="" style={{ width: 38, height: 48, objectFit: 'cover', objectPosition: 'top', borderRadius: 4, border: '1px solid var(--border)', background: '#fff', display: 'block' }} />
                      : <div style={{ width: 38, height: 48, borderRadius: 4, border: '1px dashed var(--border)', display: 'grid', placeItems: 'center', color: 'var(--text-faint)', fontSize: 16 }}>—</div>}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <div style={{ fontWeight: 700 }}>{r.quote_id}</div>
                    {r.rev_label && <div className="muted" style={{ fontSize: 11 }}>{r.rev_label}</div>}
                  </td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{r.company}</div>
                    {r.job_name && <div className="muted" style={{ fontSize: 12 }}>{r.job_name}</div>}
                  </td>
                  <td><span className="badge">{r.status}</span></td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{money(r.price)}</td>
                  <td style={{ maxWidth: 320 }}>
                    {r.last_change
                      ? <span>{r.last_change}{r.change_count > 1 && <span className="muted"> · +{r.change_count - 1} more</span>}</span>
                      : <span className="muted">No changes yet</span>}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>{r.changed_by || <span className="muted">—</span>}</td>
                  <td style={{ whiteSpace: 'nowrap' }} className="muted" title={fullTime(r.changed_at)}>{r.changed_at ? timeAgo(r.changed_at) : '—'}</td>
                </tr>
              ))}
              {shown.length === 0 && <tr><td colSpan={8} className="center">No quotes match this search.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {historyFor && <RevisionHistory quoteId={historyFor} onClose={() => setHistoryFor(null)} />}
    </>
  )
}
