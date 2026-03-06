import { useLayoutEffect, useRef, forwardRef, useImperativeHandle } from 'react'
import * as PIXI from 'pixi.js'
import { Live2DModel } from 'pixi-live2d-display/cubism4'

// 将 PIXI 暴露到 window 上
window.PIXI = PIXI;

const Live2DDisplay = forwardRef(({ onTouch }, ref) => {
  const pixiContainerRef = useRef(null)
  const appRef = useRef(null)
  const modelRef = useRef(null)
  const activeExprRef = useRef(null)
  const resetTimerRef = useRef(null)
  const mouthValueRef = useRef(0)
  const trackingParamsRef = useRef(null)
  const baseScaleRef = useRef(null)
  const baseYRef = useRef(null)
  const zoomRafRef = useRef(null)
  // 表情映射对象，使用中文作为 key
  const EXPRESSIONS = {
    '吐舌': 'key2',
    '黑脸': 'key3',
    '眼泪': 'key4',
    '脸红': 'key5',
    'nn眼': 'key6',
    '生气瘪嘴': 'key7',
    '死鱼眼': 'key8',
    '生气': 'key9',
    '咪咪眼': 'key10',
    '嘟嘴': 'key11',
    '钱钱眼': 'key12',
    '爱心': 'key16',
    '泪眼': 'key17'
  }

  function animateZoom(model, fromScale, toScale, fromY, toY, duration, ease) {
    if (zoomRafRef.current) cancelAnimationFrame(zoomRafRef.current)
    const start = performance.now()
    function frame(now) {
      const t = Math.min((now - start) / duration, 1)
      const e = ease(t)
      model.scale.set(fromScale + (toScale - fromScale) * e)
      model.y = fromY + (toY - fromY) * e
      if (t < 1) zoomRafRef.current = requestAnimationFrame(frame)
    }
    zoomRafRef.current = requestAnimationFrame(frame)
  }
  const easeOut = t => 1 - Math.pow(1 - t, 3)
  const easeInOut = t => t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3)/2

  // 暴露方法给父组件
  useImperativeHandle(ref, () => ({
    showExpression: (expression) => {
      if (!modelRef.current) return
      const expressionId = EXPRESSIONS[expression]
      if (!expressionId) {
        console.warn(`未知的表情: ${expression}`)
        return
      }

      const coreModel = modelRef.current.internalModel.coreModel

      // 先复位旧表情
      if (activeExprRef.current && activeExprRef.current !== expressionId) {
        coreModel.setParameterValueById(activeExprRef.current, 0)
      }

      coreModel.setParameterValueById(expressionId, 1)
      activeExprRef.current = expressionId

      // 5 秒后自动复位
      clearTimeout(resetTimerRef.current)
      resetTimerRef.current = setTimeout(() => {
        if (modelRef.current && activeExprRef.current === expressionId) {
          coreModel.setParameterValueById(expressionId, 0)
          activeExprRef.current = null
        }
      }, 5000)
    },
    
    // 新增：设置跟踪功能
    setTracking: (enabled) => {
      if (modelRef.current) {
        modelRef.current.autoInteract = enabled;
        const state = modelRef.current.internalModel.motionManager.state;
        state.shouldRequestIdleMotion = enabled
          ? state.constructor.prototype.shouldRequestIdleMotion.bind(state)
          : () => false;
        console.log(`模型跟踪功能已${enabled ? '开启' : '关闭'}~`);
      }
    },
    setParameters: (paramMap) => {
      trackingParamsRef.current = paramMap
    },
    setMouthOpenY: (value) => {
      mouthValueRef.current = value
    },
    zoomIn: (duration = 800) => {
      if (!modelRef.current || !baseScaleRef.current) return
      const model = modelRef.current
      const app = appRef.current
      const baseScale = baseScaleRef.current
      const newScale = baseScale * 1.15

      // 脸部在模型中心上方约 30% 原始高度处（含耳朵的头顶到脚底）
      const FACE_RATIO = 0.3
      const origHeight = model.height / model.scale.x  // 未缩放的高度
      const baseFaceY = baseYRef.current - origHeight * baseScale * FACE_RATIO
      // 推镜时脸部轻微上移 1.5% 屏高，增加临场感
      const targetFaceY = baseFaceY - app.view.height * 0.015
      // 放大后模型中心 Y = 脸部目标 Y + 放大后的脸部偏移量
      const newModelY = targetFaceY + origHeight * newScale * FACE_RATIO

      animateZoom(model, model.scale.x, newScale, model.y, newModelY, duration, easeOut)
    },
    zoomOut: (duration = 1000) => {
      if (!modelRef.current || !baseScaleRef.current) return
      const model = modelRef.current
      animateZoom(
        model,
        model.scale.x, baseScaleRef.current,
        model.y, baseYRef.current,
        duration, easeInOut
      )
    },
  }))

  useLayoutEffect(() => {
    // 确保清理之前的内容
    if (appRef.current) {
      appRef.current.destroy(true)
      appRef.current = null
    }
    if (pixiContainerRef.current) {
      while (pixiContainerRef.current.firstChild) {
        pixiContainerRef.current.removeChild(pixiContainerRef.current.firstChild)
      }
    }

    if (!pixiContainerRef.current) return

    const app = new PIXI.Application({
      width: window.innerWidth,
      height: window.innerHeight,
      backgroundAlpha: 0,
      resizeTo: window,
      antialias: true,
    })
    appRef.current = app
    pixiContainerRef.current.appendChild(app.view)

    let isDestroyed = false

    ;(async function() {
      if (modelRef.current) return
      
      try {
        const model = await Live2DModel.from('/models/PinkFox/PinkFox.model3.json')

        // 如果组件已经被卸载，不要继续处理
        if (isDestroyed || !appRef.current) return
        
        console.log('Model loaded:', model)
        modelRef.current = model
        
        // 设置模型的初始跟踪状态
        const mm = model.internalModel.motionManager
        mm.stopAllMotions()
        mm.state.shouldRequestIdleMotion = () => false  // 彻底阻止 idle 自动触发
        model.autoInteract = false
        model.draggable = false

        const scale = Math.min(
          app.view.width / model.width * 1.8,
          app.view.height / model.height * 1.8
        )
        model.scale.set(scale)
        baseScaleRef.current = scale
        baseYRef.current = app.view.height * 0.9

        model.x = app.view.width / 2
        model.y = app.view.height * 0.9
        model.anchor.set(0.5, 0.5)

        app.stage.addChild(model)

        // 点击触摸检测
        app.view.addEventListener('click', (e) => {
          if (!modelRef.current) return
          const model = modelRef.current
          const bounds = model.getBounds()

          const x = e.offsetX, y = e.offsetY
          // 不在模型范围内 → 忽略
          if (x < bounds.x || x > bounds.x + bounds.width ||
              y < bounds.y || y > bounds.y + bounds.height) return

          const relY = (y - bounds.y) / bounds.height
          let area = 'body'
          if (relY < 0.25) area = 'head'
          else if (relY < 0.45) area = 'face'

          // 播放动作
          model.motion('')
          // 回调父组件
          onTouch?.(area, { x: e.clientX, y: e.clientY })
        })

        window.__pixiApp = app
        window.__live2dModel = model

        // 在模型 update 之后、渲染之前写入参数，防止被 idle motion 覆盖
        app.ticker.add(() => {
          if (!modelRef.current) return
          const coreModel = modelRef.current.internalModel.coreModel

          // 追踪参数写入
          const tp = trackingParamsRef.current
          if (tp) {
            for (const [id, value] of Object.entries(tp)) {
              coreModel.setParameterValueById(id, value)
            }
          }

          // lip sync 口型
          if (mouthValueRef.current > 0) {
            coreModel.setParameterValueById('ParamMouthOpenY', mouthValueRef.current)
          }

        })
      } catch (error) {
        console.error('Error loading model:', error)
      }
    })()

    return () => {
      isDestroyed = true
      clearTimeout(resetTimerRef.current)
      if (zoomRafRef.current) cancelAnimationFrame(zoomRafRef.current)
      if (modelRef.current) {
        modelRef.current.destroy()
        modelRef.current = null
      }
      if (appRef.current) {
        appRef.current.destroy(true)
        appRef.current = null
      }
    }
  }, [])

  return <div ref={pixiContainerRef} className="live2d-container"></div>
})

export default Live2DDisplay 