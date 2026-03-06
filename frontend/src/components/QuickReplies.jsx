export default function QuickReplies({ options, onSelect, visible }) {
  if (!visible || !options?.length) return null

  return (
    <div className="quick-replies">
      {options.map((opt, i) => (
        <button
          key={i}
          className="quick-reply-btn"
          style={{ animationDelay: `${i * 0.1}s` }}
          onClick={() => onSelect(opt)}
        >
          {opt}
        </button>
      ))}
    </div>
  )
}
