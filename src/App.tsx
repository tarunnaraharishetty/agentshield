import { useEffect, useMemo, useState } from 'react'
import { shortAddr } from './engine/abi'
import { SIMULATED_CASES } from './engine/cases'
import { analyze } from './engine/pipeline'
import type { Severity, Verdict } from './engine/types'
import './App.css'

const STEP_MS = 650
const VERDICT_ICON: Record<Verdict, string> = { ALLOW: '✓', WARN: '!', BLOCK: '✕' }
const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low', 'info']

export default function App() {
  const [caseId, setCaseId] = useState(SIMULATED_CASES[0].id)
  const [runId, setRunId] = useState(0)
  const [stage, setStage] = useState(0)

  const active = SIMULATED_CASES.find((c) => c.id === caseId)!
  const result = useMemo(() => analyze(active.tx), [active])
  const verdictByCase = useMemo(
    () => Object.fromEntries(SIMULATED_CASES.map((c) => [c.id, analyze(c.tx).decision.verdict])),
    [],
  )

  const start = (id: string) => {
    setCaseId(id)
    setRunId((r) => r + 1)
    setStage(0)
  }

  useEffect(() => {
    const timers = [1, 2, 3].map((s) => setTimeout(() => setStage(s), s * STEP_MS))
    return () => timers.forEach(clearTimeout)
  }, [caseId, runId])

  const done = stage >= 3
  const { decoded, risks, decision, trace } = result
  const sortedRisks = [...risks].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity))

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <ShieldIcon />
          <div>
            <h1>AgentShield</h1>
            <p>Safety firewall for AI-proposed Ethereum transactions</p>
          </div>
        </div>
        <div className="topbar-badges">
          <span className="badge badge-sim">Simulated demo</span>
          <span className="badge badge-muted">No wallet connected · nothing is signed or sent</span>
        </div>
      </header>

      <div className="layout">
        <aside className="sidebar">
          <h2 className="section-label">Simulated cases</h2>
          {SIMULATED_CASES.map((c, i) => {
            const v = verdictByCase[c.id]
            return (
              <button
                key={c.id}
                className={`case-card ${c.id === caseId ? 'active' : ''}`}
                onClick={() => start(c.id)}
              >
                <span className="case-num">{i + 1}</span>
                <span className="case-text">
                  <span className="case-title">{c.title}</span>
                  <span className="case-sub">{c.subtitle}</span>
                </span>
                <span className={`pill pill-${v.toLowerCase()}`}>{v}</span>
              </button>
            )
          })}
          <div className="sidebar-note">
            All transactions, addresses, contacts, and limits are simulated and hard-coded. No RPC, API, wallet, or hardware is used.
          </div>
        </aside>

        <main className="main">
          <section className="card">
            <div className="card-head">
              <h2>Agent proposal</h2>
              <span className="badge badge-sim small">Simulated</span>
            </div>
            <div className="chat">
              <div className="bubble user"><span className="who">User</span>{active.userRequest}</div>
              <div className="bubble agent"><span className="who">AI agent</span>{active.agentRationale}</div>
            </div>
            <details className="raw">
              <summary>Raw proposed transaction</summary>
              <pre>{JSON.stringify(active.tx, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2)}</pre>
            </details>
          </section>

          <section className={`card reveal ${stage >= 1 ? 'shown' : ''}`}>
            <div className="card-head">
              <h2><span className="step-num">1</span>Decoded in plain language</h2>
              <span className={`pill ${decoded.writesState ? 'pill-warn' : 'pill-allow'}`}>
                {decoded.writesState ? 'State-changing' : 'Read-only'}
              </span>
            </div>
            <p className="summary">{decoded.summary}</p>
            <dl className="fields">
              <dt>Contract</dt><dd>{decoded.contractLabel} <code>{shortAddr(active.tx.to)}</code></dd>
              <dt>Function</dt><dd><code>{decoded.functionSignature ?? 'unknown'}</code></dd>
              {decoded.args.map((a) => (
                <FieldRow key={a.name} name={a.name} value={a.display} />
              ))}
            </dl>
          </section>

          <section className={`card reveal ${stage >= 2 ? 'shown' : ''}`}>
            <div className="card-head">
              <h2><span className="step-num">2</span>Risk factors</h2>
              <span className="muted">{risks.length} found</span>
            </div>
            <ul className="risks">
              {sortedRisks.map((r) => (
                <li key={r.id} className={`risk sev-${r.severity}`}>
                  <span className="sev">{r.severity}</span>
                  <div>
                    <div className="risk-title">{r.title}</div>
                    <div className="risk-detail">{r.detail}</div>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className={`card reveal ${done ? 'shown' : ''}`}>
            <div className="card-head">
              <h2><span className="step-num">3</span>Final safety check</h2>
              <span className="muted">Deterministic rules</span>
            </div>
            <div className={`verdict verdict-${decision.verdict.toLowerCase()}`}>
              <span className="verdict-icon">{VERDICT_ICON[decision.verdict]}</span>
              <div>
                <div className="verdict-label">{decision.verdict}</div>
                <div className="verdict-headline">{decision.headline}</div>
              </div>
            </div>
            <table className="rules">
              <tbody>
                {decision.rules.map((r) => (
                  <tr key={r.id} className={r.triggered ? 'triggered' : ''}>
                    <td className="rule-id">{r.id}</td>
                    <td>
                      <div className="rule-name">{r.name}</div>
                      {r.triggered && <div className="rule-reason">{r.reason}</div>}
                    </td>
                    <td className="rule-out">
                      {r.triggered ? <span className={`pill pill-${r.outcome.toLowerCase()}`}>{r.outcome}</span> : <span className="muted">not triggered</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </main>

        <aside className="trace-panel">
          <div className="trace-head">
            <h2 className="section-label">Activity trace</h2>
            <button className="replay" onClick={() => start(caseId)} disabled={!done}>↻ Replay</button>
          </div>
          <ol className="trace">
            {trace.map((t, i) => {
              const status = stage > i ? 'done' : stage === i ? 'running' : 'pending'
              return (
                <li key={t.id} className={`trace-step ${status}`}>
                  <span className="dot" />
                  <div className="trace-body">
                    <div className="trace-title">
                      {t.label}
                      <span className="trace-status">{status === 'done' ? `+${(i + 1) * STEP_MS} ms` : status}</span>
                    </div>
                    {status === 'done' && (
                      <>
                        <div className="trace-detail">{t.detail}</div>
                        <ul className="trace-items">
                          {t.items.map((it) => <li key={it}>{it}</li>)}
                        </ul>
                      </>
                    )}
                  </div>
                </li>
              )
            })}
            <li className={`trace-step final ${done ? 'done' : 'pending'}`}>
              <span className="dot" />
              <div className="trace-body">
                <div className="trace-title">
                  Outcome
                  {done && <span className={`pill pill-${decision.verdict.toLowerCase()}`}>{decision.verdict}</span>}
                </div>
                {done && <div className="trace-detail">Verdict only. No signature requested, nothing broadcast.</div>}
              </div>
            </li>
          </ol>
        </aside>
      </div>
    </div>
  )
}

function FieldRow({ name, value }: { name: string; value: string }) {
  return (
    <>
      <dt>{name}</dt>
      <dd>{value}</dd>
    </>
  )
}

function ShieldIcon() {
  return (
    <svg className="logo" viewBox="0 0 32 32" aria-hidden="true">
      <path d="M16 2 4 7v8c0 7.2 5.1 13.4 12 15 6.9-1.6 12-7.8 12-15V7L16 2Z" fill="url(#g)" />
      <path d="m11 16 3.5 3.5L21.5 12" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6d8bff" />
          <stop offset="1" stopColor="#3ccf91" />
        </linearGradient>
      </defs>
    </svg>
  )
}
