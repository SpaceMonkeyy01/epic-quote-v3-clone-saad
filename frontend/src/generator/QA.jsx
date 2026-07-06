import { useEffect, useMemo, useState } from 'react'
import { buildQuestions, parseDims, composeDims } from './questions'
import MoneyInput from '../components/MoneyInput'

/* Single, consistent Specifications form. Every sign type shows ONE page of fields
   (the set adapts to the type, but it's always one page — never a variable-length chat).
   Answers are seeded from existing values → AI/template defaults, and synced live to the
   parent so "Next" is always enabled with the current values. */
export default function QA({ tpl, ai, initialAnswers = {}, onComplete }) {
  const questions = useMemo(() => buildQuestions(tpl, ai), [tpl, ai])

  const seed = useMemo(() => {
    const a = {}
    questions.forEach((q) => {
      if (q.type === 'dims') {
        // seed the parts from saved parts, else parse the saved/AI string
        const src = (initialAnswers.dim_l || initialAnswers.dim_w || initialAnswers.dim_h)
          ? { l: initialAnswers.dim_l, w: initialAnswers.dim_w, h: initialAnswers.dim_h }
          : parseDims(initialAnswers.dimensions ?? q.def)
        a.dim_l = src.l || ''
        a.dim_w = src.w || ''
        // 2-part mode (standard signs, H × W): the 3rd number in an AI/old string is the
        // DEPTH — it already lives in the Returns/Thickness answer, so drop it here.
        a.dim_h = (q.parts || 3) === 3 ? (src.h || '') : ''
        a.dimensions = composeDims(a.dim_l, a.dim_w, a.dim_h)
        return
      }
      a[q.key] = initialAnswers[q.key]
        ?? (q.def != null ? String(q.def) : (q.type === 'chips' && q.options?.length ? q.options[0] : ''))
    })
    return a
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questions])

  const [answers, setAnswers] = useState(seed)
  const setA = (k, v) => setAnswers((s) => ({ ...s, [k]: v }))
  // update one dimension part and re-derive the canonical L×W×H string in lock-step
  const setDim = (part, v) => setAnswers((s) => {
    const n = { ...s, [part]: v }
    n.dimensions = composeDims(n.dim_l, n.dim_w, n.dim_h)
    return n
  })

  // keep the parent in sync (seed on mount + every edit) so the wizard always has current answers
  useEffect(() => { onComplete(answers) }, [answers]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="qa-form">
      {questions.map((q) => (
        <div className="field" key={q.key}>
          <label>{q.q}{q.aiSet ? '  ⚡ AI' : ''}</label>
          {q.type === 'dims' ? (
            <div className="dims-row">
              {(q.parts === 2 ? ['dim_l', 'dim_w'] : ['dim_l', 'dim_w', 'dim_h']).map((part, i, arr) => (
                <div className="dims-cell" key={part}>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder={(q.parts === 2 ? ['H', 'W'] : ['L', 'W', 'H'])[i]}
                    value={answers[part] ?? ''}
                    onChange={(e) => setDim(part, e.target.value)}
                  />
                  {i < arr.length - 1 && <span className="dims-x">×</span>}
                </div>
              ))}
              <span className="dims-unit">in</span>
            </div>
          ) : q.type === 'chips' ? (
            <div className="chip-row">
              {q.options.map((opt) => (
                <button
                  type="button"
                  key={opt}
                  className={'chip' + (answers[q.key] === opt ? ' sel' : '')}
                  onClick={() => setA(q.key, opt)}
                >
                  {opt}
                </button>
              ))}
            </div>
          ) : (
            q.type === 'number' ? (
              <MoneyInput
                placeholder={q.placeholder || ''}
                value={answers[q.key] ?? ''}
                onChange={(v) => setA(q.key, v)}
              />
            ) : (
              <input
                type="text"
                placeholder={q.placeholder || ''}
                value={answers[q.key] ?? ''}
                onChange={(e) => setA(q.key, e.target.value)}
              />
            )
          )}
        </div>
      ))}
    </div>
  )
}
