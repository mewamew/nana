import { useRef, useEffect, useState } from 'react'

const MOOD_MAP = {
  '咪咪眼': { icon: '😊', label: '开心', color: '#FFD700' },
  '爱心':   { icon: '💕', label: '喜欢', color: '#FF69B4' },
  '脸红':   { icon: '😳', label: '害羞', color: '#FF9999' },
  '吐舌':   { icon: '😜', label: '调皮', color: '#FFA500' },
  '嘟嘴':   { icon: '😤', label: '不满', color: '#FF8C00' },
  '生气':   { icon: '💢', label: '生气', color: '#FF4444' },
  '生气瘪嘴': { icon: '😠', label: '恼怒', color: '#FF6347' },
  '黑脸':   { icon: '😑', label: '无语', color: '#888' },
  '死鱼眼': { icon: '😒', label: '无聊', color: '#AAA' },
  '眼泪':   { icon: '😢', label: '难过', color: '#6495ED' },
  '泪眼':   { icon: '🥺', label: '委屈', color: '#87CEEB' },
  '钱钱眼': { icon: '🤑', label: '兴奋', color: '#32CD32' },
  'nn眼':   { icon: '😌', label: '平静', color: '#B0C4DE' },
}

const DEFAULT_MOOD = { icon: '😌', label: '平静', color: '#B0C4DE' }

export default function MoodIndicator({ expression }) {
  const prevRef = useRef(expression)
  const [changed, setChanged] = useState(false)

  const mood = MOOD_MAP[expression] || DEFAULT_MOOD

  useEffect(() => {
    if (expression !== prevRef.current) {
      prevRef.current = expression
      setChanged(true)
      const timer = setTimeout(() => setChanged(false), 400)
      return () => clearTimeout(timer)
    }
  }, [expression])

  return (
    <div className="mood-indicator" style={{ borderColor: `${mood.color}33` }}>
      <span className={`mood-icon${changed ? ' changed' : ''}`}>{mood.icon}</span>
      <span className="mood-label" style={{ color: mood.color }}>{mood.label}</span>
    </div>
  )
}
