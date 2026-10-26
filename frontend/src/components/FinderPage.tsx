import { useMemo, useRef, useState } from 'react'
import {
  recordMetric, runFinder, type AgentEvent, type FinderResult, type Occasion, type Person, type Tier, type Vibe,
} from '../api'
import Avatar from './Avatar'
import PickCard from './PickCard'
import UsagePanel from './UsagePanel'
import type { FinderPreset } from './UpcomingPage'

interface Props {
  people: Person[]
  personId: string | null
  preset: FinderPreset | null
  setPersonId: (id: string) => void
  onPersonUpdated: (p: Person) => void
  onImport: () => void
  onSpend: () => void
}

const VIBES: { id: Vibe; label: string }[] = [
  { id: 'sentimental', label: 'Sentimental' },
  { id: 'funny', label: 'Funny' },
  { id: 'practical', label: 'Practical' },
  { id: 'experience', label: 'An experience' },
  { id: 'fancy', label: 'Fancy' },
  { id: 'handmade', label: 'Handmade' },
  { id: 'cozy', label: 'Cozy' },
]
const OCCASIONS: Occasion[] = ['birthday', 'christmas', 'holiday', 'wedding', 'anniversary', 'graduation', 'other']
const TIER_INFO: Record<Tier, { label: string; note: string }> = {
  same_day: { label: 'Same day', note: 'Local delivery, pickup or instant e-gift' },
  fast: { label: '2–3 days', note: 'Ships fast, order in the next day or two' },
  planned: { label: '7–14 days', note: 'Custom or handmade, order soon' },
}
const AGENTS = ['Idea', 'Shopping · Same day', 'Shopping · Nearby', 'Shopping · 2–3 days', 'Shopping · 7–14 days', 'Critic']
const AGENT_ROLE: Record<string, string> = {
  Idea: 'Brainstorms gift concepts from their profile',
  'Shopping · Same day': 'Finds products that can arrive today',
  'Shopping · Nearby': 'Finds real bakeries, florists and cafés near them',
  'Shopping · 2–3 days': 'Finds products that ship fast',
  'Shopping · 7–14 days': 'Finds custom and handmade products',
  Critic: 'Checks fit, dislikes, repeats and timing, then ranks',
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** Next birthday if we know it, otherwise two weeks from today. */
function defaultDate(p: Person | undefined, occasion: Occasion): string {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const d = p?.dates.find((x) => x.occasion === occasion && x.month)
  if (d?.month) {
    const next = new Date(today.getFullYear(), d.month - 1, d.day ?? 1)
    if (next < today) next.setFullYear(next.getFullYear() + 1)
    return iso(next)
  }
  if (occasion === 'christmas') {
    const xmas = new Date(today.getFullYear(), 11, 25)
    if (xmas < today) xmas.setFullYear(xmas.getFullYear() + 1)
    return iso(xmas)
  }
  today.setDate(today.getDate() + 14) // calendar days, so daylight-saving changes don't shift it
  return iso(today)
}

export default function FinderPage({ people, personId, preset, setPersonId, onPersonUpdated, onImport, onSpend }: Props) {
  const person = people.find((p) => p.id === personId) ?? people[0]
  const [occasion, setOccasion] = useState<Occasion>(preset?.occasion ?? 'birthday')
  const [date, setDate] = useState(() => preset?.date ?? defaultDate(person, 'birthday'))
  const [budget, setBudget] = useState(preset?.budget ?? 60)
  const [vibes, setVibes] = useState<Vibe[]>(['sentimental', 'practical'])
  const [extra, setExtra] = useState('')
  const [location, setLocation] = useState(person?.location ?? '')
  const [events, setEvents] = useState<Record<string, AgentEvent>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<FinderResult | null>(null)
  const clock = useRef<number | null>(null) // for measuring time to a chosen gift

  const daysLeft = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return Math.round((new Date(`${date}T00:00:00`).getTime() - today.getTime()) / 86400000)
  }, [date])

  if (!person) {
    return (
      <section className="hero">
        <p className="eyebrow">Find a gift</p>
        <h1>
          First, tell us <em>who you shop for.</em>
        </h1>
        <p className="lead">Import your gift notes so the agents know who they're shopping for.</p>
        <button className="btn btn-primary" onClick={onImport}>
          Import notes
        </button>
      </section>
    )
  }

  function choosePerson(id: string) {
    setPersonId(id)
    setDate(defaultDate(people.find((p) => p.id === id), occasion))
    setResult(null)
    setEvents({})
  }

  function chooseOccasion(o: Occasion) {
    setOccasion(o)
    setDate(defaultDate(person, o))
  }

  function toggleVibe(v: Vibe) {
    setVibes((cur) => (cur.includes(v) ? cur.filter((x) => x !== v) : cur.length >= 3 ? cur : [...cur, v]))
  }

  async function find(fresh: boolean) {
    clock.current = performance.now()
    setBusy(true)
    setError(null)
    setResult(null)
    setEvents({})
    try {
      const res = await runFinder(
        { person_id: person.id, occasion, event_date: date, budget, vibes, extra: extra.trim() || null, location: location.trim() || null, fresh },
        (e) => setEvents((cur) => ({ ...cur, [e.agent]: e })),
      )
      setResult(res)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
      onSpend()
    }
  }

  const started = busy || result !== null || Object.keys(events).length > 0
  const wishlist = person.ideas.filter((i) => i.status === 'idea')

  return (
    <>
      <section className="hero hero-compact">
        <div className="finder-who">
          <Avatar name={person.name} photo={person.photo} size={56} />
          <p className="eyebrow">Find a gift</p>
        </div>
        <h1>
          Something {person.name} will <em>actually love.</em>
        </h1>
        <p className="lead">
          A team of AI agents brainstorms from what you know about them, shops in every delivery window you still
          have time for, and cuts anything that misses.
        </p>
      </section>

      <div className="finder">
        <section className="finder-form">
          <label className="field">
            <span className="mono">For</span>
            <select value={person.id} onChange={(e) => choosePerson(e.target.value)} disabled={busy}>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <div className="field-row">
            <label className="field">
              <span className="mono">Occasion</span>
              <select value={occasion} onChange={(e) => chooseOccasion(e.target.value as Occasion)} disabled={busy}>
                {OCCASIONS.map((o) => (
                  <option key={o} value={o}>
                    {o[0].toUpperCase() + o.slice(1)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="mono">Date</span>
              <input type="date" value={date} min={iso(new Date())} onChange={(e) => setDate(e.target.value)} disabled={busy} />
            </label>
          </div>
          <p className={`days-left mono${daysLeft <= 2 ? ' urgent' : ''}`}>
            {daysLeft < 0
              ? 'That date has passed'
              : daysLeft === 0
                ? 'Today! Same-day options only'
                : `${daysLeft} day${daysLeft === 1 ? '' : 's'} left${daysLeft < 3 ? ' · same-day options only' : daysLeft < 10 ? ' · no time for custom orders' : ''}`}
          </p>

          <label className="field">
            <span className="mono">Where do they live? (for same-day local shops)</span>
            <input
              className="text-input" value={location} maxLength={200} onChange={(e) => setLocation(e.target.value)} disabled={busy}
              placeholder="City, zip or street address"
            />
            <span className="hint">Sent to OpenStreetMap only to find shops nearby. A zip code is enough.</span>
          </label>

          <label className="field">
            <span className="mono">
              Budget · up to <strong>${budget}</strong>
            </span>
            <input
              type="range" min={5} max={300} step={5} value={budget}
              onChange={(e) => setBudget(Number(e.target.value))} disabled={busy}
            />
          </label>

          <div className="field">
            <span className="mono">Vibe · pick up to 3</span>
            <div className="vibes">
              {VIBES.map((v) => (
                <button
                  key={v.id}
                  className={`vibe${vibes.includes(v.id) ? ' on' : ''}`}
                  onClick={() => toggleVibe(v.id)}
                  disabled={busy || (!vibes.includes(v.id) && vibes.length >= 3)}
                  aria-pressed={vibes.includes(v.id)}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>

          <label className="field">
            <span className="mono">Anything else? (optional)</span>
            <textarea
              rows={2} maxLength={500} value={extra} onChange={(e) => setExtra(e.target.value)} disabled={busy}
              placeholder="She just moved apartments · He's training for a half marathon"
            />
          </label>

          <div className="profile-peek">
            <span className="mono muted">What the agents know about {person.name}</span>
            <div className="rc-chips">
              {wishlist.slice(0, 4).map((i) => (
                <span key={i.id} className="chip chip-date">
                  ★ {i.title}
                </span>
              ))}
              {person.interests.map((x) => (
                <span key={x} className="chip">
                  Likes {x}
                </span>
              ))}
              {person.dislikes.map((x) => (
                <span key={x} className="chip chip-avoid">
                  Avoid: {x}
                </span>
              ))}
              {wishlist.length + person.interests.length + person.dislikes.length === 0 && (
                <span className="muted">Not much yet. Add notes for better ideas.</span>
              )}
            </div>
          </div>

          <button className="btn btn-primary btn-block" onClick={() => find(false)} disabled={busy || daysLeft < 0 || vibes.length === 0}>
            {busy ? 'The team is shopping…' : 'Find gifts'}
          </button>
          {error && <p className="error">{error}</p>}
        </section>

        <section className="finder-out">
          {!started && (
            <div className="team-intro">
              <p className="eyebrow">Meet the team</p>
              {AGENTS.map((a) => (
                <div key={a} className="agent-row">
                  <span className="agent-dot" />
                  <div>
                    <strong>{a}</strong>
                    <span className="muted">{AGENT_ROLE[a]}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {started && (
            <div className="agent-floor">
              {AGENTS.map((a) => {
                const ev = events[a]
                const status = ev?.status ?? (busy ? 'waiting' : 'skipped')
                return (
                  <div key={a} className={`agent-row is-${status}`}>
                    <span className="agent-dot" />
                    <div>
                      <strong>{a}</strong>
                      <span className="mono">{ev?.detail || (status === 'waiting' ? 'waiting for teammates' : AGENT_ROLE[a])}</span>
                    </div>
                    <span className="agent-status mono">{status}</span>
                  </div>
                )
              })}
            </div>
          )}

          {result && (
            <Results
              result={result} vibes={vibes} onPersonUpdated={onPersonUpdated} onRetry={() => find(true)} busy={busy}
              onChosen={(what) => {
                if (clock.current == null) return
                recordMetric('finder_to_idea', (performance.now() - clock.current) / 1000, `${what}${result.cached ? ' (cached)' : ''}`).then(onSpend)
                clock.current = null
              }}
            />
          )}
        </section>
      </div>
    </>
  )
}

function Results({
  result, vibes, onPersonUpdated, onRetry, busy, onChosen,
}: { result: FinderResult; vibes: Vibe[]; onPersonUpdated: (p: Person) => void; onRetry: () => void; busy: boolean; onChosen: (what: string) => void }) {
  const { usage } = result
  return (
    <div className="results">
      <div className="results-head">
        <h2>
          {result.picks.length} pick{result.picks.length === 1 ? '' : 's'} for <em>{result.person_name}</em>
        </h2>
        <span className="mono parse-meta">
          {result.location_found && <span className="loc-found">📍 {result.location_found.split(',').slice(0, 3).join(',')}</span>}
          {result.cached ? 'From cache' : `${usage.requests} AI calls`}
        </span>
      </div>
      <UsagePanel usage={usage} cached={result.cached} />

      {result.blocked_listings.length > 0 && (
        <div className="shield">
          <span className="shield-icon" aria-hidden>⛨</span>
          <div>
            <strong>
              Hid {result.blocked_listings.length} listing{result.blocked_listings.length > 1 ? 's' : ''} that tried to instruct the AI.
            </strong>
            <p>
              The seller's description told AI assistants to always recommend it. The agents never saw it:{' '}
              {result.blocked_listings.join(', ')}.
            </p>
          </div>
        </div>
      )}

      {result.picks.length === 0 && (
        <p className="empty-note">No strong picks in this budget and timeframe. Try a bigger budget, other vibes, or a later date.</p>
      )}

      {(['same_day', 'fast', 'planned'] as Tier[]).map((t) => {
        const picks = result.picks.filter((p) => p.tier === t)
        if (!result.tiers.includes(t)) return null
        return (
          <section key={t} className="tier">
            <div className="tier-head">
              <h3>{TIER_INFO[t].label}</h3>
              <span className="mono muted">{TIER_INFO[t].note}</span>
            </div>
            {picks.length === 0 ? (
              <p className="muted tier-empty">Nothing strong enough in this window.</p>
            ) : (
              <div className="pick-grid">
                {[...picks].sort((a, b) => Number(b.is_local) - Number(a.is_local)).map((p) => (
                  <PickCard key={p.product_id} pick={p} personId={result.person_id} personName={result.person_name} onChosen={onChosen} occasion={result.occasion} vibes={vibes} onPersonUpdated={onPersonUpdated} />
                ))}
              </div>
            )}
          </section>
        )
      })}

      {result.wishlist_unmatched.length > 0 && (
        <div className="unassigned">
          <p className="eyebrow">From their wishlist, not in our catalog</p>
          <ul>
            {result.wishlist_unmatched.map((w) => (
              <li key={w}>
                {w} ·{' '}
                <a className="link" href={`https://www.google.com/search?tbm=shop&q=${encodeURIComponent(w)}`} target="_blank" rel="noreferrer">
                  search stores →
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.rejected.length > 0 && (
        <details className="cut">
          <summary>
            <span>Cut {result.rejected.length} idea{result.rejected.length === 1 ? '' : 's'}</span>
            <span className="mono muted">see why</span>
          </summary>
          <ul>
            {result.rejected.map((r) => (
              <li key={r.title}>
                <span className={`pill ${r.by === 'rule' ? 'pill-bought' : ''}`}>{r.by === 'rule' ? 'House rule' : 'Critic'}</span>
                <strong>{r.title}</strong>
                <span className="muted">{r.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <button className="btn btn-ghost" onClick={onRetry} disabled={busy}>
        Ask again for new ideas
      </button>
    </div>
  )
}
