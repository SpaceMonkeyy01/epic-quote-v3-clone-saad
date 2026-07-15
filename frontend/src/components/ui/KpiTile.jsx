import { motion } from 'framer-motion'
import { rise, useCountUp } from './motion'

/* A headline metric tile: a big number that counts up on mount, a label, an optional delta chip
   vs the prior period, and an optional sparkline of the trend. Reusable across every page's
   KPI row. Pass `format` to control how the (animating) number renders — round it so mid-flight
   floats never show. */
export default function KpiTile({ label, value, format = (v) => Math.round(v).toLocaleString(), delta, spark, accent }) {
  const isNum = typeof value === 'number'
  const n = useCountUp(isNum ? value : 0)
  return (
    <motion.div className="kpi" variants={rise}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" style={accent ? { color: 'var(--gold)' } : undefined}>
        {isNum ? format(n) : value}
      </div>
      <div className="kpi-foot">
        {delta != null && Number.isFinite(delta) && (
          <span className={`kpi-delta ${delta >= 0 ? 'up' : 'down'}`}>
            {delta >= 0 ? '▲' : '▼'} {Math.abs(delta)}%
          </span>
        )}
        {spark && spark.length > 1 && <Sparkline points={spark} />}
      </div>
    </motion.div>
  )
}

// A tiny trend line — no axes, no labels, just the shape of the last N periods.
function Sparkline({ points }) {
  const max = Math.max(1, ...points)
  const w = 76, h = 22
  const step = w / (points.length - 1)
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${(i * step).toFixed(1)} ${(h - (p / max) * h).toFixed(1)}`).join(' ')
  return (
    <svg className="kpi-spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <path d={d} fill="none" stroke="var(--gold)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
