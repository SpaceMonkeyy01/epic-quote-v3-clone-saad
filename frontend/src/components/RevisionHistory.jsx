import { useEffect, useState } from 'react'
import { getRevisions, restoreCheckpoint } from '../api/quotes'
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
  const [restoring, setRestoring] = useState(null)   // checkpoint id being restored
  const [cpPage, setCpPage] = useState(0)            // #13 — which version the wizard shows (0 = newest)
  const [showDiffs, setShowDiffs] = useState(false)  //      field diffs behind a toggle

  // #8 — revert the quote to this version. Two-step (confirm) because it rewrites the live quote;
  // the restore itself is versioned server-side, so even a wrong restore can be undone the same way.
  const doRestore = async (cp) => {
    if (!window.confirm(`Restore ${quoteId} to "${cp.label}"?\n\nThe live quote (fields + proposal) will be rewritten to exactly how it was at this version. The restore is recorded in history, so it can itself be reverted.`)) return
    setRestoring(cp.id)
    try {
      await restoreCheckpoint(quoteId, cp.id)
      window.location.reload()   // every open view (grid, proposal) must show the restored state
    } catch (e) {
      setError(e?.response?.data?.error || 'Restore failed.')
      setRestoring(null)
    }
  }

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

        {/* IMAGES WIZARD (#13): one version at a time — its proposal image front and centre,
            ‹ › walks the versions (newest first). Field diffs live behind the Details toggle. */}
        {checkpoints.length > 0 && (() => {
          const i = Math.min(cpPage, checkpoints.length - 1)
          const cp = checkpoints[i]
          return (
            <div style={{ overflowY: 'auto' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginBottom: 8 }}>
                <button className="ghost sm" disabled={i === 0} onClick={() => setCpPage(i - 1)}>‹ Newer</button>
                <b style={{ fontSize: 14 }}>{cp.label}</b>
                <span className="badge" style={{ fontSize: 10.5 }}>{cp.trigger === 'payment' ? 'payment' : 'manual'}</span>
                <span className="muted" style={{ fontSize: 11.5 }} title={fullTime(cp.created_at)}>{timeAgo(cp.created_at)}</span>
                <button className="ghost sm" disabled={i === checkpoints.length - 1} onClick={() => setCpPage(i + 1)}>Older ›</button>
              </div>
              {cp.snapshot_image
                ? <img src={cp.snapshot_image} alt={cp.label} onClick={() => setZoom(cp.snapshot_image)} title="Click to enlarge"
                    style={{ width: '100%', maxHeight: 380, objectFit: 'contain', objectPosition: 'top', background: '#fff', borderRadius: 8, border: '1px solid var(--border)', cursor: 'zoom-in' }} />
                : <div className="muted" style={{ padding: 24, textAlign: 'center', border: '1px dashed var(--border)', borderRadius: 8 }}>No image was captured for this version.</div>}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
                <button className="ghost sm" disabled={!!restoring} onClick={() => doRestore(cp)}
                  title="Revert the quote to exactly how it was at this version">
                  {restoring === cp.id ? 'Restoring…' : '↩ Restore this version'}
                </button>
                <button className="ghost sm" onClick={() => setShowDiffs((v) => !v)}>
                  {showDiffs ? 'Hide details' : `Details ▾ (${cp.changes.length} change${cp.changes.length === 1 ? '' : 's'}${pending.length ? ` · ${pending.length} pending` : ''})`}
                </button>
              </div>
              {showDiffs && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 10 }}>
                  {pending.length > 0 && i === 0 && (
                    <div style={{ border: '1px dashed var(--border)', borderRadius: 10, padding: '9px 11px' }}>
                      <b style={{ fontSize: 12.5, color: 'var(--gold)' }}>Current — not yet checkpointed</b>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
                        {pending.map((c, j) => <ChangeRow key={j} c={c} />)}
                      </div>
                    </div>
                  )}
                  {cp.changes.length === 0
                    ? <div className="muted" style={{ fontSize: 12 }}>No changes in this version.</div>
                    : cp.changes.map((c, j) => <ChangeRow key={j} c={c} />)}
                </div>
              )}
            </div>
          )
        })()}
        {/* edits exist but no checkpoint yet — show them directly */}
        {checkpoints.length === 0 && pending.length > 0 && (
          <div style={{ overflowY: 'auto', border: '1px dashed var(--border)', borderRadius: 10, padding: '11px 13px' }}>
            <b style={{ fontSize: 13, color: 'var(--gold)' }}>Current — not yet checkpointed</b>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 8 }}>
              {pending.map((c, i) => <ChangeRow key={i} c={c} />)}
            </div>
          </div>
        )}
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
