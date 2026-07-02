import client from './client'

// Team catalog — custom sign types (with spec templates) and uploaded side views.
// Added once, available to everyone in BOTH quote modes.
export const listCatalog = (kind) => client.get('/catalog', { params: { kind } }).then((r) => r.data)
export const saveCatalogItem = (kind, name, data = {}) => client.post('/catalog', { kind, name, data }).then((r) => r.data)
export const deleteCatalogItem = (id) => client.delete(`/catalog/${id}`).then((r) => r.data)
