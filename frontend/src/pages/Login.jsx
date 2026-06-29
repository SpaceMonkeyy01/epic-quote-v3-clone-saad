import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import useAuthStore from '../store/authStore'

export default function Login() {
  const navigate = useNavigate()
  const login = useAuthStore((s) => s.login)

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(username, password)
      navigate('/dashboard')
    } catch (err) {
      setError(
        err.response?.data?.errors?.username?.[0] ||
        err.response?.data?.message ||
        'Login failed.'
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <img src="/quote-logo-t.png" alt="Epic Craftings" />
        </div>
        <p style={{ textAlign: 'center', color: 'var(--text-dim)', margin: '4px 0 28px', fontSize: 13 }}>
          Signage Sales Management
        </p>

        <form onSubmit={handleSubmit}>
          <div className="field" style={{ marginBottom: 14 }}>
            <label>Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoCapitalize="none"
              autoCorrect="off"
              required
              autoFocus
            />
          </div>
          <div className="field" style={{ marginBottom: 14 }}>
            <label>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>

          {error && <p className="err">{error}</p>}

          <button type="submit" disabled={loading} style={{ width: '100%', marginTop: 18, padding: '11px 0' }}>
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  )
}
