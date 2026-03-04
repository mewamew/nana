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
  const live2dRef = useRef(null)
  const abortRef = useRef(null)
  const generationRef = useRef(null)
  const pendingReplyRef = useRef('')
  const { playWithLipSync, warmUp } = useLipSync({
    onMouthValue: (value) => {
      if (live2dRef.current) live2dRef.current.setMouthOpenY(value)
    }
  })
  const [isTracking, setIsTracking] = useState(true)

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

  // 轮询主动消息
  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const data = await api.getProactive()
        if (data.message) {
          setMessages(prev => [...prev, { type: 'assistant', content: data.message }])
          if (data.expression && live2dRef.current) {
            live2dRef.current.showExpression(data.expression)
          }
        }
      } catch { /* 静默 */ }
    }, 30000)
    return () => clearInterval(timer)
  }, [])

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

    // 测试：鼠标左键按住时嘴张开，松开时闭嘴
    const handleMouseDown = (e) => {
      if (e.button === 0 && live2dRef.current) live2dRef.current.setMouthOpenY(0.8)
    }
    const handleMouseUp = (e) => {
      if (e.button === 0 && live2dRef.current) live2dRef.current.setMouthOpenY(0)
    }
    window.addEventListener('mousedown', handleMouseDown)
    window.addEventListener('mouseup', handleMouseUp)

    return () => {
      window.removeEventListener('keydown', handleKeyPress)
      window.removeEventListener('mousedown', handleMouseDown)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [])

  const handleSendMessage = (directMessage) => {
    const text = directMessage ?? input
    if (!text.trim()) return
    warmUp() // 在用户手势上下文中预热 AudioContext
    if (!directMessage) setInput('')

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

    api.chatStream(text, {
      onGenerationId: (id) => {
        generationRef.current = id
      },
      onText: (chunk) => {
        rawAccumulator += chunk
        const replyText = extractReply(rawAccumulator)
        if (replyText !== null) pendingReplyRef.current = replyText
      },
      onExpression: (expression) => {
        if (live2dRef.current) live2dRef.current.showExpression(expression)
      },
      onAudio: (audioBase64) => {
        if (pendingReplyRef.current) {
          const text = pendingReplyRef.current
          setMessages(prev => {
            const last = prev[prev.length - 1]
            if (last?.type === 'assistant') {
              return [...prev.slice(0, -1), { type: 'assistant', content: text }]
            }
            return [...prev, { type: 'assistant', content: text }]
          })
        }
        playWithLipSync(audioBase64)
      },
      onDone: () => {
        if (rawAccumulator) {
          setMessages(prev => {
            const last = prev[prev.length - 1]
            if (last?.type !== 'assistant') {
              const fallback = extractReply(rawAccumulator) ?? rawAccumulator
              return [...prev, { type: 'assistant', content: fallback }]
            }
            return prev
          })
        }
        abortRef.current = null
        setLoading(false)
      },
      onError: (msg) => {
        console.error('Chat error:', msg)
        abortRef.current = null
        setLoading(false)
      },
    }, { signal: controller.signal })
  }

  const lastAssistantMessage = messages.filter(m => m.type === 'assistant').at(-1)

  return (
    <div className="app">
      {/* 右上角配置按钮 */}
      <button className="config-btn" onClick={() => setShowConfig(true)} title="设置">⚙</button>

      {/* 配置面板 */}
      {showConfig && <ConfigPanel onClose={() => setShowConfig(false)} />}

      {/* Live2D 主区域 */}
      <div className="live2d-main">
        <Live2DDisplay ref={live2dRef} />
        <div className="subtitles">
          {loading && !lastAssistantMessage ? (
            <div className="subtitle-text loading">...</div>
          ) : lastAssistantMessage && (
            <div className="subtitle-text">
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
        <input
          className="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
          placeholder="输入消息..."
          autoFocus
          disabled={loading}
        />
      </div>
    </div>
  )
}

export default App
