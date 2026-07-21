import { useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import Shell from './components/Shell'
import { ensureWs } from './lib/ws'
import { useStore } from './store'
import DrillEditor from './pages/DrillEditor'
import Drills from './pages/Drills'
import Hardware from './pages/Hardware'
import Play from './pages/Play'
import Players from './pages/Players'
import PlayerProfile from './pages/PlayerProfile'
import Projector from './pages/Projector'
import Setup from './pages/Setup'
import TableView from './pages/TableView'

export default function App() {
  const location = useLocation()
  const loadConfig = useStore((s) => s.loadConfig)
  const loadCalibration = useStore((s) => s.loadCalibration)

  useEffect(() => {
    const role = location.pathname.startsWith('/projector') ? 'projector' : 'control'
    ensureWs(role)
    // one-time bootstrap; ensureWs handles repeated calls
  }, [location.pathname])

  useEffect(() => {
    void loadConfig()
    void loadCalibration()
  }, [loadConfig, loadCalibration])

  return (
    <Routes>
      <Route path="/projector" element={<Projector />} />
      <Route element={<Shell />}>
        <Route path="/" element={<Navigate to="/play" replace />} />
        <Route path="/play" element={<Play />} />
        <Route path="/table" element={<TableView />} />
        <Route path="/drills" element={<Drills />} />
        <Route path="/drills/:id/edit" element={<DrillEditor />} />
        <Route path="/players" element={<Players />} />
        <Route path="/players/:id" element={<PlayerProfile />} />
        <Route path="/setup" element={<Setup />} />
        <Route path="/hardware" element={<Hardware />} />
        <Route path="*" element={<Navigate to="/play" replace />} />
      </Route>
    </Routes>
  )
}
