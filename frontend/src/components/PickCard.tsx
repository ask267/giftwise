import { useState } from 'react'
import { saveIdea, writeCard, type GiftPick, type Occasion, type Person, type Vibe } from '../api'

interface Props {
  pick: GiftPick
  personId: string
  personName: string
  onChosen: (what: string) => void
  occasion: Occasion
  vibes: Vibe[]
  onPersonUpdated: (p: Person) => void
}

export default function PickCard({ pick, personId, personName, occasion, vibes, onPersonUpdated, onChosen }: Props) {
  const [saved, setSaved] = useState(false)
  const [cards, setCards] = useState<string[] | null>(null)
  const [writing, setWriting] = useState(false)
  const [copied, setCopied] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [chipIn, setChipIn] = useState(false)
  const [friends, setFriends] = useState('')
  const [copiedSplit, setCopiedSplit] = useState(false)

  const names = friends.split(',').map((f) => f.trim()).filter(Boolean)
  const share = pick.price / (names.length + 1)
  const splitMessage =
    `Hey${names.length === 1 ? ` ${names[0]}` : ''}! Want to go in on a gift for ${personName}'s ${occasion}? ` +
    `I'm thinking: ${pick.title} (${pick.is_local ? '~' : ''}$${pick.price.toFixed(0)}). ` +
    `Split ${names.length + 1} ways that's about $${share.toFixed(2)} each. ${pick.link}`

  async function save() {
    try {
      const person = await saveIdea(personId, {
        title: pick.title,
        details: `${pick.store} · ${pick.tier_label}`,
        link: pick.link,
        price_hint: `$${pick.price.toFixed(0)}`,
        occasion,
      })
      onPersonUpdated(person)
      setSaved(true)
      onChosen('saved idea')
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function card() {
    setWriting(true)
    setError(null)
    try {
      const res = await writeCard({ person_id: personId, occasion, gift_title: pick.title, vibes })
      setCards(res.options)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setWriting(false)
    }
  }

  return (
    <article className="pick">
      <div className="pick-top">
        <span className="mono muted">{pick.store}</span>
        <span className="pick-price">{pick.is_local ? '~' : ''}${pick.price.toFixed(0)}</span>
      </div>
      {pick.is_local && (
        <span className="pill pill-local pick-wish">
          📍 Near them · {pick.distance_km} km{pick.address ? ` · ${pick.address}` : ''}
        </span>
      )}
      <h4>{pick.title}</h4>
      {pick.from_wishlist && <span className="pill pill-blue pick-wish">★ From their wishlist</span>}
      <p className="pick-why">{pick.headline}</p>
      {pick.concern && <p className="pick-concern">Check: {pick.concern}</p>}

      <div className="pick-actions">
        {pick.is_local ? (
          <>
            <a className="btn btn-primary btn-sm" href={pick.delivery_link ?? pick.link} target="_blank" rel="noreferrer" onClick={() => onChosen('find delivery')}>
              Find delivery →
            </a>
            <a className="btn btn-ghost btn-sm" href={pick.link} target="_blank" rel="noreferrer">
              {pick.link === pick.maps_link ? 'Map' : 'Website'}
            </a>
            {pick.phone && (
              <a className="link-btn" href={`tel:${pick.phone}`}>
                Call
              </a>
            )}
          </>
        ) : (
          <a className="btn btn-primary btn-sm" href={pick.link} target="_blank" rel="noreferrer" onClick={() => onChosen('shop')}>
            Shop →
          </a>
        )}
        <button className="btn btn-ghost btn-sm" onClick={save} disabled={saved}>
          {saved ? 'Saved ✓' : 'Save idea'}
        </button>
        <button className="link-btn" onClick={card} disabled={writing}>
          {writing ? 'Writing…' : cards ? 'New card notes' : 'Write a card'}
        </button>
        <button className="link-btn" onClick={() => setChipIn(!chipIn)}>
          {chipIn ? 'Close' : 'Chip in with friends'}
        </button>
      </div>

      {chipIn && (
        <div className="chip-in">
          <label className="field">
            <span className="mono">Who's splitting it with you?</span>
            <input className="text-input" value={friends} onChange={(e) => setFriends(e.target.value)} placeholder="Ana, Ben, Chloe" />
          </label>
          <p className="split-line">
            <strong>${share.toFixed(2)}</strong> each · {names.length + 1} {names.length ? 'people' : 'person (just you so far)'}
          </p>
          {names.length > 0 && (
            <>
              <p className="split-msg">{splitMessage}</p>
              <button
                className="link-btn"
                onClick={() => {
                  navigator.clipboard?.writeText(splitMessage)
                  setCopiedSplit(true)
                }}
              >
                {copiedSplit ? 'Copied ✓ paste it in your group chat' : 'Copy message'}
              </button>
            </>
          )}
        </div>
      )}

      {error && <p className="error">{error}</p>}
      {cards && (
        <ul className="card-notes">
          {cards.map((c, i) => (
            <li key={i}>
              <p>“{c}”</p>
              <button
                className="link-btn"
                onClick={() => {
                  navigator.clipboard?.writeText(c)
                  setCopied(i)
                }}
              >
                {copied === i ? 'Copied ✓' : 'Copy'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </article>
  )
}
