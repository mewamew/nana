import { useState, useEffect } from 'react'
import { getTimeOfDay } from '../utils/timeOfDay'

const KEY_MAP = { '1': 'day', '2': 'evening', '3': 'night' }

export default function Background() {
  const [timeOfDay, setTimeOfDay] = useState(getTimeOfDay)
  const [override, setOverride] = useState(null)

  useEffect(() => {
    const timer = setInterval(() => {
      if (!override) setTimeOfDay(getTimeOfDay())
    }, 60000)
    return () => clearInterval(timer)
  }, [override])

  useEffect(() => {
    const handleKey = (e) => {
      if (e.target.tagName === 'INPUT') return
      if (KEY_MAP[e.key]) {
        setOverride(KEY_MAP[e.key])
        setTimeOfDay(KEY_MAP[e.key])
      } else if (e.key === '0') {
        setOverride(null)
        setTimeOfDay(getTimeOfDay())
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  return (
    <div className="scene-background">
      {['day', 'evening', 'night'].map(period => (
        <img
          key={period}
          src={`/backgrounds/room-${period}.png`}
          className="scene-bg-img"
          style={{ opacity: timeOfDay === period ? 1 : 0 }}
          alt=""
        />
      ))}
    </div>
  )
}
