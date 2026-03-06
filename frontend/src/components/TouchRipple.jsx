export default function TouchRipple({ x, y }) {
  return (
    <div
      className="touch-ripple"
      style={{ left: x, top: y }}
    />
  )
}
