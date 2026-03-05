import { useRef, useEffect } from 'react'
import { createWLipSyncNode } from 'wlipsync'
import wlipsyncProfile from './wlipsync-profile.json'

// 参数（仿 airi Live2DLipSync 默认值）
const CAP = 1.0
const VOLUME_SCALE = 3.0
const VOLUME_EXPONENT = 0.5
const UPDATE_INTERVAL_MS = 40   // 采样降频
const LERP_WINDOW_MS = 80       // 平滑窗口
const RAW_KEYS = ['A', 'E', 'I', 'O', 'U', 'S']
const TO_VOWEL = { A:'A', E:'E', I:'I', O:'O', U:'U', S:'I' }

export function useLipSync({ onMouthValue, onAudioEnd }) {
  const audioCtxRef = useRef(null)
  const wlipNodeRef = useRef(null)   // wLipSync AudioWorkletNode（全局单例）
  const rafIdRef = useRef(null)
  const sourceRef = useRef(null)

  // Lerp 平滑状态
  const smoothRef = useRef({ raw: 0, smoothed: 0, lastRawMs: 0, lastSmMs: 0 })

  function getAudioContext() {
    if (!audioCtxRef.current)
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)()
    return audioCtxRef.current
  }

  // 初始化 wLipSync 节点（一次性）
  async function getWLipNode() {
    if (wlipNodeRef.current) return wlipNodeRef.current
    const ctx = getAudioContext()
    wlipNodeRef.current = await createWLipSyncNode(ctx, wlipsyncProfile)
    // 节点无需连接 destination，只作为分析器
    return wlipNodeRef.current
  }

  function computeRaw(node) {
    const amp = Math.min((node.volume ?? 0) * VOLUME_SCALE, 1) ** VOLUME_EXPONENT
    const projected = { A:0, E:0, I:0, O:0, U:0 }
    for (const raw of RAW_KEYS) {
      const vowel = TO_VOWEL[raw]
      const val = node.weights?.[raw] ?? 0
      projected[vowel] = Math.max(projected[vowel], Math.min(CAP, val * amp))
    }
    return Math.max(...Object.values(projected))
  }

  function getMouthOpen() {
    const node = wlipNodeRef.current
    if (!node) return 0
    const now = performance.now()
    const s = smoothRef.current
    if (s.lastRawMs === 0 || now - s.lastRawMs >= UPDATE_INTERVAL_MS) {
      s.raw = computeRaw(node)
      s.lastRawMs = now
    }
    const alpha = Math.min(1, (now - s.lastSmMs) / LERP_WINDOW_MS)
    s.smoothed += (s.raw - s.smoothed) * alpha
    s.lastSmMs = now
    return s.smoothed
  }

  function stopLipSync() {
    if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current)
    if (sourceRef.current) { try { sourceRef.current.stop() } catch {} }
    onMouthValue(0)
  }

  async function playWithLipSync(audioBase64) {
    stopLipSync()
    const ctx = getAudioContext()
    if (ctx.state === 'suspended') await ctx.resume()
    const node = await getWLipNode()

    const binary = atob(audioBase64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    const audioBuffer = await ctx.decodeAudioData(bytes.buffer)

    const source = ctx.createBufferSource()
    source.buffer = audioBuffer
    source.connect(ctx.destination)  // 播放声音
    source.connect(node)             // 同时送入 wLipSync 分析

    sourceRef.current = source

    // 重置平滑状态
    smoothRef.current = { raw: 0, smoothed: 0, lastRawMs: 0, lastSmMs: performance.now() }

    let audioEnded = false
    let silentFrames = 0
    let audioEndCalled = false

    function callAudioEnd() {
      if (!audioEndCalled) {
        audioEndCalled = true
        onMouthValue(0)
        onAudioEnd?.()
      }
    }

    function tick() {
      const val = getMouthOpen()
      onMouthValue(val)
      if (audioEnded && val < 0.01) {
        silentFrames++
        if (silentFrames >= 20) { callAudioEnd(); return }
      } else {
        silentFrames = 0
      }
      rafIdRef.current = requestAnimationFrame(tick)
    }

    // onended 作为保底触发：音频结束后 500ms 若 tick 未触发则直接调用
    source.onended = () => {
      audioEnded = true
      setTimeout(callAudioEnd, 500)
    }
    source.start()
    tick()
  }

  useEffect(() => {
    return () => {
      stopLipSync()
      if (audioCtxRef.current) audioCtxRef.current.close()
    }
  }, [])

  function warmUp() {
    const ctx = getAudioContext()
    if (ctx.state === 'suspended') ctx.resume()
    getWLipNode()  // 预初始化，避免首次播放时延迟
  }

  return { playWithLipSync, stopLipSync, warmUp }
}
