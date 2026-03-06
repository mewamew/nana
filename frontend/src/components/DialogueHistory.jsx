import { useEffect, useRef } from 'react'

export default function DialogueHistory({ history, charName, visible, onClose }) {
  const bottomRef = useRef(null)

  useEffect(() => {
    if (visible && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'instant' })
    }
  }, [visible])

  useEffect(() => {
    if (!visible) return
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [visible, onClose])

  if (!visible) return null

  return (
    <div className="dialogue-history" onClick={onClose}>
      <div className="dialogue-history-inner" onClick={e => e.stopPropagation()}>
        <button className="dialogue-history-close" onClick={onClose}>✕</button>
        <div className="dialogue-history-list">
          {history.map((msg, i) => (
            <div key={i} className={`dialogue-history-item ${msg.type}`}>
              {msg.type === 'assistant' && (
                <span className="dialogue-history-name">{charName || '???'}</span>
              )}
              {msg.type === 'user' && (
                <span className="dialogue-history-name you">你</span>
              )}
              <span className="dialogue-history-text">{msg.content}</span>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  )
}
