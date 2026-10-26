import { useMemo, useState } from 'react'
import type { Person } from '../api'
import type { FinderPreset } from './UpcomingPage'

// Closer relationships get a bigger share by default; every amount stays editable.
const CLOSE = /\b(mom|dad|mother|father|parent|partner|wife|husband|spouse|boyfriend|girlfriend|fianc)/i
const NEAR = /\b(best friend|sister|brother|sibling|grandma|grandpa|grandmother|grandfather)/i
const weight = (p: Person) => (CLOSE.test(p.relationship ?? p.name) ? 1.5 : NEAR.test(p.relationship ?? '') ? 1.25 : 1)

function split(total: number, people: Person[]): Record<string, number> {
  const sum = people.reduce((n, p) => n + weight(p), 0) || 1
  return Object.fromEntries(people.map((p) => [p.id, Math.max(5, Math.round((total * weight(p)) / sum / 5) * 5)]))
}

function christmasDate() {
  const t = new Date()
  t.setHours(0, 0, 0, 0)
  const x = new Date(t.getFullYear(), 11, 25)
  if (x < t) x.setFullYear(x.getFullYear() + 1)
  return `${x.getFullYear()}-12-25`
}

export default function HolidayPlanner({ people, onFind }: { people: Person[]; onFind: (p: FinderPreset) => void }) {
  const [total, setTotal] = useState(250)
  const [included, setIncluded] = useState<Set<string>>(() => new Set(people.map((p) => p.id)))
  const [overrides, setOverrides] = useState<Record<string, number>>({})

  const chosen = people.filter((p) => included.has(p.id))
  const suggested = useMemo(() => split(total, chosen), [total, chosen.map((p) => p.id).join()])
  const amount = (id: string) => overrides[id] ?? suggested[id] ?? 0
  const planned = chosen.reduce((n, p) => n + amount(p.id), 0)
  const left = total - planned

  function toggle(id: string) {
    const next = new Set(included)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setIncluded(next)
    setOverrides({})
  }

  return (
    <section className="dash-card holiday">
      <p className="eyebrow">Holiday budget</p>
      <h3>Plan Christmas for everyone at once</h3>
      <p className="muted small">
        Set one total. Giftwise splits it (a bit more for parents and partners), you adjust, then shop for each person
        with their share.
      </p>
      <label className="holiday-total">
        <span className="mono">Total budget</span>
        <span className="money-input">
          $<input inputMode="numeric" value={total} onChange={(e) => { setTotal(Number(e.target.value.replace(/\D/g, '')) || 0); setOverrides({}) }} />
        </span>
      </label>

      <ul className="cal-rows">
        {people.map((p) => {
          const on = included.has(p.id)
          return (
            <li key={p.id} className={on ? '' : 'is-off'}>
              <label>
                <input type="checkbox" checked={on} onChange={() => toggle(p.id)} />
                <strong>{p.name}</strong>
                {p.relationship && <span className="muted">{p.relationship}</span>}
              </label>
              {on && (
                <span className="missing-inputs">
                  <span className="money-input small">
                    $<input
                      inputMode="numeric" value={amount(p.id)} aria-label={`${p.name} budget`}
                      onChange={(e) => setOverrides({ ...overrides, [p.id]: Number(e.target.value.replace(/\D/g, '')) || 0 })}
                    />
                  </span>
                  <button className="link-btn" onClick={() => onFind({ personId: p.id, occasion: 'christmas', date: christmasDate(), budget: amount(p.id) })}>
                    Find →
                  </button>
                </span>
              )}
            </li>
          )
        })}
      </ul>
      <p className={`mono small ${left < 0 ? 'over' : 'muted'}`}>
        ${planned} planned · {left >= 0 ? `$${left} left` : `$${-left} over budget`}
      </p>
    </section>
  )
}
