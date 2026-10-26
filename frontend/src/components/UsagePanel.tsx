import type { Usage } from '../api'
import { kTokens, money } from '../format'

/** Token + cost breakdown for one run, per agent. gpt-6-luna prices from the course (per 1M tokens). */
export default function UsagePanel({ usage, cached }: { usage: Usage; cached: boolean }) {
  return (
    <details className="usage-panel">
      <summary>
        <span>
          {cached ? 'From cache · no AI calls this time' : `${usage.requests} AI call${usage.requests === 1 ? '' : 's'} · ${kTokens(usage.input_tokens + usage.output_tokens)} tokens · ${money(usage.cost_usd)}`}
        </span>
        <span className="mono muted">tokens &amp; cost</span>
      </summary>
      {cached && <p className="muted small">The original run below cost {money(usage.cost_usd)}. Asking the same question again today is free.</p>}
      <table>
        <thead>
          <tr>
            <th>Agent</th>
            <th>Calls</th>
            <th>Input</th>
            <th>Cached</th>
            <th>Output</th>
            <th>Cost</th>
          </tr>
        </thead>
        <tbody>
          {usage.by_agent.map((a) => (
            <tr key={a.agent}>
              <td>{a.agent}</td>
              <td>{a.requests}</td>
              <td>{a.input_tokens.toLocaleString()}</td>
              <td>{a.cache_read_tokens.toLocaleString()}</td>
              <td>{a.output_tokens.toLocaleString()}</td>
              <td>{money(a.cost_usd)}</td>
            </tr>
          ))}
          <tr className="total">
            <td>Total</td>
            <td>{usage.requests}</td>
            <td>{usage.input_tokens.toLocaleString()}</td>
            <td>{usage.cache_read_tokens.toLocaleString()}</td>
            <td>{usage.output_tokens.toLocaleString()}</td>
            <td>{money(usage.cost_usd)}</td>
          </tr>
        </tbody>
      </table>
      <p className="mono muted small">gpt-6-luna · $0.10 input / $0.01 cached / $0.50 output per 1M tokens</p>
    </details>
  )
}
