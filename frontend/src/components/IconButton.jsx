export default function IconButton({ icon: Icon, label, active, className = '', onClick, ...props }) {
  return (
    <button
      className={`icon-btn${active ? ' active' : ''}${className ? ' ' + className : ''}`}
      onClick={onClick}
      title={label}
      {...props}
    >
      <Icon size={20} />
    </button>
  )
}
