import { NavLink, Outlet } from 'react-router-dom'
import { useStore } from '../store'

const LINKS: { to: string; label: string }[] = [
  { to: '/play', label: 'Play' },
  { to: '/table', label: 'Table view' },
  { to: '/drills', label: 'Drills' },
  { to: '/players', label: 'Players' },
  { to: '/setup', label: 'Setup' },
  { to: '/hardware', label: 'Hardware' },
]

export default function Shell() {
  const wsStatus = useStore((s) => s.wsStatus)
  const units = useStore((s) => s.units)
  const setUnits = useStore((s) => s.setUnits)

  return (
    <div className="shell">
      <nav className="topnav">
        <div className="wordmark">
          <span className="dot" />
          Cue<span className="lab">Lab</span>
        </div>
        <div className="navlinks">
          {LINKS.map((l) => (
            <NavLink key={l.to} to={l.to} className={({ isActive }) => (isActive ? 'active' : '')}>
              {l.label}
            </NavLink>
          ))}
        </div>
        <div className="units-toggle" title="Measurement units">
          <button className={units === 'standard' ? 'on' : ''} onClick={() => setUnits('standard')}>
            Standard
          </button>
          <button className={units === 'metric' ? 'on' : ''} onClick={() => setUnits('metric')}>
            Metric
          </button>
        </div>
        <div className={`conn-pill ${wsStatus}`}>
          <span className="led" />
          {wsStatus === 'open' ? 'server' : wsStatus === 'connecting' ? 'connecting' : 'offline'}
        </div>
      </nav>
      {wsStatus === 'closed' && (
        <div className="offline-banner">
          Server offline — actions will fail until the CueLab server is reachable. Reconnecting…
        </div>
      )}
      <main className="page">
        <Outlet />
      </main>
    </div>
  )
}
