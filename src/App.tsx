import { useEffect, useMemo, useState } from 'react'
import { encodeAddress, encodeCall, encodeUint, MAX_UINT256, SELECTORS, shortAddr } from './engine/abi'
import { SIMULATED_CASES } from './engine/cases'
import { parseCustomInput } from './engine/custom'
import { buildPermitTypedData, parsePermitInput, ZERO_ADDRESS } from './engine/permit'
import type { PermitParseResult } from './engine/permit'
import { analyze } from './engine/pipeline'
import type { AnalysisResult, Hex, ProposedTransaction, Severity, Verdict } from './engine/types'
import './App.css'

const STEP_MS = 650
const VERDICT_ICON: Record<Verdict, string> = { ALLOW: '✓', WARN: '!', BLOCK: '✕' }
const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low', 'info']
const CUSTOM = 'custom'
const PERMIT = 'permit'
const SIGN_METHOD = 'eth_signTypedData_v4'

const SAMPLE_TOKEN = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const SAMPLE_ADDR = '0x1234567890abcdef1234567890abcdef12345678'
const SAMPLES = [
  { label: 'Unlimited approve', data: encodeCall(SELECTORS.approve, encodeAddress(SAMPLE_ADDR), encodeUint(MAX_UINT256)) },
  { label: 'Approve 50 USDC', data: encodeCall(SELECTORS.approve, encodeAddress(SAMPLE_ADDR), encodeUint(50_000_000n)) },
  { label: 'Transfer 10 USDC', data: encodeCall(SELECTORS.transfer, encodeAddress(SAMPLE_ADDR), encodeUint(10_000_000n)) },
]

const permitJson = (value: string) =>
  JSON.stringify(buildPermitTypedData({ token: SAMPLE_TOKEN as Hex, spender: SAMPLE_ADDR as Hex, value }), null, 2)
const UNSUPPORTED_SAMPLE = JSON.stringify(
  {
    types: {
      PermitSingle: [
        { name: 'details', type: 'PermitDetails' },
        { name: 'spender', type: 'address' },
        { name: 'sigDeadline', type: 'uint256' },
      ],
      PermitDetails: [
        { name: 'token', type: 'address' },
        { name: 'amount', type: 'uint160' },
        { name: 'expiration', type: 'uint48' },
        { name: 'nonce', type: 'uint48' },
      ],
    },
    primaryType: 'PermitSingle',
    domain: { name: 'Permit2', chainId: 1, verifyingContract: '0x000000000022D473030F116dDEE9F6B43aC78BA3' },
    message: {
      details: { token: SAMPLE_TOKEN, amount: '1461501637330902918203684832716283019655932542975', expiration: '1893456000', nonce: '0' },
      spender: SAMPLE_ADDR,
      sigDeadline: '1893456000',
    },
  },
  null,
  2,
)
const PERMIT_SAMPLES = [
  { label: 'Unlimited permit', json: permitJson(MAX_UINT256.toString()) },
  { label: 'Permit 50 USDC', json: permitJson('50000000') },
  { label: 'Unsupported type', json: UNSUPPORTED_SAMPLE },
]

const toJson = (tx: ProposedTransaction) =>
  JSON.stringify(tx, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2)

export default function App() {
  const [mode, setMode] = useState(SIMULATED_CASES[0].id)
  const [runId, setRunId] = useState(0)
  const [stage, setStage] = useState(0)
  const [toInput, setToInput] = useState('')
  const [dataInput, setDataInput] = useState('')
  const [errors, setErrors] = useState<{ to?: string; data?: string }>({})
  const [customTx, setCustomTx] = useState<ProposedTransaction | null>(null)
  const [permitInput, setPermitInput] = useState('')
  const [permitError, setPermitError] = useState<string | null>(null)
  const [permit, setPermit] = useState<Extract<PermitParseResult, { ok: true }> | null>(null)

  const active = SIMULATED_CASES.find((c) => c.id === mode)
  const tx = mode === CUSTOM ? customTx : mode === PERMIT ? (permit?.tx ?? null) : active!.tx
  const result = mode === PERMIT ? (permit ? analyze(permit.tx, permit.decoded) : null) : tx ? analyze(tx) : null
  const verdictByCase = useMemo(
    () => Object.fromEntries(SIMULATED_CASES.map((c) => [c.id, analyze(c.tx).decision.verdict])),
    [],
  )

  const restart = () => {
    setRunId((r) => r + 1)
    setStage(0)
  }
  const select = (id: string) => {
    setMode(id)
    restart()
  }
  const submitCustom = () => {
    const parsed = parseCustomInput(toInput, dataInput)
    if (!parsed.ok) {
      setErrors(parsed.errors)
      return
    }
    setErrors({})
    setCustomTx(parsed.tx)
    restart()
  }
  const submitPermit = () => {
    const parsed = parsePermitInput(permitInput)
    if (!parsed.ok) {
      setPermitError(parsed.error)
      return
    }
    setPermitError(null)
    setPermit(parsed)
    restart()
  }
  const loadSample = (data: string) => {
    setToInput(SAMPLE_TOKEN)
    setDataInput(data)
    setErrors({})
  }

  useEffect(() => {
    const timers = [1, 2, 3].map((s) => setTimeout(() => setStage(s), s * STEP_MS))
    return () => timers.forEach(clearTimeout)
  }, [mode, runId])

  const customVerdict = customTx ? analyze(customTx).decision.verdict : null
  const permitVerdict = permit ? analyze(permit.tx, permit.decoded).decision.verdict : null

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <ShieldIcon />
          <div>
            <h1>AgentShield</h1>
            <p className="tagline">Understand what you’re approving before you sign.</p>
            <p className="subtag">Plain-language checks for AI-proposed Ethereum transactions</p>
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
              <button key={c.id} className={`case-card ${c.id === mode ? 'active' : ''}`} onClick={() => select(c.id)}>
                <span className="case-num">{i + 1}</span>
                <span className="case-text">
                  <span className="case-title">{c.title}</span>
                  <span className="case-sub">{c.subtitle}</span>
                </span>
                <span className={`pill pill-${v.toLowerCase()}`}>{v}</span>
              </button>
            )
          })}
          <h2 className="section-label spaced">Your own data</h2>
          <button className={`case-card ${mode === CUSTOM ? 'active' : ''}`} onClick={() => select(CUSTOM)}>
            <span className="case-num">+</span>
            <span className="case-text">
              <span className="case-title">Paste a transaction</span>
              <span className="case-sub">to · data</span>
            </span>
            {customVerdict && <span className={`pill pill-${customVerdict.toLowerCase()}`}>{customVerdict}</span>}
          </button>
          <button className={`case-card ${mode === PERMIT ? 'active' : ''}`} onClick={() => select(PERMIT)}>
            <span className="case-num">+</span>
            <span className="case-text">
              <span className="case-title">Paste a permit</span>
              <span className="case-sub">EIP-712 typed data</span>
            </span>
            {permitVerdict && <span className={`pill pill-${permitVerdict.toLowerCase()}`}>{permitVerdict}</span>}
          </button>
          <div className="sidebar-note">
            All transactions, addresses, contacts, and limits are simulated and hard-coded. Pasted data is only decoded locally. No RPC, API, wallet, or hardware is used.
          </div>
        </aside>

        <main className="main">
          {mode === CUSTOM ? (
            <section className="card">
              <div className="card-head">
                <h2>Paste transaction data</h2>
                <span className="badge badge-sim small">Simulated · read-only</span>
              </div>
              <form
                className="custom-form"
                onSubmit={(e) => {
                  e.preventDefault()
                  submitCustom()
                }}
              >
                <label>
                  <span className="field-label">to <span className="muted">(contract address)</span></span>
                  <input
                    className={errors.to ? 'invalid' : ''}
                    value={toInput}
                    onChange={(e) => setToInput(e.target.value)}
                    placeholder="0x…"
                    spellCheck={false}
                    autoComplete="off"
                  />
                  {errors.to && <span className="field-error">{errors.to}</span>}
                </label>
                <label>
                  <span className="field-label">data <span className="muted">(calldata hex)</span></span>
                  <textarea
                    className={errors.data ? 'invalid' : ''}
                    value={dataInput}
                    onChange={(e) => setDataInput(e.target.value)}
                    placeholder="0x095ea7b3…"
                    rows={4}
                    spellCheck={false}
                  />
                  {errors.data && <span className="field-error">{errors.data}</span>}
                </label>
                <div className="form-row">
                  <div className="samples">
                    <span className="muted">Fill sample:</span>
                    {SAMPLES.map((s) => (
                      <button type="button" key={s.label} className="chip" onClick={() => loadSample(s.data)}>
                        {s.label}
                      </button>
                    ))}
                  </div>
                  <button type="submit" className="primary">Analyze</button>
                </div>
                <p className="form-note">
                  Decodes ERC-20 <code>approve</code>, <code>transfer</code>, and <code>balanceOf</code>. Analyzed as if proposed from the simulated demo wallet on chain 1 with 0 ETH. Nothing is signed or sent.
                </p>
              </form>
            </section>
          ) : mode === PERMIT ? (
            <section className="card">
              <div className="card-head">
                <h2>Paste permit typed data</h2>
                <span className="badge badge-sim small">Simulated · read-only</span>
              </div>
              <form
                className="custom-form"
                onSubmit={(e) => {
                  e.preventDefault()
                  submitPermit()
                }}
              >
                <label>
                  <span className="field-label">typed data <span className="muted">(EIP-712 JSON)</span></span>
                  <textarea
                    className={permitError ? 'invalid' : ''}
                    value={permitInput}
                    onChange={(e) => setPermitInput(e.target.value)}
                    placeholder='{ "types": …, "primaryType": "Permit", "domain": …, "message": … }'
                    rows={10}
                    spellCheck={false}
                  />
                  {permitError && <span className="field-error">{permitError}</span>}
                </label>
                <div className="form-row">
                  <div className="samples">
                    <span className="muted">Fill sample:</span>
                    {PERMIT_SAMPLES.map((s) => (
                      <button
                        type="button"
                        key={s.label}
                        className="chip"
                        onClick={() => {
                          setPermitInput(s.json)
                          setPermitError(null)
                        }}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                  <button type="submit" className="primary">Analyze</button>
                </div>
                <p className="form-note">
                  Decodes only standard EIP-2612 <code>Permit</code> fields: owner, spender, value, nonce, and deadline. Nothing is signed, no signature is verified, and nothing is sent.
                </p>
              </form>
            </section>
          ) : (
            <section className="card">
              <div className="card-head">
                <h2>Agent proposal</h2>
                <span className="badge badge-sim small">Simulated</span>
              </div>
              <div className="chat">
                <div className="bubble user"><span className="who">User</span>{active!.userRequest}</div>
                <div className="bubble agent"><span className="who">AI agent</span>{active!.agentRationale}</div>
              </div>
              <details className="raw">
                <summary>Raw proposed transaction</summary>
                <pre>{toJson(active!.tx)}</pre>
              </details>
            </section>
          )}

          {tx && result ? (
            <>
              <BeforeYouSign tx={tx} result={result} done={stage >= 3} />
              <Analysis tx={tx} result={result} stage={stage} />
            </>
          ) : (
            <section className="card empty">
              {mode === PERMIT ? (
                <>Paste EIP-712 permit typed data, then press Analyze.</>
              ) : (
                <>Enter a <code>to</code> address and <code>data</code>, then press Analyze.</>
              )}
            </section>
          )}
        </main>

        <aside className="trace-panel">
          {result ? (
            <Trace result={result} stage={stage} onReplay={restart} />
          ) : (
            <>
              <h2 className="section-label">Activity trace</h2>
              <p className="muted">Waiting for a transaction to analyze.</p>
            </>
          )}
        </aside>
      </div>
      <footer className="footer">
        Simulated demo. AgentShield applies a fixed set of deterministic rules to explain transactions. It can’t detect every scam or
        guarantee protection from losses, and it never connects to a wallet, signs, or sends anything.
      </footer>
    </div>
  )
}

function Analysis({ tx, result, stage }: { tx: ProposedTransaction; result: AnalysisResult; stage: number }) {
  const done = stage >= 3
  const { decoded, risks, decision, plain } = result
  const sortedRisks = [...risks].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity))
  return (
    <>
      <section className={`card reveal ${stage >= 1 ? 'shown' : ''}`}>
        <div className="card-head">
          <h2><span className="step-num">1</span>Decoded in plain language</h2>
          <span className={`pill ${decoded.writesState ? 'pill-warn' : 'pill-allow'}`}>
            {tx.method === SIGN_METHOD ? 'Signature request' : decoded.writesState ? 'State-changing' : 'Read-only'}
          </span>
        </div>
        <p className="summary">{decoded.summary}</p>
        <dl className="fields">
          <dt>Contract</dt><dd>{decoded.contractLabel} <code>{shortAddr(tx.to)}</code></dd>
          <dt>{tx.method === SIGN_METHOD ? 'Typed data' : 'Function'}</dt><dd><code>{decoded.functionSignature ?? 'unknown'}</code></dd>
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
            <div className="verdict-label">{decision.verdict} <span className="verdict-sub">· {plain.verdictLabel}</span></div>
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
                  {r.triggered && <div className="rule-reason">{r.explanation}</div>}
                </td>
                <td className="rule-out">
                  {r.triggered ? <span className={`pill pill-${r.outcome.toLowerCase()}`}>{r.outcome}</span> : <span className="muted">not triggered</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  )
}

function Trace({ result, stage, onReplay }: { result: AnalysisResult; stage: number; onReplay: () => void }) {
  const done = stage >= 3
  const { decision, trace } = result
  return (
    <>
      <div className="trace-head">
        <h2 className="section-label">Activity trace</h2>
        <button className="replay" onClick={onReplay} disabled={!done}>↻ Replay</button>
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
    </>
  )
}

function BeforeYouSign({ tx, result, done }: { tx: ProposedTransaction; result: AnalysisResult; done: boolean }) {
  const { plain, decision } = result
  const v = decision.verdict.toLowerCase()
  return (
    <section className={`card before-sign reveal ${done ? 'shown' : ''} ${done ? `edge-${v}` : ''}`}>
      <div className="card-head">
        <h2>What you’re being asked to approve</h2>
        {done ? <span className={`pill pill-${v}`}>{decision.verdict} · {plain.verdictLabel}</span> : <span className="muted">Analyzing…</span>}
      </div>
      <div className="plain-grid">
        <div className="plain-q">What it asks for</div>
        <div>
          <div className="plain-strong">{plain.asksFor.title}</div>
          <div className="plain-text">{plain.asksFor.text}</div>
        </div>
        <div className="plain-q">{plain.recipient.role}</div>
        <div>
          <div className="plain-strong">{capitalize(plain.recipient.label)}</div>
          {plain.recipient.address && <code className="full-addr">{plain.recipient.address}</code>}
          <div className="plain-text">{plain.recipient.note}</div>
        </div>
        <div className="plain-q">{plain.reasonsTitle}</div>
        <ul className="plain-list">
          {plain.reasons.map((r) => <li key={r}>{r}</li>)}
        </ul>
        {plain.alsoNote.length > 0 && (
          <>
            <div className="plain-q">Also worth knowing</div>
            <ul className="plain-list muted-list">
              {plain.alsoNote.map((r) => <li key={r}>{r}</li>)}
            </ul>
          </>
        )}
        <div className="plain-q">What to do</div>
        <div className={`next-step next-${v}`}>{plain.nextStep}</div>
      </div>
      <details className="glossary">
        <summary>New to this? Key terms</summary>
        <dl>
          <dt>Signing</dt><dd>Approving a transaction with your wallet. Once a signed transaction is confirmed, it can’t be undone.</dd>
          <dt>Transfer</dt><dd>Sends tokens from your wallet to someone else right away.</dd>
          <dt>Approval</dt><dd>Gives another address (the “spender”) permission to move your tokens later, without asking you again, until you revoke it.</dd>
          <dt>Unlimited approval</dt><dd>An approval with no cap. The spender could move your entire balance of that token, including tokens you receive later.</dd>
          <dt>Permit (EIP-2612)</dt><dd>A signed message that grants an approval without sending a transaction. No tokens move when you sign, but the spender can use it to take them later.</dd>
          <dt>Unrecognized</dt><dd>Not in this demo’s saved contacts or known-contract lists. It isn’t proof of anything bad; it means AgentShield can’t vouch for it.</dd>
        </dl>
      </details>
      <p className="limits">
        {tx.method === SIGN_METHOD ? 'Token contract (verifyingContract)' : 'Contract called'}:{' '}
        <code>{tx.to === ZERO_ADDRESS && tx.method === SIGN_METHOD ? 'not provided' : tx.to}</code>. These are fixed demo rules, not a scam detector, and no verdict guarantees a transaction is safe.</p>
    </section>
  )
}

const capitalize = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)

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
