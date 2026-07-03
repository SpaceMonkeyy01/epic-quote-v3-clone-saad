import client from './client'

export const getConstants = () => client.get('/constants').then((r) => r.data)
export const getDashboard = () => client.get('/dashboard').then((r) => r.data)
export const getSalesReps = () => client.get('/reports/sales-reps').then((r) => r.data)
export const getActivity = (params = {}) => client.get('/activity', { params }).then((r) => r.data)

export const getLogo = () => client.get('/settings/logo').then((r) => r.data)
export const setLogo = (file) => {
  const fd = new FormData(); fd.append('file', file)
  return client.post('/settings/logo', fd).then((r) => r.data)
}
