import { useState } from 'react'
import { createPerson, updatePerson, type Person } from '../api'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const list = (s: string) => s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean)

interface Props {
  onSaved: (p: Person) => void
  onCancel: () => void
  initial?: Person // set when editing someone already saved
}

export default function AddPersonForm({ onSaved, onCancel, initial }: Props) {
  const bday = initial?.dates.find((d) => d.occasion === 'birthday')
  const [name, setName] = useState(initial?.name ?? '')
  const [relationship, setRelationship] = useState(initial?.relationship ?? '')
  const [month, setMonth] = useState(bday?.month ?? 0)
  const [day, setDay] = useState(bday?.day ? String(bday.day) : '')
  const [location, setLocation] = useState(initial?.location ?? '')
  const [interests, setInterests] = useState(initial?.interests.join(', ') ?? '')
  const [dislikes, setDislikes] = useState(initial?.dislikes.join(', ') ?? '')
  const [sizes, setSizes] = useState(initial?.sizes.join(', ') ?? '')
  const [ideas, setIdeas] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    const d = Number(day)
    if (!name.trim()) return setError('Add a name.')
    if (day && !(d >= 1 && d <= 31)) return setError('Birthday day should be 1–31.')
    setBusy(true)
    setError(null)
    try {
      const basics = {
        name: name.trim(),
        relationship: relationship.trim() || null,
        birthday_month: month || null,
        birthday_day: month && d ? d : null,
        location: location.trim() || null,
        interests: list(interests),
        dislikes: list(dislikes),
        sizes: list(sizes),
      }
      onSaved(
        initial
          ? await updatePerson(initial.id, basics)
          : await createPerson({ ...basics, ideas: ideas.split('\n').map((x) => x.trim()).filter(Boolean) }),
      )
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <form className="add-person" onSubmit={save}>
      <div className="add-person-head">
        <div>
          <p className="eyebrow">{initial ? 'Edit' : 'New person'}</p>
          <h3>{initial ? `Update ${initial.name}` : 'Who are you shopping for?'}</h3>
        </div>
        <button type="button" className="icon-btn" onClick={onCancel} aria-label="Close">
          ×
        </button>
      </div>

      <div className="add-grid">
        <label className="field">
          <span className="mono">Name *</span>
          <input className="text-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Priya" autoFocus={!initial} maxLength={80} />
        </label>
        <label className="field">
          <span className="mono">Relationship</span>
          <input className="text-input" value={relationship} onChange={(e) => setRelationship(e.target.value)} placeholder="best friend, mom, coworker" maxLength={80} />
        </label>
        <div className="field">
          <span className="mono">Birthday</span>
          <span className="missing-inputs">
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))} aria-label="Birthday month">
              <option value={0}>Month</option>
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
            <input inputMode="numeric" placeholder="Day" value={day} onChange={(e) => setDay(e.target.value)} aria-label="Birthday day" />
          </span>
        </div>
        <label className="field">
          <span className="mono">Where they live</span>
          <input className="text-input" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="City or zip, for same-day local shops" maxLength={200} />
        </label>
        <label className="field">
          <span className="mono">Likes</span>
          <input className="text-input" value={interests} onChange={(e) => setInterests(e.target.value)} placeholder="running, matcha, true crime" />
        </label>
        <label className="field">
          <span className="mono">Don't buy them</span>
          <input className="text-input" value={dislikes} onChange={(e) => setDislikes(e.target.value)} placeholder="candles, hoodies" />
        </label>
        <label className="field">
          <span className="mono">Sizes</span>
          <input className="text-input" value={sizes} onChange={(e) => setSizes(e.target.value)} placeholder="shirt M, shoes 8" />
        </label>
        {!initial && (
          <label className="field">
            <span className="mono">Gift ideas (one per line)</span>
            <textarea rows={3} value={ideas} onChange={(e) => setIdeas(e.target.value)} placeholder={'Silk scarf\nPottery class'} />
          </label>
        )}
      </div>

      {error && <p className="error">{error}</p>}
      <div className="pick-actions">
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
          {busy ? 'Saving…' : initial ? 'Save changes' : 'Save person'}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  )
}
