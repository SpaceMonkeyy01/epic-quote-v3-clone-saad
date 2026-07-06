import { useState } from 'react'

/* A money field that behaves (Sami's rule 7):
   - accepts digits and one dot only — letters, minus signs and symbols are ignored on entry
   - shows formatted currency ($1,234.56) whenever you leave the field
   - the moment you click back in, it turns into the plain number, so clearing and
     retyping always starts clean — no fighting the formatting
   - clamps to a sane maximum (a $1e9 typo can never enter the system)
   Emits the raw numeric string upward; parents keep using Number(value). */
export default function MoneyInput({ value, onChange, placeholder = '', style, max = 10000000, ...rest }) {
  const [focused, setFocused] = useState(false)
  const raw = value == null ? '' : String(value)

  const fmt = (v) => {
    if (v === '' || isNaN(Number(v))) return ''
    return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
  const clean = (s) => {
    let t = String(s).replace(/[^0-9.]/g, '')          // digits + dot only
    const i = t.indexOf('.')
    if (i !== -1) t = t.slice(0, i + 1) + t.slice(i + 1).replace(/\./g, '').slice(0, 2)  // one dot, 2 decimals
    if (t !== '' && t !== '.' && Number(t) > max) t = String(max)
    return t
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      placeholder={placeholder}
      style={style}
      value={focused ? raw : fmt(raw)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onChange={(e) => onChange(clean(e.target.value))}
      {...rest}
    />
  )
}
