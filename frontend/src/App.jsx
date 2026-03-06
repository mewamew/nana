import { useState, useRef, useEffect, useCallback } from 'react'
import Live2DDisplay from './components/Live2DModel'
import ConfigPanel from './components/ConfigPanel'
import VoiceInput from './components/VoiceInput'
import Background from './components/Background'
import Particles from './components/Particles'
import MoodOverlay from './components/MoodOverlay'
import MoodIndicator from './components/MoodIndicator'
import QuickReplies from './components/QuickReplies'
import TouchRipple from './components/TouchRipple'
import DialogueBox from './components/DialogueBox'
import DialogueHistory from './components/DialogueHistory'
import IconButton from './components/IconButton'
import { SettingsIcon, HistoryIcon, MusicIcon, SpeakerIcon, SpeakerOffIcon } from './components/icons'
import { api } from './api/client'
import { useLipSync } from './hooks/useLipSync'
import { getTimeOfDay } from './utils/timeOfDay'
import audioManager from './audio/AudioManager'
import './App.css'

function expressionToRimColor(expression) {
  switch (expression) {
    case 'shy':   return 'rgba(255, 130, 180, 0.2)'
    case 'angry': return 'rgba(220, 60, 60, 0.18)'
    case 'sad':   return 'rgba(100, 140, 220, 0.18)'
    case 'happy': return 'rgba(255, 220, 100, 0.18)'
    default:      return 'rgba(47, 164, 231, 0.15)'
  }
}

function App() {
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(false)
  const [showConfig, setShowConfig] = useState(false)
  const [dialogueVisible, setDialogueVisible] = useState(false)
  const [dialogueText, setDialogueText] = useState('')
  const [isTypewriter, setIsTypewriter] = useState(false)
  const [dialogueHistory, setDialogueHistory] = useState([])
  const [showHistory, setShowHistory] = useState(false)
  const [charName, setCharName] = useState('')
  const [sentStatus, setSentStatus] = useState(null) // null | 'pending' | 'received'
  const [initialized, setInitialized] = useState(null) // null=加载中, false=未初始化, true=已初始化
  const [timeOfDay, setTimeOfDay] = useState(getTimeOfDay)
  const [currentExpression, setCurrentExpression] = useState(null)
  const [quickReplies, setQuickReplies] = useState([])
  const [touchCooldown, setTouchCooldown] = useState(false)
  const [ripple, setRipple] = useState(null)
  const [bgmMuted, setBgmMuted] = useState(() => JSON.parse(localStorage.getItem('bgmMuted') || 'false'))
  const [ttsEnabled, setTtsEnabled] = useState(() => {
    const saved = localStorage.getItem('ttsEnabled')
    return saved !== null ? JSON.parse(saved) : true
  })
  const live2dRef = useRef(null)
  const abortRef = useRef(null)
  const generationRef = useRef(null)
  const pendingReplyRef = useRef('')
  const hasExpressionRef = useRef(false)
  const hideTimerRef = useRef(null)
  const hasPendingInputRef = useRef(false)
  const ttsEnabledRef = useRef(ttsEnabled)

  const toggleTts = () => {
    setTtsEnabled(prev => {
      const next = !prev
      ttsEnabledRef.current = next
      localStorage.setItem('ttsEnabled', JSON.stringify(next))
      return next
    })
  }

  function showDialogue(text, typewriter = false) {
    setDialogueText(text)
    setIsTypewriter(typewriter)
    setDialogueVisible(true)
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    hideTimerRef.current = setTimeout(() => {
      setDialogueVisible(false)
    }, 5000)
  }

  const { playWithLipSync, warmUp } = useLipSync({
    onMouthValue: (value) => {
      if (live2dRef.current) live2dRef.current.setMouthOpenY(value)
    },
    onAudioEnd: () => {
      live2dRef.current?.zoomOut()
    }
  })
  const [isTracking, setIsTracking] = useState(true)

  // 启动时检测初始化状态 + 加载 persona
  useEffect(() => {
    api.getStatus().then(status => {
      setInitialized(status.initialized)
      if (status.persona?.char_name) {
        setCharName(status.persona.char_name)
      }
    }).catch(() => setInitialized(false))
  }, [])

  // 启动时从后端加载历史消息
  useEffect(() => {
    api.getHistory().then((history) => {
      if (history && history.length > 0) {
        setMessages(history)
        setDialogueHistory(history.filter(m => m.content))
      }
    }).catch((err) => {
      console.error('Failed to load history:', err)
    })
  }, [])

  // 轮询主动消息（仅在已初始化时启动）
  useEffect(() => {
    if (!initialized) return
    const timer = setInterval(async () => {
      try {
        const data = await api.getProactive()
        if (data.message) {
          const msg = { type: 'assistant', content: data.message, source: 'heartbeat' }
          setMessages(prev => [...prev, msg])
          setDialogueHistory(prev => [...prev, msg])
          if (data.expression && live2dRef.current) {
            live2dRef.current.showExpression(data.expression)
            setCurrentExpression(data.expression)
          }
          showDialogue(data.message, true) // heartbeat 用打字机效果
          if (data.audio && ttsEnabledRef.current) {
            live2dRef.current?.zoomIn()
            playWithLipSync(data.audio)
          }
        }
      } catch { /* 静默 */ }
    }, 30000)
    return () => clearInterval(timer)
  }, [initialized])

  useEffect(() => {
    const handleKeyPress = (e) => {
      if (e.code === 'Space' && e.target.tagName !== 'INPUT') {
        e.preventDefault()
        setIsTracking(prev => {
          const next = !prev
          if (live2dRef.current) live2dRef.current.setTracking(next)
          return next
        })
      }
    }
    window.addEventListener('keydown', handleKeyPress)

    return () => {
      window.removeEventListener('keydown', handleKeyPress)
    }
  }, [])

  // timeOfDay 定时刷新
  useEffect(() => {
    const timer = setInterval(() => setTimeOfDay(getTimeOfDay()), 60000)
    return () => clearInterval(timer)
  }, [])

  // 同步 timeOfDay 到 audioManager
  useEffect(() => {
    audioManager.setTimeOfDay(timeOfDay)
  }, [timeOfDay])

  // 情绪叠层自动消退
  useEffect(() => {
    if (!currentExpression) return
    const timer = setTimeout(() => setCurrentExpression(null), 4000)
    return () => clearTimeout(timer)
  }, [currentExpression])

  // 滚轮上滑打开历史
  useEffect(() => {
    const handleWheel = (e) => {
      if (e.deltaY < -50 && !showHistory) {
        setShowHistory(true)
      }
    }
    window.addEventListener('wheel', handleWheel)
    return () => window.removeEventListener('wheel', handleWheel)
  }, [showHistory])

  const closeHistory = useCallback(() => setShowHistory(false), [])

  const TOUCH_MESSAGES = {
    head: '[用户摸了摸你的头]',
    face: '[用户捏了捏你的脸]',
    body: '[用户戳了戳你]',
  }

  const handleTouch = (area, pos) => {
    setRipple({ x: pos.x, y: pos.y })
    setTimeout(() => setRipple(null), 600)

    if (touchCooldown || loading) return
    setTouchCooldown(true)
    setTimeout(() => setTouchCooldown(false), 3000)
    handleSendMessage(TOUCH_MESSAGES[area])
  }

  const handleSendMessage = (directMessage) => {
    const text = directMessage ?? input
    if (!text.trim()) return
    setQuickReplies([])
    warmUp() // 在用户手势上下文中预热 AudioContext
    audioManager.tryAutoPlay()
    if (!directMessage) {
      // 不立刻清空，等回复到达后淡出消失
      setSentStatus('pending')
      hasPendingInputRef.current = true
    }

    // 取消上一个正在进行的请求
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)
    const userMsg = { type: 'user', content: text }
    setMessages(prev => [...prev, userMsg])
    setDialogueHistory(prev => [...prev, userMsg])

    // 后端 text 事件携带的是原始 LLM JSON 片段，需要增量提取 reply 字段
    let rawAccumulator = ''
    pendingReplyRef.current = ''

    // 流式显示：先显示空对话框
    setDialogueText('')
    setIsTypewriter(false)
    setDialogueVisible(true)
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)

    function extractReply(raw) {
      try {
        const data = JSON.parse(raw)
        return data.reply ?? null
      } catch {
        const match = raw.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/)
        return match ? match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"') : null
      }
    }

    api.chatStream(text, ttsEnabledRef.current, {
      onGenerationId: (id) => {
        generationRef.current = id
        setMessages(prev => [...prev, { type: 'assistant', content: '', generationId: id }])
      },
      onText: (chunk) => {
        rawAccumulator += chunk
        const replyText = extractReply(rawAccumulator)
        if (replyText !== null) {
          pendingReplyRef.current = replyText
          // 流式更新对话框文本
          setDialogueText(replyText)
        }
      },
      onExpression: (expression) => {
        if (live2dRef.current) live2dRef.current.showExpression(expression)
        setCurrentExpression(expression)
        hasExpressionRef.current = true
      },
      onAudio: (audioBase64) => {
        if (hasPendingInputRef.current) {
          hasPendingInputRef.current = false
          setSentStatus('received')
          setTimeout(() => { setInput(''); setSentStatus(null) }, 350)
        }
        if (pendingReplyRef.current) {
          const text = pendingReplyRef.current
          const gid = generationRef.current
          setMessages(prev => prev.map(m =>
            m.generationId === gid ? { ...m, content: text } : m
          ))
          // 重置自动隐藏计时器
          if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
          hideTimerRef.current = setTimeout(() => {
            setDialogueVisible(false)
          }, 5000)
        }
        // 只在有情绪表情时才推镜
        if (hasExpressionRef.current) {
          live2dRef.current?.zoomIn()
          hasExpressionRef.current = false
        }
        if (ttsEnabledRef.current) {
          playWithLipSync(audioBase64)
        }
      },
      onQuickReplies: (replies) => setQuickReplies(replies),
      onInitComplete: (persona) => {
        setInitialized(true)
        if (persona?.char_name) {
          setCharName(persona.char_name)
        }
      },
      onDone: () => {
        if (rawAccumulator) {
          const finalText = pendingReplyRef.current || extractReply(rawAccumulator) || rawAccumulator
          const gid = generationRef.current
          setMessages(prev => {
            const has = prev.some(m => m.generationId === gid)
            if (has) {
              return prev.map(m => m.generationId === gid ? { ...m, content: finalText } : m)
            }
            return [...prev, { type: 'assistant', content: finalText }]
          })
          setDialogueText(finalText)
          setDialogueHistory(prev => [...prev, { type: 'assistant', content: finalText }])
          // 重置自动隐藏计时器
          if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
          hideTimerRef.current = setTimeout(() => {
            setDialogueVisible(false)
          }, 5000)
        }
        // 无音频时的兜底：回复到达后清空输入框
        if (hasPendingInputRef.current) {
          hasPendingInputRef.current = false
          setSentStatus('received')
          setTimeout(() => { setInput(''); setSentStatus(null) }, 350)
        }
        abortRef.current = null
        setLoading(false)
      },
      onError: (msg) => {
        console.error('Chat error:', msg)
        hasPendingInputRef.current = false
        setInput('')
        setSentStatus(null)
        abortRef.current = null
        setLoading(false)
        setDialogueVisible(false)
      },
    }, { signal: controller.signal })
  }

  return (
    <div className="app" style={{ '--rim-color': expressionToRimColor(currentExpression) }}>
      {/* 场景背景 */}
      <Background />
      <Particles timeOfDay={timeOfDay} />
      <div className="vignette" />
      <MoodOverlay expression={currentExpression} />
      <MoodIndicator expression={currentExpression} />

      {/* 右上角按钮组 */}
      {initialized && (
        <>
          <IconButton
            icon={ttsEnabled ? SpeakerIcon : SpeakerOffIcon}
            className={`btn-pos-tts${ttsEnabled ? '' : ' off'}`}
            active={ttsEnabled}
            label={ttsEnabled ? 'TTS 开启' : 'TTS 关闭'}
            onClick={toggleTts}
          />
          <IconButton
            icon={MusicIcon}
            className={`btn-pos-bgm${bgmMuted ? ' off' : ''}`}
            active={!bgmMuted}
            label={bgmMuted ? 'BGM 关闭' : 'BGM 开启'}
            onClick={() => {
              audioManager.tryAutoPlay()
              const muted = audioManager.toggle()
              setBgmMuted(muted)
            }}
          />
          <IconButton
            icon={HistoryIcon}
            className="btn-pos-history"
            label="对话历史"
            onClick={() => setShowHistory(true)}
          />
          <IconButton
            icon={SettingsIcon}
            className="btn-pos-config"
            label="设置"
            onClick={() => setShowConfig(true)}
          />
        </>
      )}

      {/* 配置面板 */}
      {showConfig && <ConfigPanel onClose={() => setShowConfig(false)} />}

      {/* Live2D 主区域 */}
      <div className="live2d-main">
        <Live2DDisplay ref={live2dRef} onTouch={handleTouch} />
      </div>

      {/* 快捷回复 */}
      <QuickReplies
        options={quickReplies}
        visible={quickReplies.length > 0}
        onSelect={(opt) => { setQuickReplies([]); handleSendMessage(opt) }}
      />

      {/* 底部对话面板（台词 + 输入） */}
      <DialogueBox
        text={dialogueText}
        textVisible={dialogueVisible}
        isTypewriter={isTypewriter}
      >
        <VoiceInput
          onTranscribed={(text) => setInput(prev => prev + text)}
          onAutoSend={(text) => handleSendMessage(text)}
        />
        <div className="input-wrapper">
          <input
            className={`chat-input${sentStatus ? ` sent-${sentStatus}` : ''}`}
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              if (quickReplies.length) setQuickReplies([])
            }}
            onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
            placeholder={initialized ? "输入消息..." : "说点什么吧..."}
            autoFocus
            disabled={loading || sentStatus !== null}
          />
          {sentStatus === 'pending' && <div className="input-spinner" />}
        </div>
      </DialogueBox>

      {/* 对话历史 */}
      {/* 触摸涟漪 */}
      {ripple && <TouchRipple x={ripple.x} y={ripple.y} />}

      <DialogueHistory
        history={dialogueHistory}
        charName={charName}
        visible={showHistory}
        onClose={closeHistory}
      />
    </div>
  )
}

export default App
