/// <reference types="vite/client" />

// Minimal typings for the (webkit-prefixed) Web Speech API, which is not in lib.dom.
interface CueLabSpeechRecognitionResultItem {
  transcript: string
  confidence: number
}
interface CueLabSpeechRecognitionResult {
  isFinal: boolean
  length: number
  [index: number]: CueLabSpeechRecognitionResultItem
}
interface CueLabSpeechRecognitionResultList {
  length: number
  [index: number]: CueLabSpeechRecognitionResult
}
interface CueLabSpeechRecognitionEvent {
  resultIndex: number
  results: CueLabSpeechRecognitionResultList
}
interface CueLabSpeechRecognition {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((ev: CueLabSpeechRecognitionEvent) => void) | null
  onend: (() => void) | null
  onerror: ((ev: unknown) => void) | null
  start(): void
  stop(): void
  abort(): void
}
interface Window {
  webkitSpeechRecognition?: new () => CueLabSpeechRecognition
}
