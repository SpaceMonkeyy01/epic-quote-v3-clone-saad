/* Strict allow-list HTML sanitizer for the proposal's editable blocks.

   The proposal writes saved block content straight into the DOM with innerHTML
   (EBlock). Block content can be hand-edited on the page AND round-trips through
   the server, so it is UNTRUSTED — a rep could plant `<img onerror=…>` that runs
   in whoever opens the quote next (including an admin). This scrubs every value
   before it reaches innerHTML: only text-formatting tags survive, every event
   handler / script / dangerous URL is dropped.

   Parsing with the browser's own DOMParser (not regex) means malformed or
   nested payloads can't smuggle anything through. */

const ALLOWED_TAGS = new Set([
  'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'BR', 'P', 'DIV', 'SPAN', 'FONT',
  'UL', 'OL', 'LI', 'SUB', 'SUP', 'SMALL', 'BIG', 'BLOCKQUOTE',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'A',
  'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH', 'HR',
])

// Attributes kept per element. Everything else (notably every on* handler) is stripped.
const ALLOWED_ATTRS = new Set(['style', 'align', 'color', 'size', 'face', 'colspan', 'rowspan', 'href', 'target', 'rel'])

// A style value is dropped whole if it tries anything active (url(), expression(), @import, js: …).
const STYLE_BLOCKLIST = /(url\s*\(|expression\s*\(|@import|javascript:|behavior\s*:|-moz-binding)/i

function safeHref(v) {
  const t = String(v || '').trim()
  // allow only plainly safe schemes + relative/anchor links; reject javascript:, data:, etc.
  return /^(https?:\/\/|mailto:|tel:|\/|#)/i.test(t) ? t : null
}

function clean(node) {
  // Walk a static copy of the children (removals mutate the live list).
  Array.from(node.childNodes).forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) return
    if (child.nodeType !== Node.ELEMENT_NODE) { child.remove(); return }   // comments, etc.

    if (!ALLOWED_TAGS.has(child.tagName)) {
      // Drop the tag but KEEP its text/children (unwrap) so removing a stray <div>
      // wrapper doesn't delete the words inside it.
      const parent = child.parentNode
      while (child.firstChild) parent.insertBefore(child.firstChild, child)
      child.remove()
      return
    }

    // scrub attributes
    Array.from(child.attributes).forEach((attr) => {
      const name = attr.name.toLowerCase()
      if (!ALLOWED_ATTRS.has(name)) { child.removeAttribute(attr.name); return }
      if (name === 'style' && STYLE_BLOCKLIST.test(attr.value)) { child.removeAttribute(attr.name); return }
      if (name === 'href') {
        const safe = safeHref(attr.value)
        if (safe === null) { child.removeAttribute(attr.name); return }
        child.setAttribute('href', safe)
      }
    })
    // links open safely
    if (child.tagName === 'A' && child.getAttribute('target') === '_blank') {
      child.setAttribute('rel', 'noopener noreferrer')
    }

    clean(child)   // recurse into the now-clean element
  })
  return node
}

export function sanitizeHtml(html) {
  if (html == null) return ''
  const str = String(html)
  if (!str) return ''
  const doc = new DOMParser().parseFromString(str, 'text/html')
  clean(doc.body)
  return doc.body.innerHTML
}
