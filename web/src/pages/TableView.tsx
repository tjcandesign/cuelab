// /table — spectator view: the live table full-width, read-only.

import LiveTable from '../components/LiveTable'
import { useStore } from '../store'

export default function TableView() {
  const game = useStore((s) => s.game)
  const moving = useStore((s) => s.moving)
  const balls = useStore((s) => s.balls)

  return (
    <div className="page-narrow" style={{ margin: '0 auto' }}>
      <h1 className="page-title">Table view</h1>
      <p className="page-sub">Read-only live view of the table and projected overlays.</p>
      <div className="table-wrap">
        <LiveTable interactive={false} />
        <div className="table-meta">
          <span className="microlabel">
            {balls.length} balls · {moving ? 'moving' : 'settled'}
          </span>
          <span className="microlabel">
            {game ? `${String(game.mode).replace('_', ' ')} · ${String(game.phase).replace(/_/g, ' ')}` : 'no active session'}
          </span>
        </div>
      </div>
      {game?.message && <div className="phase-line mt16">{game.message}</div>}
    </div>
  )
}
