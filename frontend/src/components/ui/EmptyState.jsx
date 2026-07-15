import { motion } from 'framer-motion'
import { rise } from './motion'

/* A calm empty state — used wherever a period/table/list has no data yet, instead of a wall of
   "$0" and "—". Title says what's missing; hint says what to do or expect. SVG mark (no emoji). */
export default function EmptyState({ title, hint }) {
  return (
    <motion.div className="empty" variants={rise}>
      <svg className="empty-mark" width="34" height="34" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="13" width="4" height="7" rx="1.5" />
        <rect x="10" y="9" width="4" height="11" rx="1.5" />
        <rect x="17" y="5" width="4" height="15" rx="1.5" opacity="0.5" />
      </svg>
      <div className="empty-title">{title}</div>
      {hint && <div className="empty-hint">{hint}</div>}
    </motion.div>
  )
}
