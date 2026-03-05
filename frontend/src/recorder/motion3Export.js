/**
 * 录制帧 → motion3.json 导出
 */

const DEAD_ZONE_THRESHOLD = 0.01

/**
 * 将帧缓冲区转换为 motion3.json 格式
 * @param {Array<{time: number, params: Object}>} frameBuffer
 * @param {Object} options
 * @returns {Object} motion3.json 对象
 */
export function convertToMotion3(frameBuffer, options = {}) {
  if (frameBuffer.length === 0) return null

  const { fadeInTime = 0.5, fadeOutTime = 0.5 } = options

  // 收集所有参数 ID
  const paramIds = Object.keys(frameBuffer[0].params)
  const duration = frameBuffer[frameBuffer.length - 1].time

  let totalSegmentCount = 0
  let totalPointCount = 0

  const curves = paramIds.map(id => {
    // 死区优化：跳过变化小于阈值的帧，但始终保留首末帧
    const keyframes = []
    for (let i = 0; i < frameBuffer.length; i++) {
      const frame = frameBuffer[i]
      const isFirst = i === 0
      const isLast = i === frameBuffer.length - 1

      if (isFirst || isLast) {
        keyframes.push(frame)
        continue
      }

      const prev = keyframes[keyframes.length - 1]
      if (Math.abs(frame.params[id] - prev.params[id]) >= DEAD_ZONE_THRESHOLD) {
        keyframes.push(frame)
      }
    }

    // 构建 Segments: [t0, v0, 0, t1, v1, 0, t2, v2, ...]
    // type 0 = linear interpolation
    const segments = []
    for (let i = 0; i < keyframes.length; i++) {
      if (i === 0) {
        // 首帧：只有 t, v（无类型前缀）
        segments.push(keyframes[i].time, keyframes[i].params[id])
      } else {
        // 后续帧：type, t, v
        segments.push(0, keyframes[i].time, keyframes[i].params[id])
      }
    }

    const segmentCount = Math.max(0, keyframes.length - 1)
    totalSegmentCount += segmentCount
    totalPointCount += keyframes.length

    return {
      Target: 'Parameter',
      Id: id,
      Segments: segments,
    }
  })

  return {
    Version: 3,
    Meta: {
      Duration: Math.round(duration * 1000) / 1000,
      Fps: 30,
      Loop: false,
      AreBeziersRestricted: true,
      FadeInTime: fadeInTime,
      FadeOutTime: fadeOutTime,
      CurveCount: curves.length,
      TotalSegmentCount: totalSegmentCount,
      TotalPointCount: totalPointCount,
    },
    Curves: curves,
  }
}

/**
 * 将 motion3 对象下载为 JSON 文件
 * @param {Object} motion3Obj
 * @param {string} filename - 不含扩展名
 */
export function downloadMotion3(motion3Obj, filename) {
  const json = JSON.stringify(motion3Obj, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${filename}.motion3.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
