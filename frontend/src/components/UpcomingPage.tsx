import { useRef, useState } from 'react'
import { importPeople, loadDemo, parseCalendar, setDate, type Occasion, type ParsedPerson, type Person } from '../api'
import { formatDate } from '../format'
import { downloadReminders } from '../reminders'
import Avatar from './Avatar'
import HolidayPlanner from './HolidayPlanner'

export interface FinderPreset {
  personId: string
  occasion: Occasion
  date: string
  budget?: number
}

interface Props {
  people: Person[]
  setPeople: (p: Person[]) => void
  onFind: (preset: FinderPreset) => void
  onImportNotes: () => void
}

const DAY = 86400000
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function startOfToday() {
  const t = new Date()
  t.setHours(0, 0, 0, 0)
  return t
}
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const nice = (d: Date) => `${MONTHS[d.getMonth()]} ${d.getDate()}`
function addDays(d: Date, n: number) {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

interface Row {
  key: string
  person?: Person
  title: string
  occasion: Occasion
  date: Date
  days: number
  approx: boolean
  ideas: number
  count?: number
}

function nextOccurrence(month: number, day: number | null, today: Date) {
  let d = new Date(today.getFullYear(), month - 1, day ?? 1)
  if (d < today) d = new Date(today.getFullYear() + 1, month - 1, day ?? 1)
  return d
}

function buildRows(people: Person[]): Row[] {
  const today = startOfToday()
  const rows: Row[] = []
  for (const p of people) {
    for (const d of p.dates) {
      if (!d.month) continue
      const date = nextOccurrence(d.month, d.day, today)
      rows.push({
        key: `${p.id}-${d.occasion}`,
        person: p,
        title: p.name,
        occasion: d.occasion,
        date,
        days: Math.round((date.getTime() - today.getTime()) / DAY),
        approx: !d.day,
        ideas: p.ideas.filter((i) => i.status === 'idea').length,
      })
    }
  }
  if (people.length) {
    const xmas = nextOccurrence(12, 25, today)
    rows.push({
      key: 'christmas', title: 'Christmas', occasion: 'christmas', date: xmas,
      days: Math.round((xmas.getTime() - today.getTime()) / DAY), approx: false, ideas: 0, count: people.length,
    })
  }
  return rows.sort((a, b) => a.days - b.days)
}

/** What the giver should do now, based on which delivery windows are still open. */
function advice(r: Row): { level: 'urgent' | 'soon' | 'calm'; text: string } {
  if (r.days <= 2) return { level: 'urgent', text: r.days === 0 ? 'Today! Same-day gifts only' : 'Same-day gifts only' }
  if (r.days < 10) return { level: 'soon', text: `Order by ${nice(addDays(r.date, -3))} for 2–3 day shipping` }
  return { level: 'calm', text: `Custom or handmade gifts possible if you order by ${nice(addDays(r.date, -10))}` }
}

function when(r: Row) {
  if (r.days === 0) return 'today'
  if (r.days === 1) return 'tomorrow'
  return r.approx ? `in ${MONTHS[r.date.getMonth()]}` : `in ${r.days} days`
}

export default function UpcomingPage({ people, setPeople, onFind, onImportNotes }: Props) {
  const rows = buildRows(people)
  const soon = rows.filter((r) => r.days <= 45)
  const later = rows.filter((r) => r.days > 45)
  const missing = people.filter((p) => !p.dates.some((d) => d.month)) // couples with a wedding date don't need a birthday

  return (
    <>
      <section className="hero-split">
        <div className="hero-copy">
          <p className="eyebrow">Upcoming</p>
          <h1>
            {soon.length ? (
              <>
                {soon.length} occasion{soon.length === 1 ? '' : 's'} <em>in the next 45 days.</em>
              </>
            ) : (
              <>
                Be the friend who <em>never forgets.</em>
              </>
            )}
          </h1>
          <p className="lead">
            Birthdays, weddings and holidays for everyone you shop for, with the last day to order for each delivery
            speed and a team of AI agents to find the gift.
          </p>
          <div className="pick-actions">
            {rows.length > 0 ? (
              <button className="btn btn-primary" onClick={() => downloadReminders(rows)}>
                📅 Add reminders to my calendar
              </button>
            ) : (
              <button className="btn btn-primary" onClick={async () => setPeople(await loadDemo())}>
                Load demo people
              </button>
            )}
            <button className="btn btn-ghost" onClick={onImportNotes}>
              Import gift notes →
            </button>
          </div>
        </div>
        <Ticker rows={rows} people={people} onFind={onFind} />
      </section>

      {people.length === 0 ? (
        <div className="empty">
          <h3>Start with your people</h3>
          <p className="muted">Import your gift notes, or upload a calendar or contacts file below to pull in birthdays.</p>
          <div className="pick-actions center">
            <button className="btn btn-primary" onClick={async () => setPeople(await loadDemo())}>
              Load demo people
            </button>
            <button className="btn btn-ghost" onClick={onImportNotes}>
              Import my gift notes
            </button>
          </div>
          <p className="mono muted small demo-hint">Demo: 5 people, a birthday in 2 days, wishlists, dislikes and gift history. No AI call.</p>
        </div>
      ) : (
        <div className="timeline">
          {soon.map((r) => (
            <UpcomingRow key={r.key} row={r} people={people} onFind={onFind} />
          ))}
          {later.length > 0 && (
            <details className="later">
              <summary>
                <span>Later · {later.length}</span>
                <span className="mono muted">show</span>
              </summary>
              {later.map((r) => (
                <UpcomingRow key={r.key} row={r} people={people} onFind={onFind} />
              ))}
            </details>
          )}
        </div>
      )}

      <div className="dash-grid">
        {people.length > 0 && <HolidayPlanner people={people} onFind={onFind} />}
        <CalendarImport people={people} setPeople={setPeople} />
        {missing.length > 0 && <MissingDates people={missing} all={people} setPeople={setPeople} />}
      </div>
    </>
  )
}

function UpcomingRow({ row: r, people, onFind }: { row: Row; people: Person[]; onFind: (p: FinderPreset) => void }) {
  const a = advice(r)
  const target = r.person ?? people[0]
  return (
    <article className={`up-row is-${a.level}`}>
      <div className="up-date">
        <span className="up-month mono">{MONTHS[r.date.getMonth()]}</span>
        <span className="up-day">{r.approx ? '?' : r.date.getDate()}</span>
      </div>
      {r.person && <Avatar name={r.person.name} photo={r.person.photo} size={42} />}
      <div className="up-body">
        <h3>
          {r.title} <span className="muted">· {r.occasion[0].toUpperCase() + r.occasion.slice(1)}</span>
        </h3>
        <p className="mono">
          <strong>{when(r)}</strong> · {a.text}
          {r.count ? ` · ${r.count} people on your list` : r.ideas ? ` · ${r.ideas} idea${r.ideas === 1 ? '' : 's'} saved` : ''}
        </p>
      </div>
      <button
        className="btn btn-primary btn-sm"
        onClick={() => onFind({ personId: target.id, occasion: r.occasion, date: iso(r.date) })}
      >
        Find a gift →
      </button>
    </article>
  )
}

function CalendarImport({ people, setPeople }: { people: Person[]; setPeople: (p: Person[]) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<{ keep: boolean; matchId: string | null; p: ParsedPerson }[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  async function pick(f: File | undefined) {
    if (!f) return
    setBusy(true)
    setError(null)
    setDone(null)
    try {
      const found = await parseCalendar(f)
      setRows(found.map((p) => ({ keep: true, matchId: p.match_id, p })))
      if (!found.length) setError('No birthdays or anniversaries found in that file.')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  async function save() {
    if (!rows) return
    setBusy(true)
    try {
      const keep = rows.filter((r) => r.keep)
      const res = await importPeople(keep.map((r) => ({ match_id: r.matchId, person: r.p })))
      setPeople(res.people)
      setDone(`Saved ${keep.length} date${keep.length === 1 ? '' : 's'} · ${res.created} new, ${res.updated} updated`)
      setRows(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="dash-card">
      <p className="eyebrow">Import birthdays</p>
      <h3>From your calendar or contacts</h3>
      <p className="muted small">
        Google Calendar: Settings → Import &amp; export → Export (.ics). iPhone Contacts: select contacts → Share → Export
        (.vcf). No AI involved; dates are read straight from the file.
      </p>
      <input ref={input} type="file" accept=".ics,.vcf" hidden onChange={(e) => pick(e.target.files?.[0])} />
      {!rows && (
        <button className="btn btn-ghost btn-sm" onClick={() => input.current?.click()} disabled={busy}>
          {busy ? 'Reading…' : 'Upload .ics or .vcf'}
        </button>
      )}
      {error && <p className="error">{error}</p>}
      {done && <p className="ok-note mono">✓ {done}</p>}

      {rows && rows.length > 0 && (
        <>
          <ul className="cal-rows">
            {rows.map((r, i) => (
              <li key={i} className={r.keep ? '' : 'is-off'}>
                <label>
                  <input
                    type="checkbox"
                    checked={r.keep}
                    onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, keep: e.target.checked } : x)))}
                  />
                  <strong>{r.p.display_name}</strong>
                  <span className="muted">{r.p.dates.map(formatDate).join(', ')}</span>
                </label>
                <select
                  value={r.matchId ?? ''}
                  onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, matchId: e.target.value || null } : x)))}
                >
                  <option value="">New person</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      Add to {p.name}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
          <div className="pick-actions">
            <button className="btn btn-primary btn-sm" onClick={save} disabled={busy || !rows.some((r) => r.keep)}>
              Save dates
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setRows(null)} disabled={busy}>
              Cancel
            </button>
          </div>
        </>
      )}
    </section>
  )
}

function MissingDates({ people, all, setPeople }: { people: Person[]; all: Person[]; setPeople: (p: Person[]) => void }) {
  return (
    <section className="dash-card">
      <p className="eyebrow">Missing birthdays</p>
      <h3>
        {people.length} {people.length === 1 ? 'person needs' : 'people need'} a date
      </h3>
      <ul className="cal-rows">
        {people.map((p) => (
          <MissingRow key={p.id} person={p} onSaved={(np) => setPeople(all.map((x) => (x.id === np.id ? np : x)))} />
        ))}
      </ul>
    </section>
  )
}

function MissingRow({ person, onSaved }: { person: Person; onSaved: (p: Person) => void }) {
  const [month, setMonth] = useState(0)
  const [day, setDay] = useState('')
  const [error, setError] = useState(false)
  async function save() {
    const d = Number(day)
    if (!month || !(d >= 1 && d <= 31)) return setError(true)
    onSaved(await setDate(person.id, { occasion: 'birthday', month, day: d, source_text: 'Added by hand' }))
  }
  return (
    <li>
      <strong>{person.name}</strong>
      <span className="missing-inputs">
        <select value={month} onChange={(e) => setMonth(Number(e.target.value))} aria-label={`${person.name} birthday month`}>
          <option value={0}>Month</option>
          {MONTHS.map((m, i) => (
            <option key={m} value={i + 1}>
              {m}
            </option>
          ))}
        </select>
        <input
          className={error ? 'bad' : ''} inputMode="numeric" placeholder="Day" value={day}
          onChange={(e) => { setDay(e.target.value); setError(false) }} aria-label={`${person.name} birthday day`}
        />
        <button className="link-btn" onClick={save}>
          Save
        </button>
      </span>
    </li>
  )
}

const TONES = ['purple', 'green', 'yellow', 'pink']

const SAMPLE_TICKER = [
  { name: 'Maya', line: 'Birthday · in 2 days', tags: ['Same-day only', '3 ideas'], tone: 'pink' },
  { name: 'Priya', line: 'Birthday · in 9 days', tags: ['Order by Nov 1', 'Likes running'], tone: 'yellow' },
  { name: 'Sam & Alex', line: 'Wedding · Jun 14', tags: ['Custom gifts OK', 'Registry on Zola'], tone: 'green' },
  { name: 'Dad', line: 'Birthday · in 30 days', tags: ['Custom gifts OK', 'Likes golf'], tone: 'purple' },
  { name: 'Mom', line: 'Christmas · Dec 25', tags: ['$65 budget', '2 ideas'], tone: 'green' },
]

/** Huddle-style column of cards that scrolls on a loop; pauses on hover. */
function Ticker({ rows, people, onFind }: { rows: Row[]; people: Person[]; onFind: (p: FinderPreset) => void }) {
  const cards = rows.length
    ? rows.slice(0, 8).map((r, i) => {
        const a = advice(r)
        const tagTone = a.level === 'urgent' ? 'pink' : a.level === 'soon' ? 'yellow' : 'green'
        const tone = a.level === 'urgent' ? 'pink' : TONES[i % TONES.length]
        const p = r.person
        const extra = r.count
          ? `${r.count} people`
          : p?.interests[0]
            ? `Likes ${p.interests[0]}`
            : r.ideas
              ? `${r.ideas} idea${r.ideas === 1 ? '' : 's'}`
              : null
        return {
          key: r.key,
          name: r.title,
          photo: p?.photo,
          emoji: p ? null : r.occasion === 'christmas' ? '🎄' : '🎉',
          line: `${r.occasion[0].toUpperCase()}${r.occasion.slice(1)} · ${when(r)}`,
          tags: [a.level === 'urgent' ? 'Same-day only' : a.level === 'soon' ? `Order by ${nice(addDays(r.date, -3))}` : 'Custom gifts OK', extra].filter(Boolean) as string[],
          tone,
          tagTone,
          go: () => onFind({ personId: (p ?? people[0]).id, occasion: r.occasion, date: iso(r.date) }),
        }
      })
    : SAMPLE_TICKER.map((c) => ({ ...c, key: c.name, photo: null, emoji: null, tagTone: c.tone, go: undefined }))
  const loop = [...cards, ...cards] // duplicated so the scroll can wrap seamlessly
  return (
    <div className="ticker" aria-label="Upcoming occasions">
      <div className="ticker-track" style={{ animationDuration: `${Math.max(cards.length, 3) * 4.5}s` }}>
        {loop.map((c, i) => (
          <button
            key={`${c.key}-${i}`}
            className={`ticker-card tone-${c.tone}`}
            onClick={c.go}
            tabIndex={i < cards.length ? 0 : -1}
            aria-hidden={i >= cards.length}
          >
            <span className="ticker-top">
              <span className={`tag-pill tag-${c.tagTone}`}>● {c.tags[0]}</span>
            </span>
            <span className="ticker-person">
              {c.emoji ? <span className="emoji-avatar">{c.emoji}</span> : <Avatar name={c.name} photo={c.photo} size={46} />}
              <span>
                <strong>{c.name}</strong>
                <span className="mono">{c.line}</span>
              </span>
            </span>
            {c.tags[1] && <span className="ticker-tag mono">#{c.tags[1].toLowerCase().replace(/\s+/g, '')}</span>}
          </button>
        ))}
      </div>
    </div>
  )
}
