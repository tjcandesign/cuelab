// In-browser voice commands (webkit Speech Recognition, Chrome only).
// Singleton recognizer shared by any page: interim + final transcripts are
// pushed into the store so the live STT banner can render anywhere, and
// final phrases are matched against the command vocabulary.

import { api } from './api'
import { useStore } from '../store'

let rec: CueLabSpeechRecognition | null = null
let wantOn = false

export function voiceSupported(): boolean {
  return typeof window !== 'undefined' && !!window.webkitSpeechRecognition
}

/** Turn voice commands on/off. Safe to call repeatedly. */
export function setVoiceActive(on: boolean): void {
  wantOn = on
  const store = useStore.getState()
  store.setVoiceOn(on && voiceSupported())
  if (!on) {
    store.setVoiceTranscript(null)
    stopRec()
    return
  }
  startRec()
}

function startRec(): void {
  if (rec || !voiceSupported()) return
  const Ctor = window.webkitSpeechRecognition
  if (!Ctor) return
  const r = new Ctor()
  r.continuous = true
  r.interimResults = true
  r.lang = 'en-US'
  r.onresult = (ev) => {
    let interim = ''
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const res = ev.results[i]
      if (!res) continue
      const text = res[0]?.transcript ?? ''
      if (res.isFinal) {
        const t = text.trim()
        if (t) {
          useStore.getState().setVoiceTranscript({ text: t, final: true, ts: Date.now() })
          handlePhrase(t)
        }
      } else {
        interim += text
      }
    }
    if (interim.trim()) {
      useStore.getState().setVoiceTranscript({ text: interim.trim(), final: false, ts: Date.now() })
    }
  }
  r.onend = () => {
    if (rec === r) rec = null
    // continuous recognition times out on some platforms — restart while on
    if (wantOn) setTimeout(() => { if (wantOn) startRec() }, 150)
  }
  r.onerror = () => undefined
  try {
    r.start()
    rec = r
  } catch {
    rec = null
  }
}

function stopRec(): void {
  const r = rec
  rec = null
  if (r) {
    try {
      r.abort()
    } catch {
      // ignore
    }
  }
}

/** Match a final phrase against the command vocabulary and fire the action. */
export function handlePhrase(text: string): void {
  const t = text.toLowerCase()
  const store = useStore.getState()
  const game = store.game
  const setHit = (action: string) => store.setVoiceAction({ heard: text, action })
  const trigger = (action: string, fn: () => Promise<unknown>) => {
    setHit(action)
    void fn().catch(() => undefined)
  }
  if (t.includes('lock layout')) {
    if (game) trigger('lock_layout', () => api.sessionAction(game.sessionId, 'lock_layout'))
    else setHit('no active session')
  } else if (t.includes('capture')) {
    if (game) trigger('capture', () => api.sessionAction(game.sessionId, 'capture'))
    else setHit('no active session')
  } else if (t.includes('new ball') || t.includes('reset balls')) {
    trigger('sim reset', () => api.simReset())
  } else if (t.includes('start recording')) {
    trigger('recording start', () => api.recordingStart())
  } else if (t.includes('stop recording')) {
    trigger('recording stop', () => api.recordingStop())
  } else if (t.includes('end game')) {
    if (game) {
      trigger('end session', () =>
        api.sessionAction(game.sessionId, 'end').then(() => useStore.getState().setGame(null)),
      )
    } else setHit('no active session')
  } else if (t.includes('next')) {
    if (game) trigger('next', () => api.sessionAction(game.sessionId, 'next'))
    else setHit('no active session')
  } else {
    setHit('ignored')
  }
}
