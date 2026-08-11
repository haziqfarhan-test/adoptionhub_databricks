export const CHART_COLORS = ['#0A84FF', '#30D158', '#FF9F0A', '#FF453A', '#BF5AF2', '#5AC8FA']

export function fmtValue(val, label = '') {
  if (val === null || val === undefined) return '—'
  if (typeof val !== 'number') return String(val)
  const isMoney = /amount|price|revenue|value|total|cost|fee/i.test(label)
  const abs = Math.abs(val)
  const pfx = isMoney ? '$' : ''
  if (abs >= 1e9) return `${pfx}${(val / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${pfx}${(val / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `${pfx}${(val / 1e3).toFixed(1)}K`
  if (Number.isInteger(val)) return `${pfx}${val.toLocaleString()}`
  return `${pfx}${val.toFixed(2)}`
}

export function fmtCell(val) {
  if (val === null || val === undefined) return '—'
  if (typeof val === 'number') return Number.isInteger(val) ? val.toLocaleString() : val.toFixed(2)
  if (typeof val === 'string' && val.length > 10 && /^\d{4}-\d{2}-\d{2}T/.test(val)) return val.slice(0, 10)
  return String(val)
}

export function fmtAxisTick(v) {
  if (typeof v === 'string' && v.length > 10 && /^\d{4}-\d{2}-\d{2}T/.test(v)) return v.slice(0, 10)
  if (typeof v === 'string' && v.length > 14) return v.slice(0, 12) + '…'
  return v
}
