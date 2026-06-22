import axios from 'axios'

const client = axios.create({
  // Local dev: VITE_API_URL unset → '/api' (Vite proxy). Render: full backend URL.
  baseURL: (import.meta.env.VITE_API_URL || '') + '/api',
  headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
})

client.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

client.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

// Absolute URL for backend-served files. Dev: VITE_API_URL unset → relative (Vite proxies /storage).
// Prod (split domains): prefixes the backend origin so /storage doesn't hit the static frontend → 404.
export const fileUrl = (p) =>
  p && typeof p === 'string' && p.startsWith('/storage')
    ? (import.meta.env.VITE_API_URL || '') + p
    : p

export default client
