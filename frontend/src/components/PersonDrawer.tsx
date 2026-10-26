import { useEffect, useRef, useState } from 'react'
import { setIdeaStatus, setPhoto, type Person } from '../api'
import { formatDate, sizeLabel, STATUS_LABEL } from '../format'
import AddPersonForm from './AddPersonForm'
import Avatar, { pastel } from './Avatar'
import { AddFromLink } from './PeoplePage'

const DAY = 86400000

function nextDate(p: Person) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  let best: { label: string; days: number } | null = null
  for (const d of p.dates) {
    if (!d.month) continue
    let when = new Date(today.getFullYear(), d.month - 1, d.day ?? 1)
    if (when < today) when = new Date(today.getFullYear() + 1, d.month - 1, d.day ?? 1)
    const days = Math.round((when.getTime() - today.getTime()) / DAY)
    if (!best || days < best.days) best = { label: d.occasion, days }
  }
  return best
}

/** Shrink a photo to 256px JPEG in the browser so it stays small. */
function resize(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const s = 256
      const c = document.createElement('canvas')
      c.width = c.height = s
      const side = Math.min(img.width, img.height)
      c.getContext('2d')!.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, s, s)
      resolve(c.toDataURL('image/jpeg', 0.82))
    }
    img.onerror = () => reject(new Error("That file isn't an image we can read."))
    img.src = URL.createObjectURL(file)
  })
}

interface Props {
  person: Person
  onClose: () => void
  onUpdated: (p: Person) => void
  onFind: (id: string) => void
  onRemove: (p: Person) => void
}

export default function PersonDrawer({ person: p, onClose, onUpdated, onFind, onRemove }: Props) {
  const file = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const year = new Date().getFullYear()
  const spentThisYear = p.ideas.filter((i) => i.status === 'given' && i.year === year).reduce((n, i) => n + (i.spent ?? 0), 0)
  const open = p.ideas.filter((i) => i.status === 'idea')
  const done = p.ideas.filter((i) => i.status !== 'idea')
  const next = nextDate(p)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function upload(f: File | undefined) {
    if (!f) return
    setError(null)
    try {
      onUpdated(await setPhoto(p.id, await resize(f)))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={p.name}>
        <button className="icon-btn drawer-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <div className="drawer-hero" style={{ background: pastel(p.name) }}>
          <Avatar name={p.name} photo={p.photo} size={132} />
          <div className="drawer-photo-btns">
            <input ref={file} type="file" accept="image/*" hidden onChange={(e) => upload(e.target.files?.[0])} />
            <button className="link-btn" onClick={() => file.current?.click()}>
              {p.photo ? 'Change photo' : 'Upload a photo'}
            </button>
            {p.photo && (
              <button className="link-btn" onClick={async () => onUpdated(await setPhoto(p.id, null))}>
                Use drawing
              </button>
            )}
          </div>
        </div>

        {editing ? (
          <div className="drawer-body">
            <AddPersonForm
              initial={p}
              onCancel={() => setEditing(false)}
              onSaved={(np) => {
                onUpdated(np)
                setEditing(false)
              }}
            />
          </div>
        ) : (
        <div className="drawer-body">
          <div className="drawer-title">
            <h2>{p.name}</h2>
            <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>
              Edit
            </button>
          </div>
          <p className="mono muted">
            {[p.relationship, p.location && `📍 ${p.location}`].filter(Boolean).join(' · ') || 'No details yet'}
          </p>
          {next && (
            <p className={`tag-pill ${next.days <= 2 ? 'tag-pink' : next.days < 10 ? 'tag-yellow' : 'tag-green'}`}>
              {next.label} {next.days === 0 ? 'today' : `in ${next.days} days`}
            </p>
          )}
          {error && <p className="error">{error}</p>}

          <div className="rc-chips">
            {p.interests.map((x) => <span key={`i-${x}`} className="chip">Likes {x}</span>)}
            {p.dislikes.map((x) => <span key={`d-${x}`} className="chip chip-avoid">Avoid: {x}</span>)}
            {p.sizes.map((x) => <span key={`s-${x}`} className="chip chip-mono">{sizeLabel(x)}</span>)}
            {p.dates.map((d) => <span key={`t-${d.occasion}`} className="chip chip-date">{formatDate(d)}</span>)}
          </div>

          <h3 className="drawer-h">Wishlist · {open.length}</h3>
          {open.length === 0 ? (
            <p className="muted small">No ideas yet. Add one from a link, or run the gift finder.</p>
          ) : (
            <ul className="person-ideas">
              {open.map((i) => (
                <li key={i.id}>
                  <span>
                    <strong>{i.title}</strong>
                    {i.details && <span className="muted"> · {i.details}</span>}
                    {i.price_hint && <span className="mono"> · {i.price_hint}</span>}
                  </span>
                  <GiveButton onGive={async (spent) => onUpdated(await setIdeaStatus(p.id, i.id, 'given', year, spent))} />
                </li>
              ))}
            </ul>
          )}
          <AddFromLink person={p} onSaved={onUpdated} />

          {done.length > 0 && (
            <>
              <h3 className="drawer-h">
                Gift history{spentThisYear > 0 ? ` · $${spentThisYear.toFixed(0)} spent in ${year}` : ''}
              </h3>
              <ul className="person-ideas">
                {done.map((i) => (
                  <li key={i.id}>
                    <span>
                      {i.title}
                      {i.spent != null && <span className="mono muted"> · ${i.spent.toFixed(0)}</span>}
                    </span>
                    <span className={`pill pill-${i.status}`}>{STATUS_LABEL[i.status]}{i.year ? ` ${i.year}` : ''}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {p.notes.length > 0 && <p className="rc-notes muted">{p.notes.join(' · ')}</p>}

          <div className="drawer-actions">
            <button className="btn btn-primary" onClick={() => onFind(p.id)}>
              Find a gift for {p.name} →
            </button>
            <button className="link-btn danger" onClick={() => onRemove(p)}>
              Remove {p.name}
            </button>
          </div>
        </div>
        )}
      </aside>
    </div>
  )
}

/** "✓ Given" that asks what you paid (optional), so the app can track spending. */
function GiveButton({ onGive }: { onGive: (spent: number | null) => void }) {
  const [asking, setAsking] = useState(false)
  const [amount, setAmount] = useState('')
  if (!asking) {
    return (
      <button className="give-btn shown" onClick={() => setAsking(true)}>
        ✓ Given
      </button>
    )
  }
  const save = () => onGive(amount.trim() ? Number(amount.replace(/[^0-9.]/g, '')) || null : null)
  return (
    <span className="give-ask">
      <span className="money-input small">
        $<input autoFocus inputMode="decimal" placeholder="paid" value={amount} onChange={(e) => setAmount(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} aria-label="What you paid" />
      </span>
      <button className="link-btn" onClick={save}>Save</button>
    </span>
  )
}
