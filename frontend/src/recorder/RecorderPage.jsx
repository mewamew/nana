import { useRef, useState, useCallback } from 'react'
import Live2DDisplay from '../components/Live2DModel'
import useFaceTracking from './useFaceTracking'
import { matrixToEuler, mapBlendshapes, mapPoseToHands } from './blendshapeMapping'
import { convertToMotion3, downloadMotion3 } from './motion3Export'
import './RecorderPage.css'

const MAX_DURATION = 5 // 秒

export default function RecorderPage() {
  const live2dRef = useRef(null)
  const [motionName, setMotionName] = useState('')
  const [recording, setRecording] = useState(false)
  const [duration, setDuration] = useState(0)
  const [hasFrames, setHasFrames] = useState(false)

  const frameBufferRef = useRef([])
  const startTimeRef = useRef(0)
  const prevParamsRef = useRef(null)
  const prevHandParamsRef = useRef(null)
  const recordingRef = useRef(false)

  const handleFrame = useCallback((blendshapes, matrix, poseLandmarks) => {
    const euler = matrixToEuler(matrix)
    const params = mapBlendshapes(blendshapes, euler, prevParamsRef.current)
    prevParamsRef.current = params

    // 合并手部参数
    if (poseLandmarks) {
      const handParams = mapPoseToHands(poseLandmarks, prevHandParamsRef.current)
      prevHandParamsRef.current = handParams
      Object.assign(params, handParams)
    }

    live2dRef.current?.setParameters(params)

    if (recordingRef.current) {
      const t = (performance.now() - startTimeRef.current) / 1000
      frameBufferRef.current.push({ time: t, params: { ...params } })
      setDuration(t)
      if (t >= MAX_DURATION) {
        handleStop()
      }
    }
  }, [])

  const { videoRef, isLoading, isReady, faceDetected } = useFaceTracking({
    onFrame: handleFrame,
  })

  function handleRecord() {
    frameBufferRef.current = []
    startTimeRef.current = performance.now()
    setDuration(0)
    setHasFrames(false)
    recordingRef.current = true
    setRecording(true)
  }

  function handleStop() {
    recordingRef.current = false
    setRecording(false)
    setHasFrames(frameBufferRef.current.length > 0)
  }

  function handleExport() {
    if (frameBufferRef.current.length === 0) return
    const motion3 = convertToMotion3(frameBufferRef.current)
    if (!motion3) return
    const name = motionName.trim() || 'motion'
    downloadMotion3(motion3, name)
  }

  function formatTime(t) {
    const s = Math.floor(t)
    const ms = Math.floor((t - s) * 10)
    return `${String(s).padStart(2, '0')}:${ms}`
  }

  // 状态文本
  let statusText, statusClass
  if (isLoading) {
    statusText = '加载追踪模型...'
    statusClass = 'loading'
  } else if (!isReady) {
    statusText = '等待摄像头...'
    statusClass = 'loading'
  } else if (!faceDetected) {
    statusText = '未检测到面部'
    statusClass = 'no-face'
  } else {
    statusText = '就绪'
    statusClass = 'ready'
  }

  return (
    <div className="recorder-page">
      <Live2DDisplay ref={live2dRef} />

      <video
        ref={videoRef}
        className="recorder-pip"
        playsInline
        muted
      />

      <div className={`recorder-status ${statusClass}`}>
        {statusText}
      </div>

      <div className="recorder-hint">请保持上半身在画面中以捕捉手部动作</div>

      {recording && (
        <div className="recorder-indicator">
          <span className="rec-dot" />
          REC {formatTime(duration)}
        </div>
      )}

      <div className="recorder-controls">
        <input
          type="text"
          placeholder="动作名称"
          value={motionName}
          onChange={e => setMotionName(e.target.value)}
        />
        <button
          className="btn-record"
          onClick={handleRecord}
          disabled={recording || !isReady}
        >
          ● 录制
        </button>
        <button
          className="btn-stop"
          onClick={handleStop}
          disabled={!recording}
        >
          ■ 停止
        </button>
        <button
          className="btn-export"
          onClick={handleExport}
          disabled={!hasFrames || recording}
        >
          导出
        </button>
      </div>
    </div>
  )
}
