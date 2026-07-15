import { useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion, useReducedMotion } from 'framer-motion'
import { useSalesReps } from '../hooks'
import client from '../api/client'
import KpiTile from '../components/ui/KpiTile'
import EmptyState from '../components/ui/EmptyState'
import { stagger, rise, EASE } from '../components/ui/motion'

const money = (n) => '$' + Math.round(Number(n || 0)).toLocaleString()
const pct = (n) => (n == null ? '—' : Math.round(n) + '%')
// delta % between the last two entries of a series, or null when there's no meaningful prior
const lastDelta = (series) => {
  if (series.length < 2) return null
  const prev = series[series.length - 2]
  const last = series[series.length - 1]
  if (!prev) return null
  return Math.round(((last - prev) / prev) * 100)
}

export default function Reports() {
  const { data: months = [] } = useQuery({
    queryKey: ['reports-monthly'],
    queryFn: async () => (await client.get('/reports/monthly')).data,
  })

  const kpis = useMemo(() => {
    const sum = (k) => months.reduce((a, m) => a + (Number(m[k]) || 0), 0)
    const created = sum('created')
    const won = sum('done')
    return {
      quoted: sum('quoted_value'),
      wonValue: sum('done_value'),
      conversion: created ? Math.round((won / created) * 100) : 0,
      created,
      series: {
        quoted: months.map((m) => m.quoted_value),
        wonValue: months.map((m) => m.done_value),
        created: months.map((m) => m.created),
      },
    }
  }, [months])

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Sales Reports</h1>
          <div className="sub">Pipeline health, month by month — last 12 months</div>
        </div>
        <span className="range-chip">Last 12 months</span>
      </div>

      {/* KPI hero — the story in four numbers, each counting up on load */}
      <motion.div className="kpi-row" variants={stagger} initial="hidden" animate="show">
        <KpiTile label="Quoted value" value={kpis.quoted} format={money} spark={kpis.series.quoted} delta={lastDelta(kpis.series.quoted)} />
        <KpiTile label="Won value" value={kpis.wonValue} format={money} spark={kpis.series.wonValue} delta={lastDelta(kpis.series.wonValue)} />
        <KpiTile label="Conversion" value={kpis.conversion} format={(v) => Math.round(v) + '%'} accent />
        <KpiTile label="Quotes created" value={kpis.created} spark={kpis.series.created} delta={lastDelta(kpis.series.created)} />
      </motion.div>

      <TrendChart months={months} />

      <div className="report-grid">
        <Funnel />
        <Leaderboard />
      </div>

      <DetailTable months={months} />
    </>
  )
}

/* ── Trend chart ─────────────────────────────────────────────────────────────────────
   Grey bars = quotes created, gold line = quotes won that month. Bars grow and the line
   traces itself on load (reduced-motion → instant). Legend toggles a series; hovering a
   column shows the full breakdown. */
function TrendChart({ months }) {
  const reduce = useReducedMotion()
  const [show, setShow] = useState({ created: true, won: true })
  const [hover, setHover] = useState(null)
  const wrapRef = useRef(null)
  if (!months.length) return null

  const W = 760, H = 190, pad = 8
  const bw = W / months.length
  const max = Math.max(1, ...months.map((m) => Math.max(m.created, m.done)))
  const y = (v) => H - (v / max) * (H - pad)
  const cx = (i) => i * bw + bw / 2
  const wonPath = months.map((m, i) => `${i === 0 ? 'M' : 'L'} ${cx(i).toFixed(1)} ${y(m.done).toFixed(1)}`).join(' ')

  const track = (m) => (e) => {
    const r = wrapRef.current?.getBoundingClientRect()
    if (r) setHover({ m, x: e.clientX - r.left, y: e.clientY - r.top, w: r.width })
  }

  return (
    <motion.div className="panel chart-card" variants={rise} initial="hidden" animate="show">
      <div className="panel-head">
        <b>Month by month</b>
        <div className="legend">
          <button className={`legend-item ${show.created ? '' : 'off'}`} onClick={() => setShow((s) => ({ ...s, created: !s.created }))}>
            <span className="dot" style={{ background: '#aeb7c6' }} /> Created
          </button>
          <button className={`legend-item ${show.won ? '' : 'off'}`} onClick={() => setShow((s) => ({ ...s, won: !s.won }))}>
            <span className="dot" style={{ background: 'var(--gold)' }} /> Won
          </button>
        </div>
      </div>
      <div className="chart-body" ref={wrapRef} onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H + 22}`} className="chart-svg" preserveAspectRatio="none">
          {months.map((m, i) => {
            const active = hover?.m?.month === m.month
            const ch = (m.created / max) * (H - pad)
            return (
              <g key={m.month} onMouseEnter={track(m)} onMouseMove={track(m)}>
                <rect x={i * bw} y={0} width={bw} height={H} fill={active ? 'var(--gold-soft)' : 'transparent'} />
                {show.created && (
                  <motion.rect
                    x={i * bw + 7} width={bw - 14} y={H - ch} height={ch} rx="3"
                    fill={active ? '#8a94a6' : '#c2cad6'}
                    style={{ transformBox: 'fill-box', transformOrigin: 'bottom' }}
                    initial={reduce ? false : { scaleY: 0 }} animate={{ scaleY: 1 }}
                    transition={{ duration: 0.5, ease: EASE, delay: reduce ? 0 : i * 0.03 }}
                  />
                )}
                <text x={cx(i)} y={H + 16} textAnchor="middle" fontSize="9.5" fill={active ? 'var(--gold)' : 'var(--text-faint)'}>{m.label}</text>
              </g>
            )
          })}
          {show.won && (
            <motion.path
              d={wonPath} fill="none" stroke="var(--gold)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
              initial={reduce ? false : { pathLength: 0 }} animate={{ pathLength: 1 }}
              transition={{ duration: 0.9, ease: EASE, delay: reduce ? 0 : 0.2 }}
            />
          )}
          {show.won && months.map((m, i) => (
            <motion.circle
              key={m.month} cx={cx(i)} cy={y(m.done)} r={hover?.m?.month === m.month ? 5 : 3.2} fill="var(--gold)" stroke="#fff" strokeWidth="1.5"
              initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: reduce ? 0 : 0.6 + i * 0.03 }}
            />
          ))}
        </svg>
        {hover && (() => {
          const TIP = 168
          const flip = hover.x > hover.w * 0.55
          const left = flip ? Math.max(0, hover.x - TIP - 12) : Math.min(hover.w - TIP, hover.x + 12)
          return (
            <div className="chart-tip" style={{ left, top: Math.max(0, hover.y - 10) }}>
              <div className="tip-title">{hover.m.label}</div>
              <div className="tip-row"><span>Created</span><b>{hover.m.created}</b></div>
              <div className="tip-row"><span>Quoted value</span><b>{money(hover.m.quoted_value)}</b></div>
              <div className="tip-row"><span>Won</span><b>{hover.m.done}</b></div>
              <div className="tip-row"><span>Won value</span><b>{money(hover.m.done_value)}</b></div>
              <div className="tip-row"><span>Conversion</span><b>{pct(hover.m.conversion)}</b></div>
            </div>
          )
        })()}
      </div>
    </motion.div>
  )
}

/* ── Conversion funnel ───────────────────────────────────────────────────────────────
   Created → Priced → Approved → Won, with drop-off % between stages and the biggest leak
   flagged. A day-range toggle scopes the window. */
function Funnel() {
  const [days, setDays] = useState(365)
  const { data } = useQuery({
    queryKey: ['reports-funnel', days],
    queryFn: async () => (await client.get('/reports/funnel', { params: { days } })).data,
  })
  const stages = data?.stages || []
  const top = stages[0]?.count || 0
  // find the biggest single drop-off to highlight
  let worst = -1, worstDrop = -1
  for (let i = 1; i < stages.length; i++) {
    const drop = stages[i - 1].count ? 1 - stages[i].count / stages[i - 1].count : 0
    if (drop > worstDrop) { worstDrop = drop; worst = i }
  }

  return (
    <motion.div className="panel" variants={rise} initial="hidden" animate="show">
      <div className="panel-head">
        <b>Pipeline funnel</b>
        <div className="seg">
          {[30, 90, 365].map((d) => (
            <button key={d} className={days === d ? 'on' : ''} onClick={() => setDays(d)}>{d === 365 ? '12mo' : d + 'd'}</button>
          ))}
        </div>
      </div>
      <div className="funnel">
        {top === 0 ? (
          <EmptyState title="No quotes in this window" hint="Widen the range or create a quote to see the pipeline." />
        ) : stages.map((s, i) => {
          const w = top ? Math.max(4, (s.count / top) * 100) : 0
          const drop = i > 0 && stages[i - 1].count ? Math.round((1 - s.count / stages[i - 1].count) * 100) : null
          return (
            <div className="funnel-row" key={s.key}>
              <div className="funnel-meta"><span>{s.label}</span><b>{s.count}</b></div>
              <div className="funnel-track">
                <motion.div className={`funnel-fill ${i === worst ? 'leak' : ''}`}
                  initial={{ width: 0 }} animate={{ width: w + '%' }} transition={{ duration: 0.6, ease: EASE, delay: i * 0.08 }} />
              </div>
              {drop != null && <div className={`funnel-drop ${i === worst ? 'leak' : ''}`}>−{drop}%</div>}
            </div>
          )
        })}
      </div>
    </motion.div>
  )
}

/* ── Rep leaderboard ─────────────────────────────────────────────────────────────────
   Reps ranked by conversion (then wins), with a progress bar relative to the top performer.
   Rows animate into their new order when the window flips 7d ↔ 30d. */
function Leaderboard() {
  const { data: reps = [], isLoading } = useSalesReps()
  const [win, setWin] = useState('monthly')   // 'weekly' | 'monthly'

  const ranked = useMemo(() => {
    return reps
      .map((r) => ({ name: r.name, ...(r[win] || {}) }))
      .filter((r) => (r.total_quotes_received || 0) > 0)
      .sort((a, b) => (b.conversion_rate - a.conversion_rate) || (b.quotes_converted - a.quotes_converted))
  }, [reps, win])
  const topRate = Math.max(1, ...ranked.map((r) => r.conversion_rate || 0))

  return (
    <motion.div className="panel" variants={rise} initial="hidden" animate="show">
      <div className="panel-head">
        <b>Rep leaderboard</b>
        <div className="seg">
          <button className={win === 'weekly' ? 'on' : ''} onClick={() => setWin('weekly')}>7d</button>
          <button className={win === 'monthly' ? 'on' : ''} onClick={() => setWin('monthly')}>30d</button>
        </div>
      </div>
      <div className="board">
        {isLoading ? (
          <div className="center" style={{ padding: 24 }}>Loading…</div>
        ) : ranked.length === 0 ? (
          <EmptyState title="No rep activity in this window" hint="Received quotes will rank here by conversion." />
        ) : ranked.map((r, i) => (
          <motion.div layout className="board-row" key={r.name}
            transition={{ layout: { duration: 0.4, ease: EASE } }}>
            <div className="board-rank">{i + 1}</div>
            <div className="board-avatar">{initials(r.name)}</div>
            <div className="board-main">
              <div className="board-name">{r.name}</div>
              <div className="board-track">
                <motion.div className="board-fill" initial={{ width: 0 }} animate={{ width: ((r.conversion_rate || 0) / topRate) * 100 + '%' }}
                  transition={{ duration: 0.5, ease: EASE }} />
              </div>
            </div>
            <div className="board-stat"><b>{Math.round(r.conversion_rate)}%</b><span>{r.quotes_converted}/{r.total_quotes_received}</span></div>
          </motion.div>
        ))}
      </div>
    </motion.div>
  )
}

const initials = (name) => (name || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()

/* ── Detail table ────────────────────────────────────────────────────────────────────
   The exact monthly numbers, tabular figures so columns never jitter, newest first. */
function DetailTable({ months }) {
  if (!months.length) return null
  return (
    <motion.div className="panel table-card" variants={rise} initial="hidden" animate="show">
      <div className="panel-head"><b>Monthly detail</b></div>
      <div style={{ overflowX: 'auto' }}>
        <table className="num-table">
          <thead><tr><th>Month</th><th>Created</th><th>Quoted value</th><th>Won</th><th>Won value</th><th>Conversion</th></tr></thead>
          <tbody>
            {[...months].reverse().map((m) => (
              <tr key={m.month}>
                <td><b>{m.label}</b></td>
                <td>{m.created}</td>
                <td>{money(m.quoted_value)}</td>
                <td>{m.done}</td>
                <td>{money(m.done_value)}</td>
                <td>{m.conversion == null ? <span className="muted">—</span> : pct(m.conversion)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </motion.div>
  )
}
