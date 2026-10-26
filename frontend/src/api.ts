// Types mirror backend/models.py. All calls go to the FastAPI backend.

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8020'

export type Occasion = 'birthday' | 'christmas' | 'holiday' | 'wedding' | 'anniversary' | 'graduation' | 'other'
export type IdeaStatus = 'idea' | 'bought' | 'given'

export interface GiftIdea {
  title: string
  details: string | null
  link: string | null
  price_hint: string | null
  status: IdeaStatus
  occasion: Occasion | null
  year: number | null
  source_text: string
}

export interface ImportantDate {
  occasion: Occasion
  month: number | null
  day: number | null
  source_text: string
}

export interface ParsedPerson {
  name_as_written: string
  display_name: string
  match_id: string | null
  match_confidence: 'high' | 'low' | null
  relationship: string | null
  ideas: GiftIdea[]
  dislikes: string[]
  interests: string[]
  sizes: string[]
  dates: ImportantDate[]
  notes: string | null
}

export interface ParsedNotes {
  people: ParsedPerson[]
  unassigned: string[]
  ignored_instructions: string[]
}

export interface AgentUsage {
  agent: string
  requests: number
  input_tokens: number
  cache_read_tokens: number
  output_tokens: number
  cost_usd: number
}

export interface Usage {
  requests: number
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cost_usd: number
  by_agent: AgentUsage[]
}

export interface ParseResponse {
  parsed: ParsedNotes
  cached: boolean
  model: string
  usage: Usage | null
}

export interface Person {
  id: string
  name: string
  relationship: string | null
  ideas: (GiftIdea & { id: string; spent?: number | null })[]
  dislikes: string[]
  interests: string[]
  sizes: string[]
  dates: ImportantDate[]
  notes: string[]
  location: string | null
  photo?: string | null
}

export interface ImportResult {
  created: number
  updated: number
  ideas_added: number
  duplicates_skipped: number
  people: Person[]
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API}${path}`, init)
  } catch {
    throw new Error("Can't reach the Giftwise backend. Is it running on port 8020?")
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(typeof body?.detail === 'string' ? body.detail : `Request failed (${res.status})`)
  }
  return res.json() as Promise<T>
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const parseText = (text: string) => call<ParseResponse>('/api/notes/parse', json({ text }))

export function parseImage(file: File) {
  const form = new FormData()
  form.append('file', file)
  return call<ParseResponse>('/api/notes/parse-image', { method: 'POST', body: form })
}

export const listPeople = () => call<Person[]>('/api/people')

export const importPeople = (people: { match_id: string | null; person: ParsedPerson }[]) =>
  call<ImportResult>('/api/people/import', json({ people }))

export const deletePerson = (id: string) => call<{ deleted: string }>(`/api/people/${id}`, { method: 'DELETE' })

// ---------------------------------------------------------------- gift finder

export type Vibe = 'sentimental' | 'funny' | 'practical' | 'experience' | 'fancy' | 'handmade' | 'cozy'
export type Tier = 'same_day' | 'fast' | 'planned'

export interface FinderRequest {
  person_id: string
  occasion: Occasion
  event_date: string // YYYY-MM-DD
  budget: number
  vibes: Vibe[]
  extra: string | null
  location: string | null
  fresh: boolean
}

export interface GiftPick {
  product_id: string
  title: string
  store: string
  price: number
  tier: Tier
  tier_label: string
  link: string
  concept_title: string
  from_wishlist: boolean
  headline: string
  concern: string | null
  is_local: boolean
  distance_km: number | null
  address: string | null
  maps_link: string | null
  delivery_link: string | null
  phone: string | null
}

export interface FinderResult {
  person_id: string
  person_name: string
  occasion: Occasion
  days_left: number
  tiers: Tier[]
  picks: GiftPick[]
  rejected: { title: string; reason: string; by: 'critic' | 'rule' }[]
  blocked_listings: string[]
  wishlist_unmatched: string[]
  usage: Usage
  cached: boolean
  location_found: string | null
}

export type AgentStatus = 'waiting' | 'working' | 'done' | 'skipped' | 'error'
export interface AgentEvent {
  type: 'agent'
  agent: string
  status: AgentStatus
  detail: string
}

/** Runs the agent team, calling onEvent for each progress update. Resolves with the result. */
export async function runFinder(body: FinderRequest, onEvent: (e: AgentEvent) => void): Promise<FinderResult> {
  let res: Response
  try {
    res = await fetch(`${API}/api/finder/run`, json(body))
  } catch {
    throw new Error("Can't reach the Giftwise backend. Is it running on port 8020?")
  }
  if (!res.ok || !res.body) {
    const b = await res.json().catch(() => null)
    throw new Error(typeof b?.detail === 'string' ? b.detail : `Request failed (${res.status})`)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (!line) continue
      const msg = JSON.parse(line)
      if (msg.type === 'agent') onEvent(msg)
      else if (msg.type === 'result') return msg.result as FinderResult
      else if (msg.type === 'error') throw new Error(msg.message)
    }
  }
  throw new Error('The gift team stopped without an answer.')
}

export const writeCard = (body: { person_id: string; occasion: Occasion; gift_title: string; vibes: Vibe[] }) =>
  call<{ options: string[] }>('/api/finder/card', json(body))

export const saveIdea = (
  personId: string,
  idea: { title: string; details: string | null; link: string | null; price_hint: string | null; occasion: Occasion | null },
) => call<Person>(`/api/people/${personId}/ideas`, json(idea))

// ---------------------------------------------------------------- calendar / dates

export function parseCalendar(file: File) {
  const form = new FormData()
  form.append('file', file)
  return call<ParsedPerson[]>('/api/calendar/parse', { method: 'POST', body: form })
}

export const setDate = (personId: string, d: ImportantDate) => call<Person>(`/api/people/${personId}/dates`, json(d))

// ---------------------------------------------------------------- demo, history, spend

export const loadDemo = () => call<Person[]>('/api/demo/load', { method: 'POST' })

export const setIdeaStatus = (personId: string, ideaId: string, status: IdeaStatus, year: number | null, spent: number | null = null) =>
  call<Person>(`/api/people/${personId}/ideas/${ideaId}/status`, json({ status, year, spent }))

export interface SpendStatus {
  spent_today_usd: number
  requests_today: number
  daily_budget_usd: number
  daily_request_limit: number
}
export const getUsage = () => call<SpendStatus>('/api/usage')

export interface LinkDraft {
  title: string
  store: string | null
  price_hint: string | null
  link: string
  method: 'metadata' | 'ai' | 'url'
  flagged: boolean
  usage: Usage | null
}
export const readLink = (url: string) => call<LinkDraft>('/api/links/read', json({ url }))

export interface NewPerson {
  name: string
  relationship: string | null
  birthday_month: number | null
  birthday_day: number | null
  location: string | null
  interests: string[]
  dislikes: string[]
  sizes: string[]
  ideas: string[]
}
export const createPerson = (p: NewPerson) => call<Person>('/api/people', json(p))
export const setPhoto = (personId: string, dataUrl: string | null) =>
  call<Person>(`/api/people/${personId}/photo`, json({ data_url: dataUrl }))

export const updatePerson = (id: string, p: Omit<NewPerson, 'ideas'>) =>
  call<Person>(`/api/people/${id}`, { ...json(p), method: 'PUT' })

export type MetricEvent = 'notes_to_saved' | 'finder_to_idea'
export const recordMetric = (event: MetricEvent, seconds: number, detail?: string) =>
  call<{ ok: boolean }>('/api/metrics', json({ event, seconds: Math.round(seconds * 10) / 10, detail })).catch(() => null)
export const getMetrics = () =>
  call<Partial<Record<MetricEvent, { count: number; median_seconds: number; fastest_seconds: number }>>>('/api/metrics')
