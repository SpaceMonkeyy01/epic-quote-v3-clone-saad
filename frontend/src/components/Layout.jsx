import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import useAuthStore from '../store/authStore'
import { IcHome, IcQuotes, IcCard, IcTeam, IcUsers, IcReports, IcActivity } from './icons'

export default function Layout() {
  const navigate = useNavigate()
  const { user, isAdmin, logout } = useAuthStore()
  const admin = isAdmin()

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  const link = ({ isActive }) => 'navlink' + (isActive ? ' active' : '')
  const name = user?.full_name || user?.username || ''
  const words = name.trim().split(/\s+/).filter(Boolean)
  const initials = (words.length > 1 ? words.map((w) => w[0]).slice(0, 2).join('') : name.slice(0, 2)).toUpperCase() || 'U'

  return (
    <div className="app">
      <aside className="sidebar">
        <NavLink to="/dashboard" className="brand-lock" title="Go to dashboard">
          <img src="/quote-logo-t.png" alt="Epic Craftings" />
        </NavLink>
        <NavLink to="/dashboard" className={link}><IcHome size={17} /> Dashboard</NavLink>
        <NavLink to="/quotes" className={link}><IcQuotes size={17} /> All Quotes</NavLink>
        <NavLink to="/payment-links" className={link}><IcCard size={17} /> Payment Links</NavLink>
        {admin && <NavLink to="/team" className={link}><IcTeam size={17} /> Team</NavLink>}
        {admin && <NavLink to="/users" className={link}><IcUsers size={17} /> Users</NavLink>}
        {admin && <NavLink to="/reports" className={link}><IcReports size={17} /> Sales Reports</NavLink>}
        {admin && <NavLink to="/activity" className={link}><IcActivity size={17} /> Activity Log</NavLink>}

        <div className="spacer" />
        <div className="user">
          <div className="user-chip">
            <span className="avatar">{initials}</span>
            <div className="who">
              <div className="name">{name}</div>
              <div className="role">{user?.role}</div>
            </div>
          </div>
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
