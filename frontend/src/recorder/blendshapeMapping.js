/**
 * ARKit blendshapes → PinkFox Live2D 参数映射
 */

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v))
}

/**
 * 从 4×4 列主序变换矩阵提取欧拉角 (degrees)
 * MediaPipe facialTransformationMatrixes 为列主序 Float32Array[16]
 */
export function matrixToEuler(m) {
  // 列主序: m[col*4 + row]
  const m00 = m[0], m01 = m[4], m02 = m[8]
  const m10 = m[1], m11 = m[5], m12 = m[9]
  const m20 = m[2], m21 = m[6], m22 = m[10]

  const sy = Math.sqrt(m00 * m00 + m10 * m10)
  const singular = sy < 1e-6

  let pitch, yaw, roll
  if (!singular) {
    pitch = Math.atan2(m21, m22)    // X rotation
    yaw   = Math.atan2(-m20, sy)    // Y rotation
    roll  = Math.atan2(m10, m00)    // Z rotation
  } else {
    pitch = Math.atan2(-m12, m11)
    yaw   = Math.atan2(-m20, sy)
    roll  = 0
  }

  const toDeg = 180 / Math.PI
  return {
    pitch: pitch * toDeg,
    yaw:   yaw * toDeg,
    roll:  roll * toDeg,
  }
}

/**
 * 将 blendshapes + euler 角映射到 PinkFox 参数
 * @param {Object} blendshapes - {categoryName: score} 对象
 * @param {Object} euler - {pitch, yaw, roll} 欧拉角（度）
 * @param {Object|null} prevParams - 上一帧参数，用于 EMA 平滑
 * @returns {Object} PinkFox 参数 {ParamAngleX: number, ...}
 */
export function mapBlendshapes(blendshapes, euler, prevParams) {
  const bs = (name) => blendshapes[name] || 0

  // 摄像头画面镜像，yaw 取反
  const raw = {
    ParamAngleX:     clamp(-euler.yaw * 0.8, -30, 30),
    ParamAngleY:     clamp(euler.pitch * 0.8, -30, 30),
    ParamAngleZ:     clamp(euler.roll * 0.8, -30, 30),
    ParamBodyAngleX: clamp(-euler.yaw * 0.24, -10, 10),
    ParamBodyAngleY: clamp(euler.pitch * 0.24, -10, 10),
    ParamEyeLOpen:   1 - bs('eyeBlinkLeft'),
    ParamEyeROpen:   1 - bs('eyeBlinkRight'),
    ParamEyeBallX:   clamp(bs('eyeLookOutLeft') - bs('eyeLookInLeft'), -1, 1),
    ParamEyeBallY:   clamp(bs('eyeLookUpLeft') - bs('eyeLookDownLeft'), -1, 1),
    ParamBrowLY:     -(bs('browDownLeft')),
    ParamBrowRY:     -(bs('browDownRight')),
    ParamMouthOpenY: bs('jawOpen'),
    ParamMouthForm:  (bs('mouthSmileLeft') + bs('mouthSmileRight')) / 2,
    CheekPuff2:      bs('cheekPuff') * 30,
    mouthPucker2:    bs('mouthPucker') * 30,
    EyeSquint:       (bs('eyeSquintLeft') + bs('eyeSquintRight')) / 2 * 30,
  }

  // EMA 平滑
  if (!prevParams) return raw

  const alpha = 0.5
  const smoothed = {}
  for (const key in raw) {
    smoothed[key] = prevParams[key] !== undefined
      ? prevParams[key] * (1 - alpha) + raw[key] * alpha
      : raw[key]
  }
  return smoothed
}

// --- Pose → Hand 参数映射 ---

// Pose landmark 索引
const LEFT_SHOULDER  = 11
const RIGHT_SHOULDER = 12
const LEFT_ELBOW     = 13
const RIGHT_ELBOW    = 14
const LEFT_WRIST     = 15
const RIGHT_WRIST    = 16
const LEFT_INDEX     = 19
const RIGHT_INDEX    = 20

/**
 * 计算 from→to 向量相对正下方的偏转角，归一化到 -1~1
 * 0=垂直下，±1=水平及以上
 */
function segmentAngle(from, to) {
  const dx = to.x - from.x
  const dy = to.y - from.y
  // atan2(dx, dy): 0=正下方，±π/2=水平，±π=正上方
  const angle = Math.atan2(dx, dy)
  return clamp(angle / (Math.PI / 2), -1, 1)
}

/**
 * 计算三点关节的弯曲角，归一化到 -1~1
 * 完全伸直=0，完全弯曲=1
 */
function bendAngle(a, b, c) {
  const v1x = a.x - b.x, v1y = a.y - b.y
  const v2x = c.x - b.x, v2y = c.y - b.y
  const dot = v1x * v2x + v1y * v2y
  const cross = v1x * v2y - v1y * v2x
  const angle = Math.atan2(Math.abs(cross), dot) // 0~π
  // 归一化: π=伸直→0, 0=完全弯曲→1
  return clamp(1 - angle / Math.PI, -1, 1)
}

/**
 * 从 PoseLandmarker 的 landmarks 计算手部参数 (Param33-40)
 * @param {Array} poseLandmarks - landmarks[0]，每个点 {x, y, z}
 * @param {Object|null} prevHandParams - 上一帧手部参数，用于 EMA 平滑
 * @returns {Object} {Param33, Param34, ..., Param40}
 */
export function mapPoseToHands(poseLandmarks, prevHandParams) {
  const lShoulder = poseLandmarks[LEFT_SHOULDER]
  const lElbow    = poseLandmarks[LEFT_ELBOW]
  const lWrist    = poseLandmarks[LEFT_WRIST]
  const lIndex    = poseLandmarks[LEFT_INDEX]
  const rShoulder = poseLandmarks[RIGHT_SHOULDER]
  const rElbow    = poseLandmarks[RIGHT_ELBOW]
  const rWrist    = poseLandmarks[RIGHT_WRIST]
  const rIndex    = poseLandmarks[RIGHT_INDEX]

  // 镜像画面: MediaPipe LEFT = 人的左手，但摄像头画面是镜像的
  // 左手: x 方向取反
  const leftUpperAngle = segmentAngle(lShoulder, lElbow)
  const rightUpperAngle = segmentAngle(rShoulder, rElbow)

  // 前臂弯曲角
  const leftBend = bendAngle(lShoulder, lElbow, lWrist)
  const rightBend = bendAngle(rShoulder, rElbow, rWrist)

  // 手腕: wrist→index 相对前臂的偏转
  const leftWristAngle = segmentAngle(lWrist, lIndex) - segmentAngle(lElbow, lWrist)
  const rightWristAngle = segmentAngle(rWrist, rIndex) - segmentAngle(rElbow, rWrist)

  // 手指: wrist→index 的 y 方向
  const leftFingerDir = clamp((lWrist.y - lIndex.y) * 4, -1, 1)
  const rightFingerDir = clamp((rWrist.y - rIndex.y) * 4, -1, 1)

  const raw = {
    Param33: clamp(-leftUpperAngle, -1, 1),   // 左手整臂 (镜像取反)
    Param34: clamp(leftBend, -1, 1),           // 左手前臂弯曲
    Param35: clamp(-leftWristAngle, -1, 1),    // 左手腕
    Param36: clamp(leftFingerDir, -1, 1),      // 左手指
    Param37: clamp(rightUpperAngle, -1, 1),    // 右手整臂
    Param38: clamp(rightBend, -1, 1),          // 右手前臂弯曲
    Param39: clamp(rightWristAngle, -1, 1),    // 右手腕
    Param40: clamp(rightFingerDir, -1, 1),     // 右手指
  }

  // EMA 平滑 (alpha=0.25，比面部更重的平滑以抑制 pose 抖动)
  if (!prevHandParams) return raw

  const alpha = 0.25
  const deadZone = 0.05
  const smoothed = {}
  for (const key in raw) {
    if (prevHandParams[key] !== undefined) {
      const diff = raw[key] - prevHandParams[key]
      // 死区: 变化量小于阈值时不更新，消除静止抖动
      if (Math.abs(diff) < deadZone) {
        smoothed[key] = prevHandParams[key]
      } else {
        smoothed[key] = prevHandParams[key] + diff * alpha
      }
    } else {
      smoothed[key] = raw[key]
    }
  }
  return smoothed
}
