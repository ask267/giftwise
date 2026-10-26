import { useEffect, useState } from 'react'
import { getReminders, mailtoLink, saveReminderSettings, sendTestReminder, smsLink, type ReminderState } from '../api'

/** Email or text reminders: one-tap drafts always; automatic daily email if SMTP is set up in .env. */
export default function RemindersCard() {
  const [st, setSt] = useState<ReminderState | null>(null)
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = () =>
    getReminders()
      .then((r) => {
        setSt(r)
        setEmail(r.settings.email ?? '')
        setPhone(r.settings.phone ?? '')
      })
      .catch(() => null)
  useEffect(() => {
    load()
  }, [])

  async function save(auto = st?.settings.auto_email ?? false) {
    setError(null)
    setMsg(null)
    try {
      await saveReminderSettings({ email: email.trim() || null, phone: phone.trim() || null, auto_email: auto })
      setMsg('Saved')
      load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  if (!st) return null
  const subject = `Giftwise: ${st.upcoming.length} occasion${st.upcoming.length === 1 ? '' : 's'} coming up`
  return (
    <section className="dash-card">
      <p className="eyebrow">Reminders</p>
      <h3>Get reminded by email or text</h3>
      <p className="muted small">
        {st.upcoming.length ? `${st.upcoming.length} coming up in the next 2 weeks.` : 'Nothing in the next 2 weeks.'} Send yourself
        (or your learning team) a reminder with the last day to order.
      </p>
      <div className="remind-fields">
        <input className="text-input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Your email" aria-label="Email" />
        <input className="text-input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone (optional)" aria-label="Phone" />
        <button className="btn btn-ghost btn-sm" onClick={() => save()}>Save</button>
      </div>
      <div className="pick-actions">
        <a className="btn btn-primary btn-sm" href={mailtoLink(email || null, subject, st.digest)}>✉️ Email reminder</a>
        <a className="btn btn-ghost btn-sm" href={smsLink(phone || null, st.digest)}>💬 Text reminder</a>
      </div>
      <p className="muted small">These open your Mail or Messages app with the reminder written for you. You press send.</p>
      <label className={`auto-toggle${st.smtp_configured ? '' : ' disabled'}`}>
        <input type="checkbox" checked={st.settings.auto_email} disabled={!st.smtp_configured || !email.trim()} onChange={(e) => save(e.target.checked)} />
        <span>
          <b>Email me automatically</b> once a day when something's coming up
          {!st.smtp_configured && <span className="muted"> · needs email settings in .env (see README)</span>}
        </span>
      </label>
      {st.smtp_configured && st.settings.auto_email && (
        <button className="link-btn" onClick={async () => { try { const r = await sendTestReminder(); setMsg(`Test sent to ${r.sent_to}`) } catch (e) { setError((e as Error).message) } }}>
          Send a test email now
        </button>
      )}
      {msg && <p className="ok-note mono">✓ {msg}</p>}
      {error && <p className="error">{error}</p>}
    </section>
  )
}
