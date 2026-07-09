import client from './client'

export const listQuotes = (params = {}) =>
  client.get('/quotes', { params }).then((r) => r.data)

export const getQuote = (quoteId) =>
  client.get(`/quotes/${quoteId}`).then((r) => r.data)

export const createQuote = (payload) => {
  // multipart when a file is attached, else JSON
  if (payload.customer_pdf instanceof File) {
    const fd = new FormData()
    Object.entries(payload).forEach(([k, v]) => {
      if (v !== undefined && v !== null) fd.append(k, v)
    })
    return client.post('/quotes', fd, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data)
  }
  return client.post('/quotes', payload).then((r) => r.data)
}

export const updateQuote = (quoteId, patch) =>
  client.put(`/quotes/${quoteId}`, patch).then((r) => r.data)

export const updateStatus = (quoteId, status) =>
  client.put(`/quotes/${quoteId}/status`, { status }).then((r) => r.data)

export const updateTags = (quoteId, tags) =>
  client.put(`/quotes/${quoteId}/tags`, { tags }).then((r) => r.data)

export const deleteQuote = (quoteId) =>
  client.delete(`/quotes/${quoteId}`).then((r) => r.data)

export const getGenerated = (quoteId) =>
  client.get(`/quotes/${quoteId}/generated`).then((r) => r.data)

export const putGenerated = (quoteId, data) =>
  client.put(`/quotes/${quoteId}/generated`, data).then((r) => r.data)

const fileForm = (file) => { const fd = new FormData(); fd.append('file', file); return fd }
// Must override the client's JSON default so axios sends real multipart with a boundary, else the
// server can't parse the file and the upload fails (this is why artwork wasn't persisting).
const MULTIPART = { headers: { 'Content-Type': 'multipart/form-data' } }

// Field-level revision history for a quote (Airtable-style: who / what / when).
export const getRevisions = (quoteId) =>
  client.get(`/quotes/${quoteId}/revisions`).then((r) => r.data)

// Attach a rendered proposal image (PNG data URL) to the latest revision — visual history.
export const saveRevisionImage = (quoteId, dataUrl) =>
  client.post(`/quotes/${quoteId}/revisions/snapshot-image`, { image: dataUrl }).then((r) => r.data)

// Mint a version checkpoint ({quote_id}-rev{n}) manually, optionally with a rendered proposal image.
export const createCheckpoint = (quoteId, image = null) =>
  client.post(`/quotes/${quoteId}/checkpoints`, { trigger: 'manual', image }).then((r) => r.data)

// Attach a rendered proposal image to an existing checkpoint (used right after a payment mints one).
export const attachCheckpointImage = (quoteId, checkpointId, dataUrl) =>
  client.post(`/quotes/${quoteId}/checkpoints/${checkpointId}/image`, { image: dataUrl }).then((r) => r.data)

// Airtable-style activity feed: one row per quote with its latest change + rendered image.
export const getActivityFeed = () =>
  client.get('/revisions/feed').then((r) => r.data)

export const uploadArtwork = (quoteId, file) =>
  client.post(`/quotes/${quoteId}/artwork`, fileForm(file), MULTIPART).then((r) => r.data.path)

export const uploadCustomerFile = (quoteId, file) =>
  client.post(`/quotes/${quoteId}/pdf`, fileForm(file), MULTIPART).then((r) => r.data.path)

// Store an additional (non-primary) upload — kept so multi-file jobs lose nothing.
export const uploadExtraFile = (quoteId, file) =>
  client.post(`/quotes/${quoteId}/extra-file`, fileForm(file), MULTIPART).then((r) => r.data.path)

export const generateSpecs = (quoteId, projectInfo, sideViewKeys = '', imageData = null) =>
  client.post('/ai/generate-specs', {
    quote_id: quoteId, project_info: projectInfo, side_view_keys: sideViewKeys,
    image_data: imageData, image_type: 'image/png',
  }).then((r) => r.data)

// Lightweight party/job extraction for real-time autofill on the intake page (no quote needed yet).
// Accepts a File (PDF/image) or a plain text brief.
export const extractParty = (fileOrText) => {
  const fd = new FormData()
  if (fileOrText instanceof File) fd.append('file', fileOrText)
  else fd.append('text', fileOrText || '')
  return client.post('/ai/extract-party', fd, MULTIPART).then((r) => r.data)
}
