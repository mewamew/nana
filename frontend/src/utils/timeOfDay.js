export function getTimeOfDay() {
  const hour = new Date().getHours()
  if (hour >= 6 && hour < 17) return 'day'
  if (hour >= 17 && hour < 20) return 'evening'
  return 'night'
}
