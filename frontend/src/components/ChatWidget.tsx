import { useEffect, useRef, useState } from 'react'
import { clearChat, getChat, sendChat, type ChatMsg, type ChatState } from '../api'
import { money } from '../format'

/** Tiny, safe formatter: **bold** and line breaks only (text is never injected as HTML). */
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
        part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : <span key={i}>{part}</span>,
      )}
    </>
  )
}

const SUGGESTIONS = ['Where did I leave off?', "What's coming up soon?", 'Help me decide between my options']

export default function ChatWidget({ onContinue, onSpend }: { onContinue: (personId: string) => void; onSpend: () => void }) {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<ChatState | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastCost, setLastCost] = useState<number | null>(null)
  const list = useRef<HTMLDivElement>(null)

  const load = () => getChat().then(setState).catch(() => setError("Can't reach the Giftwise backend."))
  useEffect(() => {
    if (open) load()
  }, [open])
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' })
  }, [state?.messages.length, busy, open])

  async function send(message: string) {
    const m = message.trim()
    if (!m || busy) return
    setBusy(true)
    setError(null)
    setText('')
    const mine: ChatMsg = { role: 'you', text: m, time: new Date().toISOString() }
    setState((s) => (s ? { ...s, messages: [...s.messages, mine] } : s))
    try {
      const r = await sendChat(m)
      setLastCost(r.usage.cost_usd)
      await load()
      onSpend()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const welcome = state?.welcome
  return (
    <div className="chat-widget">
      {open && (
        <section className="chat-panel" role="dialog" aria-label="Giftwise chat">
          <header className="chat-header">
            <div>
              <strong>Giftwise chat</strong>
              <span className="chat-online">● remembers where you left off</span>
            </div>
            <div className="chat-head-btns">
              {!!state?.messages.length && (
                <button className="chat-clear" onClick={async () => { await clearChat(); load() }} title="Clear this conversation (your gift history stays)">
                  Clear
                </button>
              )}
              <button className="chat-close" onClick={() => setOpen(false)} aria-label="Close chat">×</button>
            </div>
          </header>

          <div className="chat-list" ref={list}>
            <div className="chat-welcome">
              <span className="mono">Where you left off</span>
              <p>{welcome?.text ?? "No gift searches yet. Run Find a gift for someone and I'll remember how it went."}</p>
              {welcome?.person_id && (
                <button className="link-btn" onClick={() => { setOpen(false); onContinue(welcome.person_id!) }}>
                  Continue with {welcome.person} →
                </button>
              )}
            </div>
            {state?.messages.map((m, i) => (
              <div key={i} className={`chat-msg ${m.role === 'you' ? 'mine' : 'theirs'}`}>
                <Rich text={m.text} />
              </div>
            ))}
            {busy && (
              <div className="chat-msg theirs typing" aria-label="Thinking">
                <i /> <i /> <i />
              </div>
            )}
            {error && <p className="error">{error}</p>}
          </div>

          {!state?.messages.length && (
            <div className="chat-suggest">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)} disabled={busy}>
                  {s}
                </button>
              ))}
            </div>
          )}
          <form className="chat-input" onSubmit={(e) => { e.preventDefault(); send(text) }}>
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask about a gift, or tell me what you decided…" maxLength={1000} aria-label="Message" />
            <button className="btn btn-primary btn-sm" disabled={busy || !text.trim()}>Send</button>
          </form>
          {lastCost != null && <p className="chat-cost mono">last reply {money(lastCost)}</p>}
        </section>
      )}
      <button className={`chat-toggle${open ? ' open' : ''}`} onClick={() => setOpen(!open)} aria-label={open ? 'Close chat' : 'Open chat'}>
        {open ? '×' : '💬'}
        {!open && <span className="chat-toggle-label">Where was I?</span>}
      </button>
    </div>
  )
}
