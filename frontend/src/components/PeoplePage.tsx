import { useState } from 'react'
import { deletePerson, loadDemo, readLink, saveIdea, setIdeaStatus, type LinkDraft, type Person } from '../api'
import { formatDate, sizeLabel, STATUS_LABEL } from '../format'
import AddPersonForm from './AddPersonForm'
import Avatar, { pastel } from './Avatar'
import PersonDrawer from './PersonDrawer'

interface Props {
  people: Person[]
  setPeople: (p: Person[]) => void
  onImport: () => void
  onFind: (personId: string) => void
}

export default function PeoplePage({ people, setPeople, onImport, onFind }: Props) {
  const [adding, setAdding] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const opened = people.find((p) => p.id === openId)
  const update = (np: Person) => setPeople(people.map((x) => (x.id === np.id ? np : x)))
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<'next' | 'name' | 'ideas'>('next')
  const year = new Date().getFullYear()
  const spent = people.flatMap((p) => p.ideas).filter((i) => i.status === 'given' && i.year === year).reduce((n, i) => n + (i.spent ?? 0), 0)
  const shown = people
    .filter((p) => {
      const needle = q.trim().toLowerCase()
      return !needle || [p.name, p.relationship, ...p.interests, ...p.ideas.map((i) => i.title)].some((x) => x?.toLowerCase().includes(needle))
    })
    .sort((a, b) =>
      sort === 'name' ? a.name.localeCompare(b.name)
        : sort === 'ideas' ? openCount(b) - openCount(a)
          : daysToNext(a) - daysToNext(b),
    )

  async function markGiven(p: Person, ideaId: string) {
    const updated = await setIdeaStatus(p.id, ideaId, 'given', new Date().getFullYear())
    setPeople(people.map((x) => (x.id === updated.id ? updated : x)))
  }

  async function remove(p: Person) {
    if (!window.confirm(`Remove ${p.name} and all their gift ideas?`)) return
    await deletePerson(p.id)
    setOpenId(null)
    setPeople(people.filter((x) => x.id !== p.id))
  }

  return (
    <>
      <section className="hero hero-compact">
        <p className="eyebrow">Your people</p>
        <h1>
          {people.length} {people.length === 1 ? 'person' : 'people'}, <em>all sorted.</em>
        </h1>
        <p className="lead">
          Every idea from your notes, grouped by who it's for.
          {spent > 0 && <> You've spent <strong>${spent.toFixed(0)}</strong> on gifts in {year}.</>}
        </p>
        {!adding && (
          <button className="btn btn-primary btn-sm reminder-btn" onClick={() => setAdding(true)}>
            + Add a person
          </button>
        )}
      </section>

      {adding && (
        <AddPersonForm
          onCancel={() => setAdding(false)}
          onSaved={(p) => {
            setPeople([p, ...people])
            setAdding(false)
          }}
        />
      )}

      {people.length === 0 && adding ? null : people.length === 0 ? (
        <div className="empty">
          <h3>No one here yet</h3>
          <p className="muted">Import your gift notes and they'll show up here.</p>
          <div className="pick-actions center">
            <button className="btn btn-primary" onClick={onImport}>
              Import notes
            </button>
            <button className="btn btn-ghost" onClick={async () => setPeople(await loadDemo())}>
              Load demo people
            </button>
          </div>
        </div>
      ) : (
        <>
        <div className="people-tools">
          <input className="text-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people, interests or ideas" aria-label="Search people" />
          <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort people">
            <option value="next">Next occasion first</option>
            <option value="name">Name A–Z</option>
            <option value="ideas">Most ideas</option>
          </select>
          <span className="mono muted">{shown.length} of {people.length}</span>
        </div>
        <div className="people-grid">
          {shown.map((p) => {
            const open = p.ideas.filter((i) => i.status === 'idea')
            const done = p.ideas.filter((i) => i.status !== 'idea')
            return (
              <article key={p.id} className="person-card">
                <button className="person-top" style={{ background: pastel(p.name) }} onClick={() => setOpenId(p.id)}>
                  <Avatar name={p.name} photo={p.photo} size={64} />
                  <span className="rc-title">
                    <h3>{p.name}</h3>
                    <span className="mono">
                      {open.length} idea{open.length === 1 ? '' : 's'}
                      {p.relationship ? ` · ${p.relationship}` : ''}
                    </span>
                  </span>
                  <span className="tag-pill tag-dark">View →</span>
                </button>

                {open.length > 0 && (
                  <ul className="person-ideas">
                    {open.map((i) => (
                      <li key={i.id}>
                        <span>
                          <strong>{i.title}</strong>
                          {i.details && <span className="muted"> · {i.details}</span>}
                        </span>
                        <button className="give-btn" onClick={() => markGiven(p, i.id)} title="Mark as given this year so the agents never suggest it again">
                          ✓ Given
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="rc-chips">
                  {p.dislikes.map((x) => (
                    <span key={x} className="chip chip-avoid">
                      Avoid: {x}
                    </span>
                  ))}
                  {p.interests.map((x) => (
                    <span key={`i-${x}`} className="chip">
                      Likes {x}
                    </span>
                  ))}
                  {p.sizes.map((x) => (
                    <span key={x} className="chip chip-mono">
                      {sizeLabel(x)}
                    </span>
                  ))}
                  {p.dates.map((d) => (
                    <span key={d.occasion} className="chip chip-date">
                      {formatDate(d)}
                    </span>
                  ))}
                </div>

                <AddFromLink person={p} onSaved={(np) => setPeople(people.map((x) => (x.id === np.id ? np : x)))} />

                <button className="btn btn-primary btn-sm person-find" onClick={() => onFind(p.id)}>
                  Find a gift for {p.name} →
                </button>

                {p.location && <p className="history mono">📍 {p.location}</p>}
                {done.length > 0 && (
                  <p className="history mono">
                    History:{' '}
                    {done.map((i) => `${i.title} (${STATUS_LABEL[i.status].toLowerCase()}${i.year ? ` ${i.year}` : ''})`).join(', ')}
                  </p>
                )}
              </article>
            )
          })}
        </div>
        </>
      )}
      {opened && (
        <PersonDrawer
          person={opened}
          onClose={() => setOpenId(null)}
          onUpdated={update}
          onFind={(id) => {
            setOpenId(null)
            onFind(id)
          }}
          onRemove={remove}
        />
      )}
    </>
  )
}

const openCount = (p: Person) => p.ideas.filter((i) => i.status === 'idea').length

function daysToNext(p: Person) {
  const t = new Date()
  t.setHours(0, 0, 0, 0)
  const days = p.dates.filter((d) => d.month).map((d) => {
    let x = new Date(t.getFullYear(), d.month! - 1, d.day ?? 1)
    if (x < t) x = new Date(t.getFullYear() + 1, d.month! - 1, d.day ?? 1)
    return (x.getTime() - t.getTime()) / 86400000
  })
  return days.length ? Math.min(...days) : 9999
}

export function AddFromLink({ person, onSaved }: { person: Person; onSaved: (p: Person) => void }) {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [draft, setDraft] = useState<LinkDraft | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function read() {
    setBusy(true)
    setError(null)
    try {
      setDraft(await readLink(url))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    if (!draft) return
    onSaved(await saveIdea(person.id, { title: draft.title, details: draft.store, link: draft.link, price_hint: draft.price_hint, occasion: null }))
    setOpen(false)
    setUrl('')
    setDraft(null)
  }

  if (!open) {
    return (
      <button className="link-btn add-link" onClick={() => setOpen(true)}>
        + Add idea from a link
      </button>
    )
  }
  return (
    <div className="chip-in">
      {!draft ? (
        <>
          <input className="text-input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste a product link (Etsy, Amazon, any shop)" />
          <div className="pick-actions">
            <button className="btn btn-primary btn-sm" onClick={read} disabled={busy || !url.trim()}>
              {busy ? 'Reading…' : 'Read link'}
            </button>
            <button className="link-btn" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </>
      ) : (
        <>
          <span className="mono muted">
            {draft.method === 'metadata' ? 'From the page' : draft.method === 'ai' ? 'Read by AI' : 'From the link (shop blocked reading)'} · check it
          </span>
          {draft.flagged && <span className="pill pill-bought">Removed text on the page aimed at AI</span>}
          <input className="text-input" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} aria-label="Idea name" />
          <span className="muted small">
            {draft.store ?? 'Unknown shop'}
            {draft.price_hint ? ` · ${draft.price_hint}` : ''}
          </span>
          <div className="pick-actions">
            <button className="btn btn-primary btn-sm" onClick={save} disabled={!draft.title.trim()}>
              Save to {person.name}
            </button>
            <button className="link-btn" onClick={() => setDraft(null)}>Back</button>
          </div>
        </>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  )
}
