export default function SpeakerOffIcon({ size = 20, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M3 7.5h2.5L10 4v12l-4.5-3.5H3z" fill="currentColor" fillOpacity="0.15" />
      <line x1="14" y1="7.5" x2="18" y2="12.5" />
      <line x1="18" y1="7.5" x2="14" y2="12.5" />
    </svg>
  )
}
