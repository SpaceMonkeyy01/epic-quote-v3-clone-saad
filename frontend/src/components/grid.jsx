import { useMemo, useState } from 'react'

/* Reusable grid building blocks (Grid v1 — T1).
   useSortable: client-side sort state over any row array.
   SortTh: clickable header cell showing the ▲/▼ direction.
   Numbers sort numerically, text alphabetically (case-insensitive), empty values sink last. */

export function useSortable(rows) {
  const [sortKey, setSortKey] = useState('')
  const [sortDir, setSortDir] = useState('asc')

  const toggle = (key) => {
    if (key === sortKey) {
      // asc → desc → off, so a third click restores the natural (newest-first) order
      if (sortDir === 'asc') setSortDir('desc')
      else { setSortKey(''); setSortDir('asc') }
    } else { setSortKey(key); setSortDir('asc') }
  }

  const sorted = useMemo(() => {
    if (!sortKey) return rows
    const val = (r) => r?.[sortKey]
    const empty = (v) => v === null || v === undefined || v === ''
    return [...rows].sort((a, b) => {
      const va = val(a), vb = val(b)
      if (empty(va) && empty(vb)) return 0
      if (empty(va)) return 1              // empties always last, whatever the direction
      if (empty(vb)) return -1
      const na = Number(va), nb = Number(vb)
      const cmp = (!Number.isNaN(na) && !Number.isNaN(nb) && String(va).trim() !== '' && String(vb).trim() !== '')
        ? na - nb
        : String(va).localeCompare(String(vb), undefined, { sensitivity: 'base' })
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [rows, sortKey, sortDir])

  return { sorted, sortKey, sortDir, toggle }
}

export function SortTh({ k, sort, children, title }) {
  const active = sort.sortKey === k
  return (
    <th
      onClick={() => sort.toggle(k)}
      title={title || 'Click to sort'}
      style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
    >
      {children}{active ? (sort.sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
    </th>
  )
}
