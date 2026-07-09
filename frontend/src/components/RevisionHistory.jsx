import { useEffect, useState } from 'react'
import { getRevisions } from '../api/quotes'
import { timeAgo, fullTime } from '../utils/timeAgo'

/* Airtable-style version history for one quote. Changes are grouped under CHECKPOINTS
   ({quote_id}-rev{n}, minted when a payment is created or a checkpoint is saved manually). Each
   checkpoint carries one rendered proposal image (opened via a "View proposal" link button) and
   lists every change folded into that version. Edits made after the last checkpoint show under a
   "Current" group at the top. Read-only. */
export default function RevisionHistory({ quoteId, onClose }) {
  const [data, setData] = useState(null)   // { checkpoints:[], pending:[] }
  const [error, setError] = useState('')
  const [zoom, setZoom] = useState(null)

  useEffect(() => {
    let alive = true
    getRevisions(quoteId)
      .then((d) => { if (alive) setData(d) })
      .catch((e) => { if (alive) setError(e?.response?.data?.error || 'Could not load history.') })
    return () => { alive = false }
  }, [quoteId])

  const checkpoints = data?.checkpoints || []
  const pending = data?.pending || []
  const isEmpty = data && checkpoints.length === 0 && pending.length === 0

  // one change entry (a single save): its field diffs + who/when
  const ChangeRow = ({ c }) => (
    <div style={{ borderLeft: '2px solid var(--border)', paddingLeft: 10, marginLeft: 2 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <b style={{ fontSize: 12.5 }}>{c.user_name}</b>
        <span className="muted" style={{ fontSize: 11.5 }} title={fullTime(c.created_at)}>{timeAgo(c.created_at)}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {c.changes.map((f, j) => (
          <div key={j} style={{ fontSize: 12, display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600, minWidth: 120, color: 'var(--text-dim)' }}>{f.label}</span>
            {f.field === '__created'
              ? <span style={{ color: 'var(--gold)' }}>created</span>
              : (
                <span style={{ display: 'inline-flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <span style={{ textDecoration: 'line-through', color: 'var(--text-faint)' }}>{String(f.old ?? '') || '—'}</span>
                  <span style={{ color: 'var(--text-faint)' }}>→</span>
                  <b>{String(f.new ?? '') || '—'}</b>
                </span>
              )}
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 640, maxHeight: '86vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h2 style={{ margin: 0 }}>History — {quoteId}</h2>
          <button className="ghost sm" onClick={onClose}>Close</button>
        </div>

        {error && <p className="err">{error}</p>}
        {!data && !error && <div className="center" style={{ padding: 30 }}>Loading history…</div>}
        {isEmpty && <div className="muted" style={{ padding: 20 }}>No changes recorded yet.</div>}

        <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* uncheckpointed edits (after the last payment/checkpoint) */}
          {pending.length > 0 && (
            <div style={{ border: '1px dashed var(--border)', borderRadius: 10, padding: '11px 13px', background: 'var(--navy-700)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 9 }}>
                <b style={{ fontSize: 13, color: 'var(--gold)' }}>Current — not yet checkpointed</b>
                <span className="muted" style={{ fontSize: 11.5 }}>{pending.length} change{pending.length === 1 ? '' : 's'}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {pending.map((c, i) => <ChangeRow key={i} c={c} />)}
              </div>
            </div>
          )}

          {/* checkpoints (versions), newest first */}
          {checkpoints.map((cp) => (
            <div key={cp.id} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '11px 13px', background: 'var(--navy-700)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 9, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                  <b style={{ fontSize: 14 }}>{cp.label}</b>
                  <span className="badge" style={{ fontSize: 10.5 }}>{cp.trigger === 'payment' ? 'payment' : 'manual'}</span>
                  <span className="muted" style={{ fontSize: 11.5 }} title={fullTime(cp.created_at)}>{timeAgo(cp.created_at)}</span>
                </div>
                {cp.snapshot_image
                  ? <button className="ghost sm" onClick={() => setZoom(cp.snapshot_image)} title="View the proposal at this version">🖼 View proposal</button>
                  : <span className="muted" style={{ fontSize: 11.5 }}>no image</span>}
              </div>
              {cp.changes.length === 0
                ? <div className="muted" style={{ fontSize: 12, paddingLeft: 12 }}>No changes in this version.</div>
                : <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>{cp.changes.map((c, i) => <ChangeRow key={i} c={c} />)}</div>}
            </div>
          ))}
        </div>
      </div>

      {/* full-size proposal viewer */}
      {zoom && (
        <div
          onMouseDown={(e) => { e.stopPropagation(); setZoom(null) }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, cursor: 'zoom-out' }}
        >
          <img src={zoom} alt="Proposal version" style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 6, boxShadow: '0 10px 40px rgba(0,0,0,0.6)', background: '#fff' }} />
        </div>
      )}
    </div>
  )
}
