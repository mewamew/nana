const MOOD_MAP = {
  '咪咪眼': 'happy', '爱心': 'happy', '吐舌': 'happy',
  '脸红': 'shy',
  '眼泪': 'sad', '泪眼': 'sad',
  '生气': 'angry', '黑脸': 'angry', '生气瘪嘴': 'angry',
}

export default function MoodOverlay({ expression }) {
  const mood = MOOD_MAP[expression] || 'none'
  return <div className={`mood-overlay mood-${mood}`} />
}
