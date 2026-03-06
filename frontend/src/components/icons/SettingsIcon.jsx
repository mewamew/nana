export default function SettingsIcon({ size = 20, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="10" cy="10" r="3" />
      <path d="M10 1.5v2M10 16.5v2M1.5 10h2M16.5 10h2M3.99 3.99l1.41 1.41M14.6 14.6l1.41 1.41M16.01 3.99l-1.41 1.41M5.4 14.6l-1.41 1.41" />
    </svg>
  )
}
