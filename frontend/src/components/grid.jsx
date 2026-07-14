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

/* Grid v2: column show/hide with per-page persistence (localStorage). */
export function useColumns(storageKey, allCols) {
  const [visible, setVisible] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || 'null')
      if (Array.isArray(saved)) return new Set(saved.filter((k) => allCols.some((c) => c.key === k)))
    } catch { /* corrupted state → fall back to everything visible */ }
    return new Set(allCols.map((c) => c.key))
  })
  const toggle = (key) => {
    setVisible((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      localStorage.setItem(storageKey, JSON.stringify([...next]))
      return next
    })
  }
  return { has: (k) => visible.has(k), toggle, cols: allCols }
}

export function ColumnPicker({ columns }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ position: 'relative' }}>
      <button className="ghost sm" onClick={() => setOpen(!open)} title="Choose which columns to show">☰ Filter</button>
      {open && (
        <div style={{ position: 'absolute', right: 0, top: '110%', zIndex: 50, background: 'var(--navy-700)', border: '1px solid var(--border)', borderRadius: 8, padding: 10, minWidth: 170, boxShadow: 'var(--shadow-lg)' }}>
          {columns.cols.map((c) => (
            <label key={c.key} style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-start', fontSize: 13, padding: '4px 2px', margin: 0, cursor: 'pointer', whiteSpace: 'nowrap', color: 'var(--text)' }}>
              <input type="checkbox" checked={columns.has(c.key)} style={{ width: 16, height: 16, minWidth: 16, flex: '0 0 16px', padding: 0, margin: 0 }} onChange={() => columns.toggle(c.key)} />
              <span>{c.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

/* Grid v2: spreadsheet-style keyboard nav for editable cells.
   Enter commits and moves down; ArrowUp/ArrowDown move within the column.
   Cells opt in via data-col / data-row attributes. */
export function gridKeyNav(e, col, row) {
  const move = (delta) => {
    const target = document.querySelector(`[data-col="${col}"][data-row="${row + delta}"]`)
    if (target) { e.preventDefault(); target.focus(); target.select?.() }
  }
  if (e.key === 'Enter') { e.currentTarget.blur(); move(1) }
  else if (e.key === 'ArrowDown') move(1)
  else if (e.key === 'ArrowUp') move(-1)
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


/* Grid v4: copy + CSV export. Fields with commas/quotes/newlines are quoted per RFC 4180. */
export function toCsv(headers, rows) {
  const esc = (v) => {
    const t = v === null || v === undefined ? '' : String(v)
    return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t
  }
  return [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\r\n')
}

export function downloadCsv(filename, headers, rows) {
  const blob = new Blob(['﻿' + toCsv(headers, rows)], { type: 'text/csv;charset=utf-8' })   // BOM so Excel opens UTF-8 right
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

export async function copyTsv(headers, rows) {
  const text = [headers.join('\t'), ...rows.map((r) => r.map((v) => (v ?? '')).join('\t'))].join('\n')
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // clipboard API can be blocked — textarea fallback works everywhere
    const ta = document.createElement('textarea')
    ta.value = text; document.body.appendChild(ta); ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  }
}
