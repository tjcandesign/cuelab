// Floating live-STT banner shown while voice commands are active.
// Mic icon + interim/final transcript; the transcript fades back to
// "Listening…" ~3 s after a final result.

import { useEffect, useState } from 'react'
import { useStore } from '../store'

export default function VoiceBanner() {
  const on = useStore((s) => s.voiceOn)
  const tr = useStore((s) => s.voiceTranscript)
  const [faded, setFaded] = useState(false)

  useEffect(() => {
    if (!tr) {
      setFaded(false)
      return
    }
    setFaded(false)
    if (tr.final) {
      const t = setTimeout(() => setFaded(true), 3000)
      return () => clearTimeout(t)
    }
  }, [tr])

  if (!on) return null
  const showText = tr && !faded

  return (
    <div className="voice-banner" role="status">
      <span className={`vb-mic${showText && !tr.final ? ' live' : ''}`}>
        <MicIcon />
      </span>
      <span className={`vb-text${showText ? (tr.final ? ' final' : '') : ' idle'}`}>
        {showText ? tr.text : 'Listening…'}
      </span>
    </div>
  )
}

function MicIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10v1a7 7 0 0 0 14 0v-1" />
      <line x1="12" y1="18" x2="12" y2="22" />
    </svg>
  )
}
