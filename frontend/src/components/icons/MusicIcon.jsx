export default function MusicIcon({ size = 20, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="5" cy="14" r="2.5" />
      <circle cx="15" cy="12" r="2.5" />
      <line x1="7.5" y1="14" x2="7.5" y2="3" />
      <line x1="17.5" y1="12" x2="17.5" y2="3" />
      <line x1="7.5" y1="3" x2="17.5" y2="3" />
    </svg>
  )
}
