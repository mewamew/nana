import { useEffect, useRef, useState, useCallback } from 'react'
import { FilesetResolver, FaceLandmarker, PoseLandmarker } from '@mediapipe/tasks-vision'

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
const FACE_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'
const POSE_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task'
const FRAME_INTERVAL = 33 // ~30fps

export default function useFaceTracking({ onFrame }) {
  const videoRef = useRef(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isReady, setIsReady] = useState(false)
  const [faceDetected, setFaceDetected] = useState(false)

  const landmarkerRef = useRef(null)
  const poseLandmarkerRef = useRef(null)
  const rafRef = useRef(null)
  const lastTimeRef = useRef(0)
  const onFrameRef = useRef(onFrame)
  onFrameRef.current = onFrame

  useEffect(() => {
    let cancelled = false
    let stream = null

    async function init() {
      try {
        const vision = await FilesetResolver.forVisionTasks(WASM_URL)
        if (cancelled) return

        const [landmarker, poseLandmarker] = await Promise.all([
          FaceLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: FACE_MODEL_URL,
              delegate: 'GPU',
            },
            runningMode: 'VIDEO',
            outputFaceBlendshapes: true,
            outputFacialTransformationMatrixes: true,
            numFaces: 1,
          }),
          PoseLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: POSE_MODEL_URL,
              delegate: 'GPU',
            },
            runningMode: 'VIDEO',
            numPoses: 1,
          }),
        ])
        if (cancelled) return

        landmarkerRef.current = landmarker
        poseLandmarkerRef.current = poseLandmarker
        setIsLoading(false)

        // 获取摄像头
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480 },
        })
        if (cancelled) {
          stream.getTracks().forEach(t => t.stop())
          return
        }

        const video = videoRef.current
        if (!video) return
        video.srcObject = stream
        await video.play()

        setIsReady(true)

        // 检测循环
        function detect() {
          if (cancelled) return
          rafRef.current = requestAnimationFrame(detect)

          const now = performance.now()
          if (now - lastTimeRef.current < FRAME_INTERVAL) return
          lastTimeRef.current = now

          if (video.readyState < 2) return

          const results = landmarker.detectForVideo(video, now)

          // Pose 检测
          let poseLandmarks = null
          if (poseLandmarkerRef.current) {
            const poseResults = poseLandmarkerRef.current.detectForVideo(video, now)
            poseLandmarks = poseResults.landmarks?.[0] ?? null
          }

          if (results.faceBlendshapes && results.faceBlendshapes.length > 0) {
            setFaceDetected(true)

            // 转换 categories 数组为 {name: score} 对象
            const blendshapes = {}
            for (const cat of results.faceBlendshapes[0].categories) {
              blendshapes[cat.categoryName] = cat.score
            }

            const matrix = results.facialTransformationMatrixes?.[0]?.data
              ?? results.facialTransformationMatrixes?.[0]
              ?? null

            if (matrix) {
              onFrameRef.current(blendshapes, matrix, poseLandmarks)
            }
          } else {
            setFaceDetected(false)
          }
        }

        rafRef.current = requestAnimationFrame(detect)
      } catch (err) {
        console.error('Face tracking init error:', err)
        setIsLoading(false)
      }
    }

    init()

    return () => {
      cancelled = true
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      if (landmarkerRef.current) {
        landmarkerRef.current.close()
        landmarkerRef.current = null
      }
      if (poseLandmarkerRef.current) {
        poseLandmarkerRef.current.close()
        poseLandmarkerRef.current = null
      }
      if (stream) {
        stream.getTracks().forEach(t => t.stop())
      } else if (videoRef.current?.srcObject) {
        videoRef.current.srcObject.getTracks().forEach(t => t.stop())
      }
    }
  }, [])

  return { videoRef, isLoading, isReady, faceDetected }
}
