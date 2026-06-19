import { useEffect, useMemo, useState } from 'react'
import { buildQuestions } from './questions'

/* Single, consistent Specifications form. Every sign type shows ONE page of fields
   (the set adapts to the type, but it's always one page — never a variable-length chat).
   Answers are seeded from existing values → AI/template defaults, and synced live to the
   parent so "Next" is always enabled with the current values. */
export default function QA({ tpl, ai, initialAnswers = {}, onComplete }) {
  const questions = useMemo(() => buildQuestions(tpl, ai), [tpl, ai])

  const seed = useMemo(() => {
    const a = {}
    questions.forEach((q) => {
      a[q.key] = initialAnswers[q.key]
        ?? (q.def != null ? String(q.def) : (q.type === 'chips' && q.options?.length ? q.options[0] : ''))
    })
    return a
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questions])

  const [answers, setAnswers] = useState(seed)
  const setA = (k, v) => setAnswers((s) => ({ ...s, [k]: v }))

  // keep the parent in sync (seed on mount + every edit) so the wizard always has current answers
  useEffect(() => { onComplete(answers) }, [answers]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="qa-form">
      {questions.map((q) => (
        <div className="field" key={q.key} style={{ marginBottom: 14 }}>
          <label>{q.q}{q.aiSet ? '  ⚡ AI' : ''}</label>
          {q.type === 'chips' ? (
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
            <input
              type={q.type === 'number' ? 'number' : 'text'}
              placeholder={q.placeholder || ''}
              value={answers[q.key] ?? ''}
              onChange={(e) => setA(q.key, e.target.value)}
            />
          )}
        </div>
      ))}
    </div>
  )
}
