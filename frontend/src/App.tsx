import { useEffect, useState } from 'react'
import { getMetrics, getUsage, listPeople, type Person, type SpendStatus } from './api'
import { money } from './format'
import ChatWidget from './components/ChatWidget'
import FinderPage from './components/FinderPage'
import ImportPage from './components/ImportPage'
import PeoplePage from './components/PeoplePage'
import UpcomingPage, { type FinderPreset } from './components/UpcomingPage'

type Tab = 'home' | 'import' | 'people' | 'finder'

export default function App() {
  const [tab, setTab] = useState<Tab>('home')
  const [people, setPeople] = useState<Person[]>([])
  const [scrolled, setScrolled] = useState(false)
  const [finderPerson, setFinderPerson] = useState<string | null>(null)
  const [preset, setPreset] = useState<FinderPreset | null>(null)
  const [spend, setSpend] = useState<SpendStatus | null>(null)
  const [timing, setTiming] = useState<Awaited<ReturnType<typeof getMetrics>> | null>(null)
  const refreshSpend = () => {
    getUsage().then(setSpend).catch(() => {})
    getMetrics().then(setTiming).catch(() => {})
  }

  useEffect(() => {
    listPeople().then(setPeople).catch(() => setPeople([]))
    refreshSpend()
    const onScroll = () => setScrolled(window.scrollY > 8)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const go = (t: Tab) => {
    setTab(t)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div className="app">
      <header className={`site-header${scrolled ? ' is-scrolled' : ''}`}>
        <div className="announcement">
          <span>Paste your iPhone notes</span>
          <span className="announcement-dot">●</span>
          <span>We sort them by person</span>
          <span className="announcement-dot">●</span>
          <span>Nothing saves until you say so</span>
        </div>
        <nav className="navbar">
          <button className="brand" onClick={() => go('home')}>
            <span className="brand-mark">G</span>
            <span className="brand-name">
              Giftwise
              <small>Be the friend who remembers</small>
            </span>
          </button>
          <div className="nav-links">
            <button className={`nav-link${tab === 'home' ? ' active' : ''}`} onClick={() => go('home')}>
              Upcoming
            </button>
            <button className={`nav-link${tab === 'import' ? ' active' : ''}`} onClick={() => go('import')}>
              Import<span className="hide-sm"> notes</span>
            </button>
            <button className={`nav-link${tab === 'people' ? ' active' : ''}`} onClick={() => go('people')}>
              People <span className="nav-count">{people.length}</span>
            </button>
            <button className={`nav-cta${tab === 'finder' ? ' active' : ''}`} onClick={() => go('finder')}>
              Find a gift
            </button>
          </div>
        </nav>
      </header>

      <main className="page">
        {tab === 'home' ? (
          <UpcomingPage
            people={people}
            setPeople={setPeople}
            onImportNotes={() => go('import')}
            onFind={(p) => {
              setFinderPerson(p.personId)
              setPreset(p)
              go('finder')
            }}
          />
        ) : tab === 'import' ? (
          <ImportPage
            people={people}
            onSpend={refreshSpend}
            onSaved={(next) => {
              setPeople(next)
              go('people')
            }}
          />
        ) : tab === 'people' ? (
          <PeoplePage
            people={people}
            setPeople={setPeople}
            onImport={() => go('import')}
            onFind={(id) => {
              setFinderPerson(id)
              setPreset(null)
              go('finder')
            }}
          />
        ) : (
          <FinderPage
            key={`${finderPerson ?? 'none'}-${preset?.occasion ?? ''}-${preset?.date ?? ''}-${preset?.budget ?? ''}`}
            people={people}
            preset={preset}
            personId={finderPerson}
            setPersonId={(id) => {
              setPreset(null)
              setFinderPerson(id)
            }}
            onPersonUpdated={(p) => setPeople((all) => all.map((x) => (x.id === p.id ? p : x)))}
            onImport={() => go('import')}
            onSpend={refreshSpend}
          />
        )}
      </main>

      <ChatWidget
        onSpend={refreshSpend}
        onContinue={(id) => {
          setFinderPerson(id)
          setPreset(null)
          go('finder')
        }}
      />

      <footer className="site-footer">
        <div className="footer-row">
          <span className="mono">Giftwise · AI Foundations final project</span>
          {timing?.finder_to_idea && (
            <span className="mono" title="Measured in this app: from Find gifts to saving or shopping a pick">
              Median time to a gift idea {timing.finder_to_idea.median_seconds}s ({timing.finder_to_idea.count})
            </span>
          )}
          {spend && (
            <span className="mono" title="New AI runs pause for the day once either limit is reached">
              AI spend today {money(spend.spent_today_usd)} of {money(spend.daily_budget_usd)} cap · {spend.requests_today}/{spend.daily_request_limit} calls
            </span>
          )}
        </div>
        <div className="footer-wordmark">Giftwise</div>
      </footer>
    </div>
  )
}
