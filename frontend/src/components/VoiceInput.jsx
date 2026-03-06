import { useState, useRef, useEffect } from 'react'
import { MicIcon } from './icons'
import { api } from '../api/client'
import './VoiceInput.css'

export default function VoiceInput({ onTranscribed, onAutoSend }) {
  const [supported, setSupported] = useState(true)
  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const mediaRecorderRef = useRef(null)
  const chunksRef = useRef([])
  const timerRef = useRef(null)

  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setSupported(false)
    }
  }, [])

  useEffect(() => {
    if (recording) {
      setElapsed(0)
      timerRef.current = setInterval(() => setElapsed(s => s + 1), 1000)
    } else {
      clearInterval(timerRef.current)
    }
    return () => clearInterval(timerRef.current)
  }, [recording])

  if (!supported) return null

  const startRecording = async () => {
    if (recording || transcribing) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mediaRecorder = new MediaRecorder(stream)
      chunksRef.current = []

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        if (chunksRef.current.length === 0) {
          mediaRecorderRef.current = null
          return
        }
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        setTranscribing(true)
        try {
          const result = await api.transcribe(blob, 'webm')
          if (result?.text) {
            onTranscribed(result.text)
            if (onAutoSend) onAutoSend(result.text)
          }
        } catch (e) {
          console.error('[VoiceInput] 识别失败:', e)
        } finally {
          setTranscribing(false)
          mediaRecorderRef.current = null
        }
      }

      mediaRecorder.start()
      mediaRecorderRef.current = mediaRecorder
      setRecording(true)
    } catch (e) {
      console.warn('[VoiceInput] 无法获取麦克风:', e)
      setSupported(false)
    }
  }

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current
    if (!recorder || recorder.state === 'inactive') return
    recorder.stop()
    setRecording(false)
  }

  let label = <MicIcon size={20} />
  if (recording) label = `${elapsed}s`
  if (transcribing) label = '...'

  return (
    <button
      className={`voice-btn ${recording ? 'recording' : ''} ${transcribing ? 'transcribing' : ''}`}
      onMouseDown={startRecording}
      onMouseUp={stopRecording}
      onTouchStart={(e) => { e.preventDefault(); startRecording() }}
      onTouchEnd={(e) => { e.preventDefault(); stopRecording() }}
      title={recording ? '松开发送' : '按住说话'}
      disabled={transcribing}
    >
      {label}
    </button>
  )
}
