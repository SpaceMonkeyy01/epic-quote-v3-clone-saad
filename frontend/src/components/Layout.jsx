import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import useAuthStore from '../store/authStore'

export default function Layout() {
  const navigate = useNavigate()
  const { user, isAdmin, logout } = useAuthStore()
  const admin = isAdmin()

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  const link = ({ isActive }) => 'navlink' + (isActive ? ' active' : '')

  return (
    <div className="app">
      <aside className="sidebar">
        <NavLink to="/dashboard" className="brand-lock" title="Go to dashboard" style={{ cursor: 'pointer' }}>
          <img src="/quote-logo-t.png" alt="Epic Craftings" />
        </NavLink>
        <NavLink to="/dashboard" className={link}>Dashboard</NavLink>
        <NavLink to="/quotes" className={link}>All Quotes</NavLink>
        <NavLink to="/payment-links" className={link}>Payment Links</NavLink>
        {admin && <NavLink to="/team" className={link}>Team</NavLink>}
        {admin && <NavLink to="/users" className={link}>Users</NavLink>}
        {admin && <NavLink to="/reports" className={link}>Sales Reports</NavLink>}
        {admin && <NavLink to="/activity" className={link}>Activity Log</NavLink>}

        <div className="spacer" />
        <div className="user">
          <div className="name">{user?.full_name || user?.username}</div>
          <div className="role">{user?.role}</div>
          <button className="ghost sm" style={{ marginTop: 10, width: '100%' }} onClick={handleLogout}>
            Log out
          </button>
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  )
}
