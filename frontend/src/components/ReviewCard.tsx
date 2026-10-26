import type { ParsedPerson, Person } from '../api'
import { formatDate, sizeLabel, STATUS_LABEL } from '../format'
import Avatar from './Avatar'

export interface Draft {
  include: boolean
  matchId: string | null
  name: string
  keepIdea: boolean[]
  parsed: ParsedPerson
}

export const draftFrom = (p: ParsedPerson): Draft => ({
  include: true,
  matchId: p.match_id,
  name: p.display_name,
  keepIdea: p.ideas.map(() => true),
  parsed: p,
})

export const toImport = (d: Draft) => ({
  match_id: d.matchId,
  person: { ...d.parsed, display_name: d.name.trim() || d.parsed.display_name, ideas: d.parsed.ideas.filter((_, i) => d.keepIdea[i]) },
})

interface Props {
  draft: Draft
  people: Person[]
  onChange: (d: Draft) => void
}

export default function ReviewCard({ draft, people, onChange }: Props) {
  const p = draft.parsed
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch })
  const matched = people.find((x) => x.id === draft.matchId)

  return (
    <article className={`review-card${draft.include ? '' : ' is-skipped'}`}>
      <header className="rc-head">
        <Avatar name={draft.name || '?'} size={48} />
        <div className="rc-title">
          <input
            className="rc-name"
            value={draft.name}
            onChange={(e) => set({ name: e.target.value })}
            aria-label="Name"
            disabled={!draft.include}
          />
          <span className="mono muted">
            written as “{p.name_as_written}”{p.relationship ? ` · ${p.relationship}` : ''}
          </span>
        </div>
        <label className="rc-toggle">
          <input type="checkbox" checked={draft.include} onChange={(e) => set({ include: e.target.checked })} />
          <span>{draft.include ? 'Keep' : 'Skipped'}</span>
        </label>
      </header>

      {people.length > 0 && (
        <label className="rc-match">
          <span className="mono">Save as</span>
          <select
            value={draft.matchId ?? ''}
            onChange={(e) => set({ matchId: e.target.value || null })}
            disabled={!draft.include}
          >
            <option value="">New person</option>
            {people.map((x) => (
              <option key={x.id} value={x.id}>
                Add to {x.name}
              </option>
            ))}
          </select>
          {matched && p.match_id === matched.id && (
            <span className={`pill ${p.match_confidence === 'high' ? 'pill-blue' : 'pill-warn'}`}>
              {p.match_confidence === 'high' ? 'Matched' : 'Best guess, check'}
            </span>
          )}
        </label>
      )}

      {p.ideas.length > 0 && (
        <ul className="rc-ideas">
          {p.ideas.map((idea, i) => (
            <li key={i} className={draft.keepIdea[i] ? '' : 'is-off'} title={`From your note: “${idea.source_text}”`}>
              <label>
                <input
                  type="checkbox"
                  checked={draft.keepIdea[i]}
                  disabled={!draft.include}
                  onChange={(e) => set({ keepIdea: draft.keepIdea.map((k, j) => (j === i ? e.target.checked : k)) })}
                />
                <span className="rc-idea-text">
                  <strong>{idea.title}</strong>
                  {idea.details && <span className="muted"> · {idea.details}</span>}
                  {idea.price_hint && <span className="mono"> · {idea.price_hint}</span>}
                </span>
              </label>
              <span className={`pill pill-${idea.status}`}>
                {STATUS_LABEL[idea.status]}
                {idea.year ? ` ${idea.year}` : ''}
                {idea.occasion && idea.status === 'idea' ? ` · ${idea.occasion}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="rc-chips">
        {p.dislikes.map((x) => (
          <span key={`d-${x}`} className="chip chip-avoid">
            Avoid: {x}
          </span>
        ))}
        {p.interests.map((x) => (
          <span key={`i-${x}`} className="chip">
            Likes {x}
          </span>
        ))}
        {p.sizes.map((x) => (
          <span key={`s-${x}`} className="chip chip-mono">
            {sizeLabel(x)}
          </span>
        ))}
        {p.dates.map((d) => (
          <span key={`t-${d.occasion}`} className="chip chip-date">
            {formatDate(d)}
          </span>
        ))}
      </div>

      {p.notes && <p className="rc-notes muted">{p.notes}</p>}
    </article>
  )
}
