// Builds a calendar file (.ics) with an "order by" reminder before each occasion,
// so the giver's own calendar app does the reminding. No email service needed.

export interface ReminderRow {
  title: string // person name or "Christmas"
  occasion: string
  date: Date
}

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
const esc = (s: string) => s.replace(/[\\,;]/g, (c) => `\\${c}`)

function addDays(d: Date, n: number) {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

function allDay(uid: string, day: Date, summary: string, description: string, alarm: boolean): string[] {
  return [
    'BEGIN:VEVENT',
    `UID:${uid}@giftwise`,
    `DTSTAMP:${ymd(new Date())}T000000Z`,
    `DTSTART;VALUE=DATE:${ymd(day)}`,
    `DTEND;VALUE=DATE:${ymd(addDays(day, 1))}`,
    `SUMMARY:${esc(summary)}`,
    `DESCRIPTION:${esc(description)}`,
    ...(alarm ? ['BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(summary)}`, 'TRIGGER:PT9H', 'END:VALARM'] : []),
    'END:VEVENT',
  ]
}

export function buildReminders(rows: ReminderRow[]): string {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Giftwise//Gift reminders//EN', 'CALSCALE:GREGORIAN']
  rows.forEach((r, i) => {
    const what = r.occasion === 'christmas' ? 'Christmas gifts' : `${r.title}'s ${r.occasion} gift`
    const orderBy = addDays(r.date, -3)
    if (orderBy > today) {
      lines.push(...allDay(`order-${i}-${ymd(r.date)}`, orderBy, `🎁 Order ${what} today`,
        `Last day for 2–3 day shipping. Open Giftwise to find something.`, true))
    }
    const custom = addDays(r.date, -10)
    if (custom > today) {
      lines.push(...allDay(`custom-${i}-${ymd(r.date)}`, custom, `✍️ Last day to order a custom gift (${what})`,
        `Handmade or personalized gifts need 7–14 days.`, false))
    }
  })
  lines.push('END:VCALENDAR')
  return lines.join('\r\n')
}

export function downloadReminders(rows: ReminderRow[]) {
  const blob = new Blob([buildReminders(rows)], { type: 'text/calendar' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'giftwise-reminders.ics'
  a.click()
  URL.revokeObjectURL(a.href)
}
