// Presentational "Custom Specifications" wizard step (manual mode). The two-level type
// picker prefills the spec text; every field is controlled by Generator()'s hooks. The
// spec-sync helpers (setCustomDim / setCustomApplication / syncSpecFromFields) are passed
// in verbatim — this component owns no state.
import { T, SIGN_GROUP_ORDER, signGroupOf } from '../../generator/catalog'
import { FA_FAMILY_ORDER, FA_SIGN_GROUPS, faMountingOptions, faThicknessOptions, faTrimCapOptions, faLeafExtras } from '../../generator/faCatalog'
import { buildSpecLines } from '../../generator/proposal'
import { parseDims } from '../../generator/questions'
import { pickSideView } from '../../generator/sideviews'
import { syncSpecFromFields } from '../../generator/specSync'
import { saveCatalogItem } from '../../api/catalog'
import { MAX_PRICE } from '../../generator/parts'
import MoneyInput from '../MoneyInput'

export default function CustomSpecsStep({
  customSpec, setCustomSpec, customTypeSel, setCustomTypeSel,
  typePicking, setTypePicking, typeGroup, setTypeGroup,
  signLib, setSignLib, sideViews, setSideViews, client,
  newTypeName, setNewTypeName, newTypeSpec, setNewTypeSpec,
  customDimsStatus, setCustomDim, setCustomApplication, special, setSpecial,
  saveNext, saving,
}) {
  // FA sign types (family/mounting-driven) prefill from a resolved leaf's spec — the rep
  // free-edits from there (this flow is a one-time prefill, not the live wizard). FA checked
  // FIRST: several FA sign types share their exact name with the legacy T[] entry they
  // supersede (kept only so an old saved quote still resolves) — the picker only ever offers
  // the CURRENT one, so a name match must resolve to that, not the hidden legacy entry.
  const cat = FA_SIGN_GROUPS.find((g) => g.n === customTypeSel) || T.find((t) => t.n === customTypeSel)
  const trimOpts = cat?.fa && cat.hasTrimCap ? faTrimCapOptions(cat) : []
  const thickOpts = cat?.fa && cat.hasThickness ? faThicknessOptions(cat) : []
  const mountOpts = cat?.fa ? faMountingOptions(cat, customSpec?.fa_thickness, customSpec?.fa_trimcap) : []

  // Item Description format: "{Sign Type} WITH {Mounting} FOR {Company}" — the mounting is part
  // of what the customer is buying, so it belongs in the line-item text. Types without a
  // mounting (non-FA / free-typed) fall back to "{Sign Type} FOR {Company}".
  const itemDescFor = (base, mounting) =>
    `${base}${mounting ? ` WITH ${String(mounting).toUpperCase()}` : ''} FOR ${client.company_name || 'CUSTOMER'}`

  // Rebuild the spec text for the CURRENT type + the given mounting/thickness (auto-picks the
  // first option of each when not yet chosen — #7 "thickness/mounting not being asked/picked").
  const applyFaConfig = (mounting, thickness, trimcap) => {
    const answers = { fa_mounting: mounting, fa_thickness: thickness, fa_trimcap: trimcap }
    const specText = syncSpecFromFields(buildSpecLines(cat, answers, null).join('\n'), customSpec)
    // The construction diagram is a property of the exact leaf, not of the sign type: trim cap
    // and mounting each change what the side view must show. Follow the leaf unless the rep
    // has hand-picked something else (then their choice stands).
    const prevKey = faLeafExtras(cat, { fa_mounting: customSpec?.fa_mounting, fa_thickness: customSpec?.fa_thickness, fa_trimcap: customSpec?.fa_trimcap }).sideview
    const nextKey = faLeafExtras(cat, answers).sideview
    if (nextKey && (sideViews.length === 0 || (sideViews.length === 1 && sideViews[0] === prevKey))) setSideViews([nextKey])
    // Keep the Item Description's mounting in step with the dropdown — but NEVER overwrite a
    // description the rep hand-edited: only regenerate when the current text still exactly
    // matches what the auto-format produced for the previous mounting.
    const autoBefore = itemDescFor(cat?.desc || customTypeSel, customSpec?.fa_mounting)
    const itemDesc = (!customSpec?.itemDesc || customSpec.itemDesc === autoBefore)
      ? itemDescFor(cat?.desc || customTypeSel, mounting)
      : customSpec.itemDesc
    setCustomSpec({ ...customSpec, fa_mounting: mounting, fa_thickness: thickness, fa_trimcap: trimcap, specText, itemDesc })
  }

  return (
    <div className="step">
      <div className="step-accent" />
      <div className="step-head">
        <span className="step-icon">📋</span>
        <h3>Custom Specifications</h3>
      </div>
      <div className="step-section">1. Sign basics</div>
      <div className="field">
        <label>Sign type</label>
        {/* Two-level, fully reversible picker (#2): main sign types first, then the
            underlying types; "← Main sign types" walks back up at any point. */}
        {(() => {
          const pickCustomType = (v) => {
            setCustomTypeSel(v)
            setTypePicking(false); setTypeGroup(null)
            if (v === '' || v === '__new__') return
            const nextCat = FA_SIGN_GROUPS.find((g) => g.n === v) || T.find((t) => t.n === v)
            const stored = signLib.find((s) => s.name === v)
            // FA types: auto-pick the first thickness/mounting so the spec is never left with
            // unfilled placeholders the rep never got asked to choose.
            const trimcap = nextCat?.hasTrimCap ? faTrimCapOptions(nextCat)[0] : undefined
            const thickness = nextCat?.hasThickness ? faThicknessOptions(nextCat)[0] : undefined
            const mounting = nextCat?.fa ? faMountingOptions(nextCat, thickness, trimcap)[0] : undefined
            // the template inherits whatever dims/depth/application are already typed —
            // the boxes are the source of truth (fixes RETURNS not matching the D box)
            const specText = syncSpecFromFields(
              nextCat ? buildSpecLines(nextCat, { fa_mounting: mounting, fa_thickness: thickness, fa_trimcap: trimcap }, null).join('\n') : (stored?.data?.spec || `SIGN TYPE: ${v}`),
              customSpec
            )
            // the sign type implies its construction side view — pick it automatically. An FA
            // type resolves to its exact leaf's diagram; anything else falls back to the
            // name-based prior (all a free-typed/legacy type can offer).
            if (nextCat && sideViews.length === 0) {
              const leafKey = nextCat.fa ? faLeafExtras(nextCat, { fa_mounting: mounting, fa_thickness: thickness, fa_trimcap: trimcap }).sideview : ''
              const sv = leafKey || pickSideView(nextCat.n)?.selected
              if (sv) setSideViews([sv])
            }
            setCustomSpec({
              ...customSpec,
              itemDesc: itemDescFor(nextCat?.desc || v, mounting),
              specText,
              application: customSpec?.application || 'EXTERIOR',
              price: customSpec?.price || '',
              fa_mounting: mounting, fa_thickness: thickness, fa_trimcap: trimcap,
              // Template B (monument/pylon) carries neither a package nor a side view — custom
              // mode never sets tpl_name/tpl (see Proposal.jsx isMonoType), so this flag is the
              // only way that fact survives the pick to render time.
              mono: !!nextCat?.mono,
            })
          }
          if (!typePicking) {
            return (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <div style={{ flex: 1, border: '1px solid var(--border)', borderRadius: 8, padding: '9px 12px', background: 'var(--navy-900)' }}>
                  {customTypeSel && customTypeSel !== '__new__' ? customTypeSel : <span className="muted">— pick a sign type (prefills the spec) —</span>}
                </div>
                <button type="button" className="ghost sm" onClick={() => { setTypePicking(true); setTypeGroup(null) }}>
                  {customTypeSel ? 'Change' : 'Pick a type'}
                </button>
              </div>
            )
          }
          return (
            <div style={{ border: '1px dashed var(--border)', borderRadius: 8, padding: 10 }}>
              {typeGroup == null ? (
                <div className="sign-list">
                  {FA_FAMILY_ORDER.map((fam) => {
                    const c = FA_SIGN_GROUPS.filter((g) => g.family === fam).length
                    return (
                      <div key={fam} className="sign-opt" style={{ fontWeight: 700 }} onClick={() => setTypeGroup(fam)}>
                        {fam} <span className="muted" style={{ fontWeight: 400 }}>· {c} types →</span>
                      </div>
                    )
                  })}
                  {SIGN_GROUP_ORDER.map((g) => {
                    const c = T.filter((t) => signGroupOf(t.n) === g && !t.legacy).length
                    return c ? (
                      <div key={g} className="sign-opt" style={{ fontWeight: 700 }} onClick={() => setTypeGroup(g)}>
                        {g} <span className="muted" style={{ fontWeight: 400 }}>· {c} types →</span>
                      </div>
                    ) : null
                  })}
                  {signLib.length > 0 && (
                    <div className="sign-opt" style={{ fontWeight: 700 }} onClick={() => setTypeGroup('__team__')}>
                      TEAM'S CUSTOM TYPES <span className="muted" style={{ fontWeight: 400 }}>· {signLib.length} →</span>
                    </div>
                  )}
                  <div className="sign-opt" onClick={() => pickCustomType('__new__')}>➕ Type a new sign type…</div>
                  <div className="sign-opt muted" onClick={() => { setTypePicking(false); setTypeGroup(null) }}>Cancel</div>
                </div>
              ) : (
                <>
                  <button type="button" className="ghost sm" style={{ marginBottom: 8 }} onClick={() => setTypeGroup(null)}>← Main sign types</button>
                  <div className="sign-list">
                    {typeGroup === '__team__'
                      ? signLib.map((s) => (
                          <div key={'lib' + s.id} className={'sign-opt' + (customTypeSel === s.name ? ' sel' : '')} onClick={() => pickCustomType(s.name)}>{s.name} ✏️</div>
                        ))
                      : FA_FAMILY_ORDER.includes(typeGroup)
                      ? FA_SIGN_GROUPS.filter((g) => g.family === typeGroup).map((g) => (
                          <div key={g.n} className={'sign-opt' + (customTypeSel === g.n ? ' sel' : '')} onClick={() => pickCustomType(g.n)}>{g.n}</div>
                        ))
                      : T.filter((t) => signGroupOf(t.n) === typeGroup && !t.legacy).map((t) => (
                          <div key={t.n} className={'sign-opt' + (customTypeSel === t.n ? ' sel' : '')} onClick={() => pickCustomType(t.n)}>{t.n}</div>
                        ))}
                  </div>
                </>
              )}
            </div>
          )
        })()}
      </div>
      {/* Trim cap → thickness → mounting: each narrows the next, so changing an outer one
          re-picks the first still-valid inner option rather than leaving a combination the
          sheet doesn't define. */}
      {cat?.fa && (trimOpts.length > 0 || thickOpts.length > 0 || mountOpts.length > 1) && (
        <div className="grid2">
          {trimOpts.length > 0 && (
            <div className="field">
              <label>Trim cap</label>
              <select value={customSpec?.fa_trimcap || trimOpts[0]} onChange={(e) => {
                const nextMount = faMountingOptions(cat, customSpec?.fa_thickness, e.target.value)[0]
                applyFaConfig(nextMount, customSpec?.fa_thickness, e.target.value)
              }}>
                {trimOpts.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          )}
          {thickOpts.length > 0 && (
            <div className="field">
              <label>Thickness</label>
              <select value={customSpec?.fa_thickness || thickOpts[0]} onChange={(e) => {
                const nextMount = faMountingOptions(cat, e.target.value, customSpec?.fa_trimcap)[0]
                applyFaConfig(nextMount, e.target.value, customSpec?.fa_trimcap)
              }}>
                {thickOpts.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          )}
          {mountOpts.length > 1 && (
            <div className="field">
              <label>Mounting</label>
              <select value={customSpec?.fa_mounting || mountOpts[0]} onChange={(e) => applyFaConfig(e.target.value, customSpec?.fa_thickness, customSpec?.fa_trimcap)}>
                {mountOpts.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          )}
        </div>
      )}
      {customTypeSel === '__new__' && (
        <div className="field" style={{ border: '1px dashed var(--border)', borderRadius: 8, padding: 12 }}>
          <label>New sign type name</label>
          <input placeholder="e.g. CHANNEL LETTERS WITH BACKER" value={newTypeName} onChange={(e) => setNewTypeName(e.target.value)} />
          <label style={{ marginTop: 10 }}>Its spec template (optional — paste one from a past quote; it gets saved for the whole team, in both modes)</label>
          <textarea rows={5} value={newTypeSpec} onChange={(e) => setNewTypeSpec(e.target.value)} placeholder={'SIGN TYPE: …\nFACE: …\nRETURNS: …'} />
          <button className="ghost sm" style={{ marginTop: 8 }} disabled={!newTypeName.trim()} onClick={async () => {
            const NAME = newTypeName.trim().toUpperCase()
            const spec = newTypeSpec.trim() || `SIGN TYPE: ${NAME}`
            try { const item = await saveCatalogItem('sign_type', NAME, { spec }); setSignLib((l) => [...l.filter((x) => x.name !== NAME), item]) } catch { /* still usable locally */ }
            setCustomSpec({ ...customSpec, itemDesc: `${NAME} FOR ${client.company_name || 'CUSTOMER'}`, specText: spec, application: customSpec?.application || 'EXTERIOR', price: customSpec?.price || '' })
            setCustomTypeSel(NAME)
            setNewTypeName(''); setNewTypeSpec('')
          }}>Save & use this type</button>
        </div>
      )}
      <div className="field"><label>Item Description</label><input value={customSpec?.itemDesc || ''} onChange={(e) => setCustomSpec({ ...customSpec, itemDesc: e.target.value })} /></div>
      <div className="step-section">2. Dimensions &amp; pricing</div>
      <div className="field">
        <label>Overall dimensions (H × W × D){customDimsStatus ? `  ${customDimsStatus}` : ''}</label>
        <div className="dims-row">
          {['l', 'w', 'h'].map((part, i) => (
            <div className="dims-cell" key={part}>
              <input type="text" inputMode="decimal" placeholder={['H', 'W', 'D'][i]}
                value={parseDims(customSpec?.dims)[part] || ''}
                onChange={(e) => setCustomDim(part, e.target.value)} />
              {i < 2 && <span className="dims-x">×</span>}
            </div>
          ))}
          <span className="dims-unit">in</span>
        </div>
      </div>
      {/* price / qty / total share one row (#3) — total is read-only, derived from the other two */}
      <div className="grid3">
        <div className="field"><label>Price per unit (USD)</label><MoneyInput value={customSpec?.price || ''} onChange={(v) => setCustomSpec({ ...customSpec, price: v })} placeholder="e.g. 2500" /></div>
        <div className="field">
          <label>Quantity</label>
          <input type="number" min="1" step="1" value={customSpec?.qty ?? 1}
            onChange={(e) => { const n = parseInt(e.target.value, 10); setCustomSpec({ ...customSpec, qty: Number.isFinite(n) && n > 0 ? n : 1 }) }} />
        </div>
        <div className="field">
          <label>Total</label>
          <input disabled value={(() => { const t = (Number(customSpec?.price) || 0) * (parseInt(customSpec?.qty, 10) > 0 ? parseInt(customSpec?.qty, 10) : 1); return t > 0 ? '$' + t.toLocaleString() : '—' })()} />
        </div>
      </div>
      <div className="step-section">3. Application</div>
      <div className="field">
        <label>Application</label>
        <select value={customSpec?.application || 'EXTERIOR'} onChange={(e) => setCustomApplication(e.target.value)}>
          <option value="EXTERIOR">EXTERIOR</option><option value="INTERIOR">INTERIOR</option>
        </select>
      </div>
      <div className="step-section">4. Specification text</div>
      <div className="field"><label>Specification Text</label><textarea rows={5} value={customSpec?.specText || ''} onChange={(e) => setCustomSpec({ ...customSpec, specText: e.target.value })} /></div>
      <div className="step-section">5. Special requirements</div>
      <div className="field">
        <label>Special requirements (anything unusual about this job)</label>
        <textarea rows={1} value={special} onChange={(e) => setSpecial(e.target.value)} placeholder="e.g. rush order, special finish, permits…" />
      </div>
      <div className="foot">
        <span />{/* Back moved to the top-left bar (#4) */}
        {(() => {
          const n = Number(customSpec?.price)
          const overMax = Number.isFinite(n) && n > MAX_PRICE
          const badPrice = String(customSpec?.price ?? '').trim() === '' || !Number.isFinite(n) || n <= 0 || overMax
          // depth (D) is mandatory now, same as H and W — the overall dimensions must be complete
          const dp = parseDims(customSpec?.dims); const noDims = !dp.l || !dp.w || !dp.h
          const hint = noDims ? 'Enter all three dimensions — H × W × D (depth required)' : overMax ? `Maximum quote price is $${MAX_PRICE.toLocaleString()}` : badPrice ? 'Enter a real price (more than $0) to continue' : ''
          return (
            <>
              {hint && <span style={{ color: 'var(--text-faint)', fontSize: 12, alignSelf: 'center' }}>{hint}</span>}
              <button disabled={badPrice || noDims} onClick={saveNext}>{saving ? 'Saving…' : 'Next →'}</button>
            </>
          )
        })()}
      </div>
    </div>
  )
}
