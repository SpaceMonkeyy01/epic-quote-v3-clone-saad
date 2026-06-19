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

export const uploadArtwork = (quoteId, file) =>
  client.post(`/quotes/${quoteId}/artwork`, fileForm(file)).then((r) => r.data.path)

export const uploadCustomerFile = (quoteId, file) =>
  client.post(`/quotes/${quoteId}/pdf`, fileForm(file)).then((r) => r.data.path)

export const generateSpecs = (quoteId, projectInfo) =>
  client.post('/ai/generate-specs', { quote_id: quoteId, project_info: projectInfo }).then((r) => r.data)
