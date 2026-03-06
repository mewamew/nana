export default function SpeakerIcon({ size = 20, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M3 7.5h2.5L10 4v12l-4.5-3.5H3z" fill="currentColor" fillOpacity="0.15" />
      <path d="M13 7.5a3.5 3.5 0 0 1 0 5" />
      <path d="M15 5.5a6.5 6.5 0 0 1 0 9" />
    </svg>
  )
}
