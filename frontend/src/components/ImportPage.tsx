import { useRef, useState } from 'react'
import { importPeople, parseImage, parseText, recordMetric, type ParseResponse, type Person } from '../api'
import { ATTACK_NOTE, SAMPLE_NOTE } from '../format'
import UsagePanel from './UsagePanel'
import ReviewCard, { draftFrom, toImport, type Draft } from './ReviewCard'

interface Props {
  people: Person[]
  onSaved: (people: Person[]) => void
  onSpend: () => void
}

type Mode = 'paste' | 'screenshot'

export default function ImportPage({ people, onSaved, onSpend }: Props) {
  const [mode, setMode] = useState<Mode>('paste')
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ParseResponse | null>(null)
  const [drafts, setDrafts] = useState<Draft[]>([])
  const fileInput = useRef<HTMLInputElement>(null)
  const started = useRef<number | null>(null) // first paste/upload -> saved, for measuring time saved
  const startClock = () => { if (started.current == null) started.current = performance.now() }

  const canParse = mode === 'paste' ? text.trim().length > 0 : file !== null

  function pickFile(f: File | undefined) {
    if (!f) return
    startClock()
    setFile(f)
    setPreview(URL.createObjectURL(f))
  }

  async function run() {
    setBusy(true)
    setError(null)
    try {
      const res = mode === 'paste' ? await parseText(text) : await parseImage(file!)
      setResult(res)
      setDrafts(res.parsed.people.map(draftFrom))
      window.scrollTo({ top: 0 })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
      onSpend()
    }
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await importPeople(drafts.filter((d) => d.include).map(toImport))
      if (started.current != null) {
        recordMetric('notes_to_saved', (performance.now() - started.current) / 1000, `${res.created + res.updated} people, ${res.ideas_added} ideas`)
        started.current = null
      }
      onSaved(res.people)
      setResult(null)
      setText('')
      setFile(null)
      setPreview(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const included = drafts.filter((d) => d.include)
  const ideaCount = included.reduce((n, d) => n + d.keepIdea.filter(Boolean).length, 0)

  if (result) {
    const { parsed } = result
    return (
      <section className="review reveal is-shown">
        <div className="review-head">
          <div>
            <p className="eyebrow">Step 2 of 2 · Review</p>
            <h1>
              We found <em>{parsed.people.length} {parsed.people.length === 1 ? 'person' : 'people'}.</em>
            </h1>
            <p className="lead">
              Check each card. Uncheck anything that's wrong, fix names, and choose whether a card is someone new or
              someone you've already saved.
            </p>
          </div>
          <span className="mono parse-meta">
            {result.cached ? 'From cache · no AI call' : `Parsed by ${result.model}`}
          </span>
        </div>

        {result.usage && <UsagePanel usage={result.usage} cached={result.cached} />}

        {parsed.ignored_instructions.length > 0 && (
          <div className="shield">
            <span className="shield-icon" aria-hidden>
              ⛨
            </span>
            <div>
              <strong>
                We ignored {parsed.ignored_instructions.length} line
                {parsed.ignored_instructions.length > 1 ? 's' : ''} that tried to give the AI instructions.
              </strong>
              <p>Your note is treated as data only. These lines were not turned into gifts:</p>
              <ul>
                {parsed.ignored_instructions.map((line) => (
                  <li key={line}>
                    <q>{line}</q>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        <div className="review-grid">
          {drafts.map((d, i) => (
            <ReviewCard
              key={i}
              draft={d}
              people={people}
              onChange={(next) => setDrafts((all) => all.map((x, j) => (j === i ? next : x)))}
            />
          ))}
        </div>

        {parsed.unassigned.length > 0 && (
          <div className="unassigned">
            <p className="eyebrow">No person found</p>
            <p className="muted">These look like gift ideas, but the note doesn't say who they're for. They won't be saved.</p>
            <ul>
              {parsed.unassigned.map((u) => (
                <li key={u}>{u}</li>
              ))}
            </ul>
          </div>
        )}

        {error && <p className="error">{error}</p>}

        <div className="save-bar">
          <span className="mono">
            {included.length} {included.length === 1 ? 'person' : 'people'} · {ideaCount} idea{ideaCount === 1 ? '' : 's'}
          </span>
          <div className="save-actions">
            <button className="btn btn-ghost" onClick={() => setResult(null)} disabled={saving}>
              Back
            </button>
            <button className="btn btn-primary" onClick={save} disabled={saving || included.length === 0}>
              {saving ? 'Saving…' : 'Save to my people'}
            </button>
          </div>
        </div>
      </section>
    )
  }

  return (
    <>
      <section className="hero">
        <p className="eyebrow">Step 1 of 2 · Import</p>
        <h1>
          Your messy gift notes, <em>wrapped up neatly.</em>
        </h1>
        <p className="lead">
          Paste the gift list you keep in the iPhone Notes app, or upload a screenshot of it. Giftwise sorts every idea
          by person, remembers what you already gave, and flags what they don't want.
        </p>
      </section>

      <section className="import-card">
        <div className="tabs" role="tablist">
          {(['paste', 'screenshot'] as Mode[]).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              className={`tab${mode === m ? ' active' : ''}`}
              onClick={() => setMode(m)}
            >
              {m === 'paste' ? 'Paste text' : 'Upload screenshot'}
            </button>
          ))}
        </div>

        {mode === 'paste' ? (
          <>
            <textarea
              className="note-input"
              value={text}
              onChange={(e) => { startClock(); setText(e.target.value) }}
              placeholder={'mom - that candle from anthropologie\njake bday march!! wants airpods, NOT another hoodie\n…'}
              rows={11}
            />
            <div className="hint-row">
              <span className="mono muted">
                On iPhone: open the note → tap and hold → Select All → Copy
              </span>
              <span className="sample-btns">
                <button className="link-btn" onClick={() => { startClock(); setText(SAMPLE_NOTE) }}>
                  Try a sample note
                </button>
                <button className="link-btn attack" onClick={() => { startClock(); setText(ATTACK_NOTE) }} title="A note with hidden instructions aimed at the AI, to see the defense work">
                  ⛨ Try an attack
                </button>
              </span>
            </div>
          </>
        ) : (
          <div
            className={`dropzone${preview ? ' has-file' : ''}`}
            onClick={() => fileInput.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              pickFile(e.dataTransfer.files[0])
            }}
          >
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              hidden
              onChange={(e) => pickFile(e.target.files?.[0])}
            />
            {preview ? (
              <>
                <img src={preview} alt="Your note screenshot" />
                <span className="mono">{file?.name} · click to change</span>
              </>
            ) : (
              <>
                <span className="drop-icon">＋</span>
                <strong>Drop a screenshot of your note</strong>
                <span className="mono muted">PNG or JPG · up to 8 MB · handwriting works too</span>
              </>
            )}
          </div>
        )}

        {error && <p className="error">{error}</p>}

        <div className="import-actions">
          <button className="btn btn-primary" onClick={run} disabled={!canParse || busy}>
            {busy ? 'Reading your notes…' : 'Sort my notes'}
          </button>
          {busy && (
            <span className="thinking mono">
              <i /> <i /> <i /> finding people, ideas, dates and dislikes
            </span>
          )}
        </div>
      </section>

      <section className="how">
        {[
          ['01', 'Paste or upload', 'Straight from Notes, typos and all.'],
          ['02', 'AI sorts it', 'Ideas, past gifts, sizes, birthdays and "do not buy" go to the right person.'],
          ['03', 'You confirm', 'Fix anything that looks off. Nothing saves until you click save.'],
        ].map(([n, title, body]) => (
          <div key={n} className="how-step">
            <span className="mono how-num">{n}</span>
            <h3>{title}</h3>
            <p className="muted">{body}</p>
          </div>
        ))}
      </section>
    </>
  )
}
