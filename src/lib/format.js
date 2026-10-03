// Pure date / duration helpers shared by the UI.

export const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('vi-VN') : '')
export const ymd = (d) => new Date(d).toLocaleDateString('sv') // YYYY-MM-DD local
export const ddmm = (d) => {
  const x = new Date(d)
  return `${String(x.getDate()).padStart(2, '0')}/${String(x.getMonth() + 1).padStart(2, '0')}`
}
export const hrs = (s) => (s ? `${+(s / 3600).toFixed(1)}h` : '-')
export const sum = (arr, f) => arr.reduce((a, x) => a + (f(x) || 0), 0)

export const dayOf = (d) => {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}
export const mondayOf = (d) => {
  const x = dayOf(d)
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7))
  return x
}
export const isWeekend = (d) => [0, 6].includes(new Date(d).getDay())

// "8h", "1.5", "1,5h", "30m" -> seconds (NaN if unreadable)
export const parseDuration = (v) => {
  const m = String(v).trim().toLowerCase().match(/^(\d+(?:[.,]\d+)?)\s*(h|m)?$/)
  return m ? Math.round(parseFloat(m[1].replace(',', '.')) * (m[2] === 'm' ? 60 : 3600)) : NaN
}

// Jira wants e.g. 2026-10-02T09:00:00.000+0700
export const tzOffset = () => {
  const o = -new Date().getTimezoneOffset()
  return `${o < 0 ? '-' : '+'}${String(Math.floor(Math.abs(o) / 60)).padStart(2, '0')}${String(Math.abs(o) % 60).padStart(2, '0')}`
}

export const host = (url) => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}
