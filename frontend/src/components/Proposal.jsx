import { useEffect, useMemo, useRef, useState } from 'react'
import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'
import { buildSpecLines, money, esc } from '../generator/proposal'

/* M2 proposal preview: renders the captured quote as a print-ready document.
   Every labelled block is contentEditable; edits are captured into proposal_state
   (persisted via the wizard's saveProgress) and survive reopen. Export = client-side
   html2canvas → PNG/jsPDF (server-side Gotenberg comes in P7). */

const TERMS_HTML =
  '<b>Note:</b><br>' +
  '• Epic Craftings will begin your project only after receiving your signed approval on the order confirmation document along with the 50% down payment.<br>' +
  '• This Quote is valid for 30 Days Only.<br><br>' +
  '<b>Terms &amp; Conditions</b><br>' +
  '• The price includes the sign and delivery; installation is not included.<br>' +
  '• Ensure all spellings, designs, and dimensions are accurate before confirmation.<br>' +
  '• Products come with a 3-year warranty on parts.<br>' +
  '• A 5% tolerance in color and dimensions is acceptable.<br>' +
  "• Installation must follow UL and NEC guidelines and is the customer's responsibility.<br>" +
  '• Payment terms: 50% deposit upfront, remaining 50% before shipment. Orders under USD 500 are paid in full in advance.'

const HEAD = '#e9e9e9'
const cell = { fontSize: 11, border: '1px solid #777', padding: '6px 8px', outline: 'none' }
const headCell = { ...cell, background: HEAD, fontWeight: 700, borderTop: 'none' }

export default function Proposal({ mode, tpl, answers, customSpec, info, artworkPath, logo, savedState, onSave }) {
  const pageRef = useRef(null)
  const wrapRef = useRef(null)
  const [scale, setScale] = useState(1)
  const [scaledH, setScaledH] = useState(1056)
  const [busy, setBusy] = useState('')
  const [toast, setToast] = useState('')

  // fit the fixed 816px page into the available column width (keeps full-res for PDF)
  useEffect(() => {
    const fit = () => {
      if (!wrapRef.current || !pageRef.current) return
      const avail = wrapRef.current.clientWidth - 40 // wrapper padding
      const s = Math.min(1, avail / 816)
      setScale(s)
      setScaledH(pageRef.current.offsetHeight * s)
    }
    fit()
    const t = setTimeout(fit, 250) // refit after images/content settle
    window.addEventListener('resize', fit)
    return () => { clearTimeout(t); window.removeEventListener('resize', fit) }
  }, [])

  const price = Number((mode === 'custom' ? customSpec?.price : answers?.price) || 0)
  const dims = (mode === 'custom' ? customSpec?.dims : answers?.dimensions) || ''
  const itemDesc = mode === 'custom'
    ? (customSpec?.itemDesc || 'CUSTOM SIGNAGE')
    : ((tpl?.desc || 'SIGN') + ' FOR ' + (info.company || ''))

  const specHTML = useMemo(() => {
    if (mode === 'custom') return esc(customSpec?.specText || '').replace(/\n/g, '<br>')
    return buildSpecLines(tpl, answers).map(esc).join('<br>')
  }, [mode, tpl, answers, customSpec])

  const today = new Date()
  const dateStr = `${String(today.getMonth() + 1).padStart(2, '0')}/${String(today.getDate()).padStart(2, '0')}/${today.getFullYear()}`

  // default content per editable block; any saved proposal_state overrides it.
  const initial = useMemo(() => {
    const def = {
      contact: '101 E LUZERNE ST. PHILADELPHIA, PENNSYLVANIA 19124, US<br>www.epiccraftings.com<br>sales@epiccraftings.com<br>+1 (445) 444-0334',
      infoLeft: `<b>COMPANY NAME:</b> ${esc(info.company)}<br><b>CLIENT NAME:</b> ${esc(info.client)}<br><b>CONTACT:</b> ${esc(info.contact)}<br><b>ADDRESS:</b> ${esc(info.address)}`,
      infoRight: `<b>PROPOSAL ID:</b> ${esc(info.quoteId)}<br><b>DATE:</b> ${dateStr}<br><b>JOB NAME:</b> ${esc(info.job)}`,
      itemDesc: esc(itemDesc),
      unitPrice: money(price),
      totalPrice: money(price),
      specBody: specHTML,
      notes: tpl?.notes ? esc(tpl.notes) : '&nbsp;',
      subtotal: money(price),
      dep1: money(price / 2),
      dep2: money(price / 2),
      terms: TERMS_HTML,
      pay: 'CLICK HERE TO MAKE PAYMENT',
    }
    return { ...def, ...(savedState || {}) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // editable block — content set once via dangerouslySetInnerHTML so React never clobbers edits
  const E = (key, style) => (
    <div data-key={key} contentEditable suppressContentEditableWarning
      style={{ outline: 'none', ...style }}
      dangerouslySetInnerHTML={{ __html: initial[key] }} />
  )

  const captureState = () => {
    const state = {}
    pageRef.current?.querySelectorAll('[data-key]').forEach((el) => { state[el.dataset.key] = el.innerHTML })
    return state
  }

  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 2500) }

  const doSave = async () => {
    setBusy('save')
    try { await onSave(captureState()); flash('Saved') }
    catch { flash('Save failed') }
    finally { setBusy('') }
  }

  const render = async () => {
    // capture at the page's true 816px size (drop the fit-to-fit scale during render)
    const el = pageRef.current
    const prev = el.style.transform
    el.style.transform = 'none'
    try {
      return await html2canvas(el, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false })
    } finally {
      el.style.transform = prev
    }
  }

  const downloadPNG = async () => {
    setBusy('png')
    try {
      const c = await render()
      const a = document.createElement('a')
      a.download = `${info.quoteId || 'quote'}.png`
      a.href = c.toDataURL('image/png'); a.click()
      flash('PNG downloaded')
    } catch (e) { flash('PNG failed: ' + e.message) } finally { setBusy('') }
  }

  const downloadPDF = async () => {
    setBusy('pdf')
    try {
      const c = await render()
      const w = 816, h = (c.height * w) / c.width
      const doc = new jsPDF({ orientation: h > w ? 'portrait' : 'landscape', unit: 'px', format: [w, h] })
      doc.addImage(c.toDataURL('image/png'), 'PNG', 0, 0, w, h)
      doc.save(`${info.quoteId || 'quote'}.pdf`)
      flash('PDF downloaded')
    } catch (e) { flash('PDF failed: ' + e.message) } finally { setBusy('') }
  }

  return (
    <div>
      <div className="edit-hint" style={{ marginBottom: 10, fontSize: 13, color: 'var(--muted, #8a94a6)' }}>
        ✏️ Click any text on the proposal to edit it. Save keeps your edits; PDF embeds none of the handles.
      </div>

      <div ref={wrapRef} style={{ overflow: 'hidden', background: '#5a6270', padding: 20, borderRadius: 10 }}>
        <div style={{ width: 816 * scale, height: scaledH, margin: '0 auto' }}>
        <div
          ref={pageRef}
          style={{
            width: 816, minHeight: 1056, background: '#fff', color: '#111',
            fontFamily: "'Roboto', Arial, sans-serif", fontSize: 12, textTransform: 'uppercase',
            boxSizing: 'border-box', paddingBottom: 36, position: 'relative',
            transformOrigin: 'top left', transform: `scale(${scale})`,
          }}
        >
          {/* header */}
          <div style={{ height: 104, position: 'relative', padding: '0 40px' }}>
            <img src="/epic-craftings-logo.svg" alt="logo" crossOrigin="anonymous"
              style={{ height: 80, objectFit: 'contain', display: 'block', paddingTop: 16 }} />
            {E('contact', { position: 'absolute', right: 40, top: 18, fontSize: 9, textAlign: 'right', lineHeight: 1.8 })}
          </div>

          <div style={{ padding: '6px 40px 0' }}>
            <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: 1 }}>PROPOSAL</div>
          </div>

          {/* info grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', padding: '6px 40px 0', gap: 4 }}>
            {E('infoLeft', { fontSize: 11, lineHeight: 1.9 })}
            {E('infoRight', { fontSize: 11, lineHeight: 1.9 })}
          </div>

          {/* item details */}
          <div style={{ margin: '10px 40px 0', ...headCell, borderTop: '1px solid #777' }}>ITEM DETAILS</div>
          <div style={{ margin: '0 40px', border: '1px solid #777', borderTop: 'none', minHeight: 170, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' }}>
            {artworkPath
              ? <img src={artworkPath} alt="artwork" crossOrigin="anonymous" style={{ maxHeight: 160, maxWidth: 520, objectFit: 'contain' }} />
              : <span style={{ color: '#bbb', fontStyle: 'italic', fontSize: 12, textTransform: 'none' }}>[ Customer artwork — add it in the Artwork step ]</span>}
            {dims && <div style={{ position: 'absolute', bottom: 6, right: 12, fontSize: 10 }}>{dims}</div>}
          </div>

          {/* item table */}
          <div style={{ margin: '0 40px', display: 'grid', gridTemplateColumns: '1fr 56px 104px 104px' }}>
            <div style={headCell}>ITEM DESCRIPTION</div>
            <div style={{ ...headCell, borderLeft: 'none' }}>QTY</div>
            <div style={{ ...headCell, borderLeft: 'none' }}>UNIT PRICE</div>
            <div style={{ ...headCell, borderLeft: 'none' }}>TOTAL PRICE</div>
            {E('itemDesc', { ...cell, borderTop: 'none' })}
            <div style={{ ...cell, borderTop: 'none', borderLeft: 'none' }}>1</div>
            {E('unitPrice', { ...cell, borderTop: 'none', borderLeft: 'none' })}
            {E('totalPrice', { ...cell, borderTop: 'none', borderLeft: 'none' })}
          </div>

          {/* specs */}
          <div style={{ margin: '0 40px', display: 'grid', gridTemplateColumns: '1fr' }}>
            <div style={{ ...headCell }}>SPECIFICATIONS</div>
            {E('specBody', { ...cell, borderTop: 'none', fontSize: 10.5, lineHeight: 1.9, minHeight: 150, whiteSpace: 'pre-wrap' })}
            <div style={{ ...headCell }}>ADDITIONAL NOTES</div>
            {E('notes', { ...cell, borderTop: 'none', minHeight: 36 })}
          </div>

          {/* totals + terms */}
          <div style={{ margin: '12px 40px 0', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 20px' }}>
            {E('terms', { fontSize: 8.5, lineHeight: 1.6, textTransform: 'none' })}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, fontWeight: 800, marginBottom: 6 }}>
                <span>SUBTOTAL</span>{E('subtotal')}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 6 }}>
                <span>50% DEPOSIT DUE NOW</span>{E('dep1')}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
                <span>50% DUE ON SHIPMENT</span>{E('dep2')}
              </div>
              {E('pay', { marginTop: 14, background: '#f5a623', padding: 14, textAlign: 'center', fontSize: 15, fontWeight: 800, letterSpacing: 0.5 })}
            </div>
          </div>
        </div>
        </div>
      </div>

      {/* actions */}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap', marginTop: 14 }}>
        <button className="ghost" disabled={busy} onClick={doSave}>{busy === 'save' ? 'Saving…' : '💾 Save edits'}</button>
        <button disabled={busy} onClick={downloadPNG}>{busy === 'png' ? 'Rendering…' : '⬇ PNG'}</button>
        <button disabled={busy} onClick={downloadPDF}>{busy === 'pdf' ? 'Rendering…' : '⬇ Download PDF'}</button>
        {toast && <span style={{ alignSelf: 'center', color: '#2e7d32', fontWeight: 600 }}>{toast}</span>}
      </div>
    </div>
  )
}
