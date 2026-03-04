import { useLayoutEffect, useRef, forwardRef, useImperativeHandle } from 'react'
import * as PIXI from 'pixi.js'
import { Live2DModel } from 'pixi-live2d-display/cubism4'

// 将 PIXI 暴露到 window 上
window.PIXI = PIXI;

const Live2DDisplay = forwardRef((props, ref) => {
  const pixiContainerRef = useRef(null)
  const appRef = useRef(null)
  const modelRef = useRef(null)
  const activeExprRef = useRef(null)
  const resetTimerRef = useRef(null)
  const mouthValueRef = useRef(0)

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
        modelRef.current.internalModel.motionManager.settings.autoAddRandomMotion = enabled;
        console.log(`模型跟踪功能已${enabled ? '开启' : '关闭'}~`);
      }
    },
    setMouthOpenY: (value) => {
      mouthValueRef.current = value
    }
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
      backgroundColor: 0x000000,
      resizeTo: window,
      antialias: true,
    })
    appRef.current = app
    pixiContainerRef.current.appendChild(app.view)

    let isDestroyed = false

    ;(async function() {
      if (modelRef.current) return
      
      try {
        //const model = await Live2DModel.from('/models/Hiyori/Hiyori.model3.json')
        //const model = await Live2DModel.from('/models/Haru/Haru.model3.json')
        const model = await Live2DModel.from('/models/PinkFox/PinkFox.model3.json')

        // 如果组件已经被卸载，不要继续处理
        if (isDestroyed || !appRef.current) return
        
        console.log('Model loaded:', model)
        modelRef.current = model
        
        // 设置模型的初始跟踪状态
        model.internalModel.motionManager.settings.autoAddRandomMotion = true
        model.autoInteract = false  // 初始状态设置为不跟踪
        model.draggable = false
        
        const scale = Math.min(
          app.view.width / model.width * 1.8,
          app.view.height / model.height * 1.8
        )
        model.scale.set(scale)
        
        model.x = app.view.width / 2
        model.y = app.view.height * 0.9
        model.anchor.set(0.5, 0.5)

        app.stage.addChild(model)
        window.__pixiApp = app
        window.__live2dModel = model

        // 在模型 update 之后、渲染之前写入口型参数，防止被 motion 覆盖
        app.ticker.add(() => {
          if (mouthValueRef.current > 0 && modelRef.current) {
            modelRef.current.internalModel.coreModel
              .setParameterValueById('ParamMouthOpenY', mouthValueRef.current)
          }
        })

        model.on('hit', (hitAreas) => {
          console.log('Hit:', hitAreas)
          model.motion('TapBody')
        })
      } catch (error) {
        console.error('Error loading model:', error)
      }
    })()

    return () => {
      isDestroyed = true
      clearTimeout(resetTimerRef.current)
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