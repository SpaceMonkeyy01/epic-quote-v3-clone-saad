import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import client, { fileUrl } from '../api/client'

const money = (n) => (n == null ? '—' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const KIND_LABEL = { deposit: '50% Deposit', balance: 'Balance', full: 'Full' }
const STATUS_PILL = { unpaid: 'amber', paid: 'green', void: 'gray' }

/* The private payment-link ledger (#Shopify): every link we've generated, searchable, with
   its identifying snapshot (title, image, company, price, who it went to) and paid status. */
export default function PaymentLinks() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [preview, setPreview] = useState(null)   // image lightbox

  const params = {}
  if (search) params.search = search
  if (status) params.status = status
  const { data: links = [], isLoading } = useQuery({
    queryKey: ['payment-links', params],
    queryFn: async () => (await client.get('/payment-links', { params })).data,
  })

  const setStatusMut = useMutation({
    mutationFn: ({ id, status }) => client.put(`/payment-links/${id}/status`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['payment-links'] }),
  })

  return (
    <div className="fill-page">
      <div className="page-head"><h1>Payment Links</h1></div>

      <div className="toolbar">
        <input className="grow" placeholder="Search title / company / email / phone…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 'auto' }}>
          <option value="">All statuses</option>
          <option value="unpaid">Unpaid</option>
          <option value="paid">Paid</option>
          <option value="void">Void</option>
        </select>
      </div>

      {isLoading ? <div className="center">Loading…</div> : (
        <div className="grid-wrap" style={{ overflow: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Image</th><th>Quote</th><th>Title</th><th>Company</th>
                <th>Type</th><th>Amount</th><th>Sent to</th><th>Status</th><th>Link</th><th></th>
              </tr>
            </thead>
            <tbody>
              {links.map((l) => (
                <tr key={l.id}>
                  <td>
                    {l.image
                      ? <img src={fileUrl(l.image)} alt="" style={{ width: 46, height: 34, objectFit: 'cover', borderRadius: 4, cursor: 'pointer' }} onClick={() => setPreview(fileUrl(l.image))} />
                      : <span className="muted">—</span>}
                  </td>
                  <td><b>{l.quote_id || '—'}</b></td>
                  <td style={{ maxWidth: 240, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={l.title}>{l.title}</td>
                  <td>{l.company_name || '—'}</td>
                  <td><span className="pill pill-purple" style={{ fontSize: 10 }}>{KIND_LABEL[l.kind] || l.kind}</span></td>
                  <td style={{ fontWeight: 600 }}>{money(l.amount)}</td>
                  <td style={{ fontSize: 12 }}>{l.email || l.contact || '—'}</td>
                  <td>
                    <span className={'pill pill-' + (STATUS_PILL[l.status] || 'gray')}>{l.status}{l.status === 'paid' && l.paid_at ? ' · ' + new Date(l.paid_at).toLocaleDateString() : ''}</span>
                  </td>
                  <td>{l.url ? <a href={l.url} target="_blank" rel="noreferrer">Open ↗</a> : <span className="muted" title="Created before Shopify was connected">pending</span>}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {l.status !== 'paid' && <button className="sm" title="Mark this link paid" onClick={() => setStatusMut.mutate({ id: l.id, status: 'paid' })}>✓ Paid</button>}{' '}
                    {l.status === 'paid' && <button className="ghost sm" onClick={() => setStatusMut.mutate({ id: l.id, status: 'unpaid' })}>Unpay</button>}{' '}
                    {l.status !== 'void' && <button className="ghost sm" title="Void this link" onClick={() => setStatusMut.mutate({ id: l.id, status: 'void' })}>Void</button>}
                  </td>
                </tr>
              ))}
              {links.length === 0 && <tr><td colSpan={10} className="center">No payment links yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {preview && (
        <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setPreview(null)}>
          <div className="modal" style={{ maxWidth: 'min(700px, 96%)' }}>
            <img src={preview} alt="payment link preview" style={{ width: '100%', borderRadius: 8 }} />
            <div className="foot"><button onClick={() => setPreview(null)}>Close</button></div>
          </div>
        </div>
      )}
    </div>
  )
}
