import { useEffect, useRef, useState } from 'react'
import { animate, useReducedMotion } from 'framer-motion'

/* One motion vocabulary for the whole app (the redesign's shared language): a soft rise+fade for
   entering elements, a gentle stagger for lists/grids, one easing curve everywhere. EVERYTHING
   here honours prefers-reduced-motion — motion is polish, never a barrier to reading the data. */

export const EASE = [0.22, 0.61, 0.36, 1]   // soft ease-out — used for every UI transition

// A container that reveals its children one after another. Pair with `rise` on the children.
export const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05, delayChildren: 0.02 } },
}

// The entrance every card/tile/section uses: fade in while lifting a few px into place.
export const rise = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE } },
}

/* Count a number up from 0 → value once, when it first mounts (and re-animates from the previous
   value on change). Returns the live number to display. Reduced-motion users get the final value
   immediately — no animation, no waiting. */
export function useCountUp(value, { duration = 0.9 } = {}) {
  const reduce = useReducedMotion()
  const [display, setDisplay] = useState(reduce ? value : 0)
  const prev = useRef(0)
  useEffect(() => {
    if (reduce) { setDisplay(value); return }
    const controls = animate(prev.current, value, {
      duration,
      ease: EASE,
      onUpdate: (v) => setDisplay(v),
      onComplete: () => setDisplay(value),
    })
    prev.current = value
    // Guarantee the final number lands even if rAF is throttled (backgrounded tab): a plain timer
    // isn't rAF-gated, so the real value is never stuck at 0 — animation stays a pure enhancement.
    const settle = setTimeout(() => setDisplay(value), duration * 1000 + 400)
    return () => { controls.stop(); clearTimeout(settle) }
  }, [value, duration, reduce])
  return display
}
