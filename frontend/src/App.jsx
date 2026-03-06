import { useState, useRef, useEffect } from 'react'
import Live2DDisplay from './components/Live2DModel'
import ConfigPanel from './components/ConfigPanel'
import VoiceInput from './components/VoiceInput'
import { api } from './api/client'
import { useLipSync } from './hooks/useLipSync'
import './App.css'

function App() {
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(false)
  const [showConfig, setShowConfig] = useState(false)
  const [subtitleVisible, setSubtitleVisible] = useState(false)
  const [sentStatus, setSentStatus] = useState(null) // null | 'pending' | 'received'
  const [initialized, setInitialized] = useState(null) // null=加载中, false=未初始化, true=已初始化
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

  function showSubtitle() {
    setSubtitleVisible(true)
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    hideTimerRef.current = setTimeout(() => {
      setSubtitleVisible(false)
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

  // 启动时检测初始化状态
  useEffect(() => {
    api.getStatus().then(status => {
      setInitialized(status.initialized)
    }).catch(() => setInitialized(false))
  }, [])

  // 启动时从后端加载历史消息
  useEffect(() => {
    api.getHistory().then((history) => {
      if (history && history.length > 0) {
        setMessages(history)
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
          setMessages(prev => [...prev, { type: 'assistant', content: data.message, source: 'heartbeat' }])
          if (data.expression && live2dRef.current) {
            live2dRef.current.showExpression(data.expression)
          }
          showSubtitle()
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

  const handleSendMessage = (directMessage) => {
    const text = directMessage ?? input
    if (!text.trim()) return
    warmUp() // 在用户手势上下文中预热 AudioContext
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
    setMessages(prev => [...prev, { type: 'user', content: text }])

    // 后端 text 事件携带的是原始 LLM JSON 片段，需要增量提取 reply 字段
    let rawAccumulator = ''
    pendingReplyRef.current = ''

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
        if (replyText !== null) pendingReplyRef.current = replyText
      },
      onExpression: (expression) => {
        if (live2dRef.current) live2dRef.current.showExpression(expression)
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
          showSubtitle()
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
      onInitComplete: (persona) => {
        setInitialized(true)
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
          showSubtitle()
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
      },
    }, { signal: controller.signal })
  }

  const lastAssistantMessage = messages.filter(m => m.type === 'assistant').at(-1)

  return (
    <div className="app">
      {/* 右上角配置按钮 */}
      {initialized && <button className="config-btn" onClick={() => setShowConfig(true)} title="设置">⚙</button>}

      {/* 配置面板 */}
      {showConfig && <ConfigPanel onClose={() => setShowConfig(false)} />}

      {/* Live2D 主区域 */}
      <div className="live2d-main">
        <Live2DDisplay ref={live2dRef} />
        <div className="subtitles">
          {loading && !lastAssistantMessage ? (
            <div className="subtitle-text loading">...</div>
          ) : lastAssistantMessage && (
            <div className={`subtitle-text ${subtitleVisible ? 'entering' : 'leaving'}`}>
              {lastAssistantMessage.content}
            </div>
          )}
        </div>
      </div>

      {/* 输入区域 */}
      <div className="chat-input-container">
        <VoiceInput
          onTranscribed={(text) => setInput(prev => prev + text)}
          onAutoSend={(text) => handleSendMessage(text)}
        />
        <div className="input-wrapper">
          <input
            className={`chat-input${sentStatus ? ` sent-${sentStatus}` : ''}`}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
            placeholder={initialized ? "输入消息..." : "说点什么吧..."}
            autoFocus
            disabled={loading || sentStatus !== null}
          />
          {sentStatus === 'pending' && <div className="input-spinner" />}
        </div>
        <button
          className={`tts-toggle${ttsEnabled ? '' : ' off'}`}
          onClick={toggleTts}
          title={ttsEnabled ? 'TTS 开启' : 'TTS 关闭'}
        >
          {ttsEnabled ? '🔊' : '🔇'}
        </button>
      </div>
    </div>
  )
}

export default App
