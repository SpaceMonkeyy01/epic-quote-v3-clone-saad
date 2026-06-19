import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useConstants, useUpdateStatus, useUpdateTags, useDeleteQuote } from '../hooks'

export default function QuoteCard({ quote }) {
  const navigate = useNavigate()
  const { data: constants } = useConstants()
  const updateStatus = useUpdateStatus()
  const updateTags = useUpdateTags()
  const del = useDeleteQuote()
  const [addingTag, setAddingTag] = useState(false)

  const remove = () => {
    if (window.confirm(`Delete quote ${quote.quote_id}? This cannot be undone.`)) del.mutate(quote.quote_id)
  }

  const statuses = constants?.statuses || []
  const tags = quote.tags || []

  const onStatus = (e) => updateStatus.mutate({ id: quote.quote_id, status: e.target.value })

  const addTag = (e) => {
    const t = e.target.value
    setAddingTag(false)
    if (t && !tags.includes(t)) updateTags.mutate({ id: quote.quote_id, tags: [...tags, t] })
  }
  const removeTag = (t) => updateTags.mutate({ id: quote.quote_id, tags: tags.filter((x) => x !== t) })

  const date = quote.created_at ? new Date(quote.created_at).toLocaleDateString() : ''

  return (
    <div className="qcard">
      <div className="top">
        <div>
          <div className="qid">{quote.quote_id}</div>
          <div className="line"><b>{quote.company_name}</b></div>
        </div>
        <div className="price">{quote.price ? `$${Number(quote.price).toLocaleString()}` : '—'}</div>
      </div>

      {quote.job_name && <div className="line">Job: <b>{quote.job_name}</b></div>}
      {quote.client_name && <div className="line">Client: <b>{quote.client_name}</b></div>}
      <div className="line">
        <span className="badge">{quote.sales_rep || 'No rep'}</span>{' '}
        <span className="muted">{date}</span>
      </div>

      <div className="field" style={{ margin: '4px 0' }}>
        <select value={quote.status} onChange={onStatus}>
          {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="tags">
        {tags.map((t) => (
          <span className="tag" key={t}>{t}<span className="x" onClick={() => removeTag(t)}>×</span></span>
        ))}
        {addingTag ? (
          <select autoFocus onChange={addTag} onBlur={() => setAddingTag(false)} style={{ width: 'auto' }} defaultValue="">
            <option value="" disabled>add tag…</option>
            {statuses.filter((s) => !tags.includes(s)).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        ) : (
          <span className="tag" style={{ cursor: 'pointer' }} onClick={() => setAddingTag(true)}>+ tag</span>
        )}
      </div>

      <div className="actions">
        <button className="sm" onClick={() => navigate(`/quotes/${quote.quote_id}/generate`)}>
          {quote.quote_type ? 'Continue / Edit' : 'Make Quote'}
        </button>
        <button className="ghost sm" onClick={() => navigate(`/companies/${quote.company_id}`)}>Company</button>
        <button className="danger sm" onClick={remove}>Delete</button>
      </div>
    </div>
  )
}
