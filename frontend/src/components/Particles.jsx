const TYPE_MAP = { day: 'sakura', evening: 'sparkle', night: 'firefly' }

function randomStyle(i) {
  const seed = i * 137.5
  return {
    left: `${(seed % 100).toFixed(1)}%`,
    top: `${((seed * 0.7) % 100).toFixed(1)}%`,
    animationDuration: `${6 + (i % 5) * 2}s`,
    animationDelay: `${(i * 0.5) % 8}s`,
  }
}

export default function Particles({ timeOfDay }) {
  const type = TYPE_MAP[timeOfDay] || 'sakura'
  return (
    <div className={`particles particles-${type}`}>
      {Array.from({ length: 20 }, (_, i) => (
        <span key={i} className="particle" style={randomStyle(i)} />
      ))}
    </div>
  )
}
