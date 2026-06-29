import { Routes, Route, Navigate } from 'react-router-dom'
import Login from './pages/Login'
import Landing from './pages/Landing'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import AllQuotes from './pages/AllQuotes'
import Generator from './pages/Generator'
import Users from './pages/Users'
import Reports from './pages/Reports'
import Activity from './pages/Activity'
import ProtectedRoute from './components/ProtectedRoute'

// Placeholders for not-yet-built phases
function Coming({ phase }) {
  return <div className="center">{phase} — coming soon.</div>
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />

      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/quotes" element={<AllQuotes />} />
        <Route path="/quotes/:quoteId/generate" element={<Generator />} />
        <Route path="/companies/:companyId" element={<Coming phase="Company detail (P8)" />} />

        <Route path="/users" element={<ProtectedRoute requireAdmin><Users /></ProtectedRoute>} />
        <Route path="/reports" element={<ProtectedRoute requireAdmin><Reports /></ProtectedRoute>} />
        <Route path="/activity" element={<ProtectedRoute requireAdmin><Activity /></ProtectedRoute>} />
      </Route>

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}
