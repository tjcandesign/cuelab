import { create } from 'zustand'
import { api } from './lib/api'
import { loadUnits, UNITS_KEY, type Units } from './lib/units'
import type {
  Ball,
  Calibration,
  Config,
  EventMsg,
  GameSnapshot,
  SceneItem,
  WsStatus,
} from './lib/types'

interface CueLabStore {
  wsStatus: WsStatus
  balls: Ball[]
  moving: boolean
  stateTs: number
  game: GameSnapshot | null
  scene: SceneItem[]
  config: Config | null
  calibration: Calibration | null
  lastEvent: EventMsg | null
  units: Units

  setUnits: (u: Units) => void
  setWsStatus: (s: WsStatus) => void
  setLiveState: (balls: Ball[], moving: boolean, ts: number) => void
  setGame: (g: GameSnapshot | null) => void
  setScene: (items: SceneItem[]) => void
  setConfig: (c: Config | null) => void
  setCalibration: (c: Calibration | null) => void
  setLastEvent: (e: EventMsg | null) => void

  loadConfig: () => Promise<void>
  loadCalibration: () => Promise<void>
}

export const useStore = create<CueLabStore>((set) => ({
  wsStatus: 'connecting',
  balls: [],
  moving: false,
  stateTs: 0,
  game: null,
  scene: [],
  config: null,
  calibration: null,
  lastEvent: null,
  units: loadUnits(),

  setUnits: (units) => {
    localStorage.setItem(UNITS_KEY, units)
    set({ units })
  },
  setWsStatus: (wsStatus) => set({ wsStatus }),
  setLiveState: (balls, moving, stateTs) => set({ balls, moving, stateTs }),
  setGame: (game) => set({ game }),
  setScene: (scene) => set({ scene }),
  setConfig: (config) => set({ config }),
  setCalibration: (calibration) => set({ calibration }),
  setLastEvent: (lastEvent) => set({ lastEvent }),

  loadConfig: async () => {
    try {
      const config = await api.getConfig()
      set({ config })
    } catch {
      // server offline — keep whatever we have
    }
  },
  loadCalibration: async () => {
    try {
      const calibration = await api.getCalibration()
      set({ calibration })
    } catch {
      // server offline
    }
  },
}))
